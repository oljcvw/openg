use std::{
	collections::{HashMap, HashSet},
	fs,
	path::{Path, PathBuf},
	sync::{
		atomic::{AtomicU64, Ordering},
		LazyLock,
	},
};

use base64::{
	engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
	Engine,
};
use serde::{Deserialize, Serialize};
use tauri::{http, Manager};

use crate::{
	api::encrypted_media_store::{
		aad_prefix, cdn_host_allowed, delete_key, encrypted_plaintext_length,
		identifier_hash, load_key, load_or_create_key, media_error, now_ms,
		parse_range, protocol_url, random_token, read_encrypted_range,
		same_media_category, stream_encrypted_atomic, validate_cdn_url,
		validate_content_type, validate_identifier, write_encrypted_atomic,
	},
	error::AppError,
	storage::AuthStorage,
};

const SCHEME: &str = "direct-media-cache";
const CACHE_DIR: &str = "direct-media-cache-v1";
const INDEX_FILE: &str = "history.ogdi";
const MEDIA_MAGIC: &[u8; 8] = b"OGDMED01";
const INDEX_MAGIC: &[u8; 8] = b"OGDIDX01";
const KEY_SERVICE: &str = "open-grind-direct-media-cache";
const DEFAULT_PAGE_SIZE: usize = 60;
const MAX_PAGE_SIZE: usize = 60;
const MAX_SINGLE_MEDIA_BYTES: u64 = 128 * 1024 * 1024;
static CACHE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static CACHE_EPOCH: AtomicU64 = AtomicU64::new(0);
static ACTIVE_SCOPES: LazyLock<
	tokio::sync::Mutex<HashMap<String, ActiveScope>>,
> = LazyLock::new(|| tokio::sync::Mutex::new(HashMap::new()));

#[derive(Debug, Clone, PartialEq, Eq)]
struct ActiveScope {
	token: String,
	conversation_hash: String,
	peer_hash: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RemoteAvailability {
	Available,
	Expired,
	ViewsExhausted,
	Retracted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CacheAvailability {
	Cached,
	NotCached,
	Evicted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectMediaEntry {
	account_profile_id: String,
	conversation_id: String,
	peer_profile_id: String,
	pub message_id: String,
	media_id: String,
	kind: String,
	message_type: String,
	sent_at: u64,
	remote_availability: RemoteAvailability,
	pub cache_availability: CacheAvailability,
	cache_token: Option<String>,
	content_type: Option<String>,
	pub byte_length: Option<u64>,
	#[serde(default)]
	pub file_name: Option<String>,
	pub last_accessed_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexEntry {
	identity_hash: String,
	conversation_hash: String,
	peer_hash: String,
	record_file: String,
	sent_at: u64,
	last_accessed_ms: u64,
	byte_length: Option<u64>,
	cache_availability: CacheAvailability,
	cache_token_hash: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct AccountIndex {
	entries: Vec<IndexEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectMediaStored {
	pub token: String,
	pub protocol_url: String,
	pub byte_length: u64,
	pub content_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectMediaLookup {
	pub found: bool,
	pub token: Option<String>,
	pub protocol_url: Option<String>,
	pub byte_length: Option<u64>,
	pub content_type: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectMediaPresence {
	pub exists: bool,
	pub cache_availability: CacheAvailability,
	pub byte_length: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectMediaPage {
	pub items: Vec<DirectMediaEntry>,
	pub next_cursor: Option<String>,
	pub total_count: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectMediaCacheStats {
	pub byte_length: u64,
	pub cached_count: u64,
	pub history_count: u64,
	pub account_count: u64,
	pub cache_epoch: u64,
}

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
	tauri::plugin::Builder::new("open-grind-direct-media-cache")
		.setup(|app, _api| {
			if repair_persisted_records(app).is_err() {
				tracing::warn!(
					"direct-media persisted-record migration was incomplete"
				);
			}
			Ok(())
		})
		.register_asynchronous_uri_scheme_protocol(
			SCHEME,
			|context, request, responder| {
				let app = context.app_handle().clone();
				tauri::async_runtime::spawn(async move {
					responder.respond(serve_protocol(app, request).await);
				});
			},
		)
		.build()
}

#[tauri::command]
pub async fn direct_media_cache_set_scope(
	account_id: String,
	scope_token: Option<String>,
	conversation_id: Option<String>,
	peer_profile_id: Option<String>,
) -> Result<(), AppError> {
	validate_identifier(&account_id)?;
	ensure_active_account(&account_id)?;
	let account_hash = identifier_hash(&account_id);
	let mut scopes = ACTIVE_SCOPES.lock().await;
	match (scope_token, conversation_id, peer_profile_id) {
		(Some(token), Some(conversation), Some(peer)) => {
			validate_identifier(&token)?;
			validate_identifier(&conversation)?;
			validate_identifier(&peer)?;
			scopes.insert(
				account_hash,
				ActiveScope {
					token,
					conversation_hash: identifier_hash(&conversation),
					peer_hash: identifier_hash(&peer),
				},
			);
		}
		(None, None, None) => {
			scopes.remove(&account_hash);
		}
		_ => {
			return Err(cache_error(
				"direct-media scope identity is incomplete",
			));
		}
	}
	Ok(())
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn direct_media_cache_upsert(
	app: tauri::AppHandle,
	account_id: String,
	conversation_id: String,
	peer_profile_id: String,
	message_id: String,
	media_id: String,
	kind: String,
	message_type: String,
	sent_at: u64,
	remote_availability: RemoteAvailability,
) -> Result<(), AppError> {
	validate_identity(
		&account_id,
		&conversation_id,
		&peer_profile_id,
		&message_id,
		&media_id,
	)?;
	validate_media_kind(&kind, &message_type)?;
	ensure_active_account(&account_id)?;
	let root = cache_root(&app)?;
	let account_hash = identifier_hash(&account_id);
	let _guard = CACHE_LOCK.lock().await;
	let key = load_or_create_key(KEY_SERVICE, &account_hash)?;
	let mut index = load_account_index(&root, &account_hash, &key)?;
	let identity_hash = composite_identity_hash(
		&conversation_id,
		&peer_profile_id,
		&message_id,
		&media_id,
	);
	if let Some(position) = index
		.entries
		.iter()
		.position(|entry| entry.identity_hash == identity_hash)
	{
		let mut record =
			load_record(&root, &account_hash, &index.entries[position], &key)?;
		if remote_availability == RemoteAvailability::Retracted
			&& record.cache_availability != CacheAvailability::Cached
		{
			let reference = index.entries.remove(position);
			let _ = fs::remove_file(
				root.join(&account_hash).join(reference.record_file),
			);
		} else {
			record.remote_availability = preserve_terminal_availability(
				record.remote_availability,
				remote_availability,
			);
			record.kind = kind;
			record.message_type = message_type;
			record.sent_at = sent_at;
			let record_file = index.entries[position].record_file.clone();
			let reference = reference_for(&record, record_file);
			save_record(&root, &account_hash, &reference, &key, &record)?;
			index.entries[position] = reference;
		}
	} else if remote_availability != RemoteAvailability::Retracted {
		let record = DirectMediaEntry {
			account_profile_id: account_id,
			conversation_id,
			peer_profile_id,
			message_id,
			media_id,
			kind,
			message_type,
			sent_at,
			remote_availability,
			cache_availability: CacheAvailability::NotCached,
			cache_token: None,
			content_type: None,
			byte_length: None,
			file_name: None,
			last_accessed_ms: now_ms(),
		};
		let reference =
			reference_for(&record, format!("{}.ogdr", random_token()));
		save_record(&root, &account_hash, &reference, &key, &record)?;
		index.entries.push(reference);
	}
	save_account_index(&root, &account_hash, &key, &index)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn direct_media_cache_store(
	app: tauri::AppHandle,
	account_id: String,
	conversation_id: String,
	peer_profile_id: String,
	message_id: String,
	media_id: String,
	kind: String,
	message_type: String,
	sent_at: u64,
	remote_availability: RemoteAvailability,
	source_url: String,
	content_type: String,
	maximum_bytes: u64,
	scope_token: String,
) -> Result<DirectMediaStored, AppError> {
	validate_identity(
		&account_id,
		&conversation_id,
		&peer_profile_id,
		&message_id,
		&media_id,
	)?;
	validate_media_kind(&kind, &message_type)?;
	validate_store_availability(remote_availability)?;
	validate_content_type(&content_type)?;
	ensure_active_account(&account_id)?;
	validate_identifier(&scope_token)?;
	let (total_cache_bytes, per_item_bytes) = cache_byte_limits(maximum_bytes)?;
	let source = validate_cdn_url(&source_url)?;
	let captured_epoch = CACHE_EPOCH.load(Ordering::Acquire);
	let account_hash = identifier_hash(&account_id);
	ensure_scope_current(
		&account_hash,
		&conversation_id,
		&peer_profile_id,
		&scope_token,
	)
	.await?;
	let response = downloader()?
		.get(source)
		.send()
		.await
		.map_err(|_| cache_error("media download failed"))?;
	let resolved_content_type =
		validate_response(&response, &content_type, per_item_bytes)?;
	let root = cache_root(&app)?;
	let key = {
		let _guard = CACHE_LOCK.lock().await;
		load_or_create_key(KEY_SERVICE, &account_hash)?
	};
	let token = random_token();
	let file_name = format!("{}.ogdm", random_token());
	let account_dir = root.join(&account_hash);
	fs::create_dir_all(&account_dir).map_err(|_| {
		cache_error("could not create direct-media cache directory")
	})?;
	let destination = account_dir.join(&file_name);
	let byte_length = stream_encrypted_atomic(
		response,
		&destination,
		&key,
		&direct_media_aad(
			&account_hash,
			&identifier_hash(&conversation_id),
			&identifier_hash(&peer_profile_id),
			&identifier_hash(&message_id),
			&identifier_hash(&media_id),
			&resolved_content_type,
		),
		per_item_bytes,
		MEDIA_MAGIC,
	)
	.await?;
	let _guard = CACHE_LOCK.lock().await;
	if CACHE_EPOCH.load(Ordering::Acquire) != captured_epoch
		|| ensure_active_account(&account_id).is_err()
		|| !scope_is_current(
			&account_hash,
			&conversation_id,
			&peer_profile_id,
			&scope_token,
		)
		.await
	{
		let _ = fs::remove_file(&destination);
		return Err(cache_error("direct-media cache changed during download"));
	}
	let mut index = load_account_index(&root, &account_hash, &key)?;
	let identity_hash = composite_identity_hash(
		&conversation_id,
		&peer_profile_id,
		&message_id,
		&media_id,
	);
	let existing_position = index
		.entries
		.iter()
		.position(|entry| entry.identity_hash == identity_hash);
	let old_file = existing_position
		.map(|position| {
			load_record(&root, &account_hash, &index.entries[position], &key)
		})
		.transpose()?
		.and_then(|entry| entry.file_name);
	let replacement = DirectMediaEntry {
		account_profile_id: account_id,
		conversation_id,
		peer_profile_id,
		message_id,
		media_id,
		kind,
		message_type,
		sent_at,
		remote_availability,
		cache_availability: CacheAvailability::Cached,
		cache_token: Some(token.clone()),
		content_type: Some(resolved_content_type.clone()),
		byte_length: Some(byte_length),
		file_name: Some(file_name),
		last_accessed_ms: now_ms(),
	};
	let record_file = existing_position
		.map(|position| index.entries[position].record_file.clone())
		.unwrap_or_else(|| format!("{}.ogdr", random_token()));
	let reference = reference_for(&replacement, record_file);
	if let Err(error) =
		save_record(&root, &account_hash, &reference, &key, &replacement)
	{
		let _ = fs::remove_file(&destination);
		return Err(error);
	}
	if let Some(position) = existing_position {
		index.entries[position] = reference;
	} else {
		index.entries.push(reference);
	}
	if let Err(error) = save_account_index(&root, &account_hash, &key, &index) {
		let _ = fs::remove_file(&destination);
		return Err(error);
	}
	if let Some(old_file) = old_file {
		let _ = fs::remove_file(account_dir.join(old_file));
	}
	trim_locked(&root, total_cache_bytes)?;
	Ok(DirectMediaStored {
		token: token.clone(),
		protocol_url: protocol_url(SCHEME, &token),
		byte_length,
		content_type: resolved_content_type,
	})
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn direct_media_cache_import_legacy(
	app: tauri::AppHandle,
	account_id: String,
	conversation_id: String,
	peer_profile_id: String,
	message_id: String,
	media_id: String,
	kind: String,
	message_type: String,
	sent_at: u64,
	remote_availability: RemoteAvailability,
	data_base64: String,
	content_type: String,
	maximum_bytes: u64,
	scope_token: String,
) -> Result<DirectMediaStored, AppError> {
	validate_identity(
		&account_id,
		&conversation_id,
		&peer_profile_id,
		&message_id,
		&media_id,
	)?;
	validate_media_kind(&kind, &message_type)?;
	validate_content_type(&content_type)?;
	ensure_active_account(&account_id)?;
	validate_identifier(&scope_token)?;
	let (total_cache_bytes, per_item_bytes) = cache_byte_limits(maximum_bytes)?;
	let bytes = decode_legacy_media(&data_base64, per_item_bytes)?;
	let captured_epoch = CACHE_EPOCH.load(Ordering::Acquire);
	let account_hash = identifier_hash(&account_id);
	ensure_scope_current(
		&account_hash,
		&conversation_id,
		&peer_profile_id,
		&scope_token,
	)
	.await?;
	let root = cache_root(&app)?;
	let _guard = CACHE_LOCK.lock().await;
	if CACHE_EPOCH.load(Ordering::Acquire) != captured_epoch
		|| ensure_active_account(&account_id).is_err()
		|| !scope_is_current(
			&account_hash,
			&conversation_id,
			&peer_profile_id,
			&scope_token,
		)
		.await
	{
		return Err(cache_error("direct-media cache changed during import"));
	}
	let key = load_or_create_key(KEY_SERVICE, &account_hash)?;
	let token = random_token();
	let file_name = format!("{}.ogdm", random_token());
	let account_dir = root.join(&account_hash);
	fs::create_dir_all(&account_dir).map_err(|_| {
		cache_error("could not create direct-media cache directory")
	})?;
	let destination = account_dir.join(&file_name);
	write_encrypted_atomic(
		&destination,
		&bytes,
		&key,
		&direct_media_aad(
			&account_hash,
			&identifier_hash(&conversation_id),
			&identifier_hash(&peer_profile_id),
			&identifier_hash(&message_id),
			&identifier_hash(&media_id),
			&content_type,
		),
		MEDIA_MAGIC,
	)?;
	let verified = read_encrypted_range(
		&destination,
		&key,
		&direct_media_aad(
			&account_hash,
			&identifier_hash(&conversation_id),
			&identifier_hash(&peer_profile_id),
			&identifier_hash(&message_id),
			&identifier_hash(&media_id),
			&content_type,
		),
		None,
		MEDIA_MAGIC,
	);
	if !matches!(verified, Ok(ref stored) if stored == &bytes) {
		let _ = fs::remove_file(&destination);
		return Err(cache_error("legacy media verification failed"));
	}
	let mut index = load_account_index(&root, &account_hash, &key)?;
	let identity_hash = composite_identity_hash(
		&conversation_id,
		&peer_profile_id,
		&message_id,
		&media_id,
	);
	let existing_position = index
		.entries
		.iter()
		.position(|entry| entry.identity_hash == identity_hash);
	let old_file = existing_position
		.map(|position| {
			load_record(&root, &account_hash, &index.entries[position], &key)
		})
		.transpose()?
		.and_then(|entry| entry.file_name);
	let byte_length = bytes.len() as u64;
	let replacement = DirectMediaEntry {
		account_profile_id: account_id,
		conversation_id,
		peer_profile_id,
		message_id,
		media_id,
		kind,
		message_type,
		sent_at,
		remote_availability,
		cache_availability: CacheAvailability::Cached,
		cache_token: Some(token.clone()),
		content_type: Some(content_type.clone()),
		byte_length: Some(byte_length),
		file_name: Some(file_name),
		last_accessed_ms: now_ms(),
	};
	let record_file = existing_position
		.map(|position| index.entries[position].record_file.clone())
		.unwrap_or_else(|| format!("{}.ogdr", random_token()));
	let reference = reference_for(&replacement, record_file);
	if let Err(error) =
		save_record(&root, &account_hash, &reference, &key, &replacement)
	{
		let _ = fs::remove_file(&destination);
		return Err(error);
	}
	if let Some(position) = existing_position {
		index.entries[position] = reference;
	} else {
		index.entries.push(reference);
	}
	if let Err(error) = save_account_index(&root, &account_hash, &key, &index) {
		let _ = fs::remove_file(&destination);
		return Err(error);
	}
	if let Some(old_file) = old_file {
		let _ = fs::remove_file(account_dir.join(old_file));
	}
	trim_locked(&root, total_cache_bytes)?;
	Ok(DirectMediaStored {
		token: token.clone(),
		protocol_url: protocol_url(SCHEME, &token),
		byte_length,
		content_type,
	})
}

#[tauri::command]
pub async fn direct_media_cache_lookup(
	app: tauri::AppHandle,
	account_id: String,
	conversation_id: String,
	peer_profile_id: String,
	message_id: String,
	media_id: String,
) -> Result<DirectMediaLookup, AppError> {
	validate_identity(
		&account_id,
		&conversation_id,
		&peer_profile_id,
		&message_id,
		&media_id,
	)?;
	ensure_active_account(&account_id)?;
	let root = cache_root(&app)?;
	let account_hash = identifier_hash(&account_id);
	let _guard = CACHE_LOCK.lock().await;
	let key = match load_key(KEY_SERVICE, &account_hash) {
		Ok(key) => key,
		Err(_) => return Ok(not_found()),
	};
	let mut index = load_account_index(&root, &account_hash, &key)?;
	let account_dir = root.join(&account_hash);
	let identity_hash = composite_identity_hash(
		&conversation_id,
		&peer_profile_id,
		&message_id,
		&media_id,
	);
	let Some(position) = index
		.entries
		.iter()
		.position(|entry| entry.identity_hash == identity_hash)
	else {
		return Ok(not_found());
	};
	let mut entry =
		load_record(&root, &account_hash, &index.entries[position], &key)?;
	let Some(file_name) = entry.file_name.as_deref() else {
		return Ok(not_found());
	};
	if !account_dir.join(file_name).is_file() {
		return Ok(not_found());
	}
	if probe_verified_entry_media(&account_dir, &account_hash, &key, &entry)
		.is_err()
	{
		return Ok(not_found());
	}
	entry.last_accessed_ms = now_ms();
	let result = DirectMediaLookup {
		found: true,
		token: entry.cache_token.clone(),
		protocol_url: entry
			.cache_token
			.as_deref()
			.map(|value| protocol_url(SCHEME, value)),
		byte_length: entry.byte_length,
		content_type: entry.content_type.clone(),
	};
	index.entries[position] =
		reference_for(&entry, index.entries[position].record_file.clone());
	save_record(&root, &account_hash, &index.entries[position], &key, &entry)?;
	save_account_index(&root, &account_hash, &key, &index)?;
	Ok(result)
}

#[tauri::command]
pub async fn direct_media_cache_presence(
	app: tauri::AppHandle,
	account_id: String,
	conversation_id: String,
	peer_profile_id: String,
	message_id: String,
	media_id: String,
) -> Result<DirectMediaPresence, AppError> {
	validate_identity(
		&account_id,
		&conversation_id,
		&peer_profile_id,
		&message_id,
		&media_id,
	)?;
	ensure_active_account(&account_id)?;
	let root = cache_root(&app)?;
	let account_hash = identifier_hash(&account_id);
	let _guard = CACHE_LOCK.lock().await;
	let key = match load_key(KEY_SERVICE, &account_hash) {
		Ok(key) => key,
		Err(_) => {
			return Ok(DirectMediaPresence {
				exists: false,
				cache_availability: CacheAvailability::NotCached,
				byte_length: None,
			})
		}
	};
	let index = load_account_index(&root, &account_hash, &key)?;
	let identity_hash = composite_identity_hash(
		&conversation_id,
		&peer_profile_id,
		&message_id,
		&media_id,
	);
	Ok(
		match index
			.entries
			.iter()
			.find(|entry| entry.identity_hash == identity_hash)
		{
			Some(entry) => DirectMediaPresence {
				exists: true,
				cache_availability: entry.cache_availability,
				byte_length: entry.byte_length,
			},
			None => DirectMediaPresence {
				exists: false,
				cache_availability: CacheAvailability::NotCached,
				byte_length: None,
			},
		},
	)
}

#[tauri::command]
pub async fn direct_media_cache_list(
	app: tauri::AppHandle,
	account_id: String,
	conversation_id: String,
	peer_profile_id: String,
	cursor: Option<String>,
	page_size: Option<usize>,
) -> Result<DirectMediaPage, AppError> {
	validate_identifier(&account_id)?;
	validate_identifier(&conversation_id)?;
	validate_identifier(&peer_profile_id)?;
	ensure_active_account(&account_id)?;
	let root = cache_root(&app)?;
	let account_hash = identifier_hash(&account_id);
	let _guard = CACHE_LOCK.lock().await;
	let key = match load_key(KEY_SERVICE, &account_hash) {
		Ok(key) => key,
		Err(_) => {
			return Ok(DirectMediaPage {
				items: Vec::new(),
				next_cursor: None,
				total_count: 0,
			})
		}
	};
	let conversation_hash = identifier_hash(&conversation_id);
	let peer_hash = identifier_hash(&peer_profile_id);
	let references = load_account_index(&root, &account_hash, &key)?
		.entries
		.into_iter()
		.filter(|entry| {
			entry.conversation_hash == conversation_hash
				&& entry.peer_hash == peer_hash
		})
		.collect::<Vec<_>>();
	let (references, next_cursor, total_count) = page_references(
		references,
		cursor.as_deref(),
		page_size.unwrap_or(DEFAULT_PAGE_SIZE),
	)?;
	let items = references
		.iter()
		.map(|reference| load_record(&root, &account_hash, reference, &key))
		.collect::<Result<Vec<_>, _>>()?;
	Ok(DirectMediaPage {
		items,
		next_cursor,
		total_count,
	})
}

#[tauri::command]
pub async fn direct_media_cache_trim(
	app: tauri::AppHandle,
	maximum_bytes: u64,
) -> Result<DirectMediaCacheStats, AppError> {
	let root = cache_root(&app)?;
	let _guard = CACHE_LOCK.lock().await;
	trim_locked(&root, maximum_bytes)
}

fn trim_locked(
	root: &Path,
	maximum_bytes: u64,
) -> Result<DirectMediaCacheStats, AppError> {
	let mut candidates = Vec::new();
	for hash in account_hashes(root)? {
		if let Ok(key) = load_key(KEY_SERVICE, &hash) {
			let index = load_account_index(root, &hash, &key)?;
			for (position, entry) in
				index.entries.iter().enumerate().filter(|(_, entry)| {
					entry.cache_availability == CacheAvailability::Cached
				}) {
				candidates.push((
					entry.last_accessed_ms,
					hash.clone(),
					position,
					entry.byte_length.unwrap_or(0),
				));
			}
		}
	}
	let evict = lru_eviction_targets(candidates, maximum_bytes);
	for hash in account_hashes(root)? {
		let Ok(key) = load_key(KEY_SERVICE, &hash) else {
			continue;
		};
		let mut index = load_account_index(root, &hash, &key)?;
		let mut positions = evict
			.iter()
			.filter(|(candidate, _)| candidate == &hash)
			.map(|(_, position)| *position)
			.collect::<Vec<_>>();
		positions.sort_unstable_by(|left, right| right.cmp(left));
		for position in positions {
			let reference = index.entries[position].clone();
			let mut record = load_record(root, &hash, &reference, &key)?;
			if let Some(file) = record.file_name.take() {
				let _ = fs::remove_file(root.join(&hash).join(file));
			}
			if record.remote_availability == RemoteAvailability::Retracted {
				let reference = index.entries.remove(position);
				let _ = fs::remove_file(
					root.join(&hash).join(reference.record_file),
				);
			} else {
				record.byte_length = None;
				record.content_type = None;
				record.cache_token = None;
				record.cache_availability = CacheAvailability::Evicted;
				let updated = reference_for(&record, reference.record_file);
				save_record(root, &hash, &updated, &key, &record)?;
				index.entries[position] = updated;
			}
		}
		save_account_index(root, &hash, &key, &index)?;
	}
	stats_locked(root)
}

fn lru_eviction_targets(
	mut candidates: Vec<(u64, String, usize, u64)>,
	maximum_bytes: u64,
) -> HashSet<(String, usize)> {
	candidates.sort_by_key(|candidate| candidate.0);
	let mut total: u64 = candidates.iter().map(|candidate| candidate.3).sum();
	let mut evict = HashSet::new();
	for (_, hash, position, bytes) in candidates {
		if total <= maximum_bytes {
			break;
		}
		total = total.saturating_sub(bytes);
		evict.insert((hash, position));
	}
	debug_assert!(total <= maximum_bytes);
	evict
}

#[tauri::command]
pub async fn direct_media_cache_clear(
	app: tauri::AppHandle,
	account_id: Option<String>,
) -> Result<DirectMediaCacheStats, AppError> {
	if let Some(id) = account_id.as_deref() {
		ensure_active_account(id)?;
	}
	CACHE_EPOCH.fetch_add(1, Ordering::AcqRel);
	let root = cache_root(&app)?;
	let _guard = CACHE_LOCK.lock().await;
	let targets = match account_id.as_deref() {
		Some(id) => vec![identifier_hash(id)],
		None => account_hashes(&root)?,
	};
	{
		let mut scopes = ACTIVE_SCOPES.lock().await;
		for hash in &targets {
			scopes.remove(hash);
		}
	}
	for hash in targets {
		let _ = fs::remove_dir_all(root.join(&hash));
		delete_key(KEY_SERVICE, &hash)?;
	}
	stats_locked(&root)
}

#[tauri::command]
pub async fn direct_media_cache_stats(
	app: tauri::AppHandle,
	account_id: Option<String>,
) -> Result<DirectMediaCacheStats, AppError> {
	if let Some(id) = account_id.as_deref() {
		ensure_active_account(id)?;
	}
	let root = cache_root(&app)?;
	let _guard = CACHE_LOCK.lock().await;
	stats_for_hashes(
		&root,
		account_id
			.as_deref()
			.map(identifier_hash)
			.into_iter()
			.collect(),
	)
}

async fn serve_protocol(
	app: tauri::AppHandle,
	request: http::Request<Vec<u8>>,
) -> http::Response<Vec<u8>> {
	match serve_protocol_inner(&app, &request).await {
		Ok(response) => response,
		Err(status) => http::Response::builder()
			.status(status)
			.header(http::header::CACHE_CONTROL, "no-store")
			.body(Vec::new())
			.expect("static protocol response"),
	}
}

async fn serve_protocol_inner(
	app: &tauri::AppHandle,
	request: &http::Request<Vec<u8>>,
) -> Result<http::Response<Vec<u8>>, http::StatusCode> {
	if request.method() != http::Method::GET
		&& request.method() != http::Method::HEAD
	{
		return Err(http::StatusCode::METHOD_NOT_ALLOWED);
	}
	let token = request.uri().path().trim_matches('/');
	if token.is_empty() || token.contains('/') {
		return Err(http::StatusCode::BAD_REQUEST);
	}
	let session = AuthStorage::get_session()
		.map_err(|_| http::StatusCode::UNAUTHORIZED)?
		.ok_or(http::StatusCode::UNAUTHORIZED)?;
	let account_hash = identifier_hash(&session.profile_id);
	let root =
		cache_root(app).map_err(|_| http::StatusCode::INTERNAL_SERVER_ERROR)?;
	let _guard = CACHE_LOCK.lock().await;
	let key = load_key(KEY_SERVICE, &account_hash)
		.map_err(|_| http::StatusCode::GONE)?;
	let mut index = load_account_index(&root, &account_hash, &key)
		.map_err(|_| http::StatusCode::INTERNAL_SERVER_ERROR)?;
	let token_hash = identifier_hash(token);
	let position = index
		.entries
		.iter()
		.position(|entry| {
			entry.cache_token_hash.as_deref() == Some(&token_hash)
		})
		.ok_or(http::StatusCode::NOT_FOUND)?;
	let mut entry =
		load_record(&root, &account_hash, &index.entries[position], &key)
			.map_err(|_| http::StatusCode::GONE)?;
	let file_name = entry.file_name.as_deref().ok_or(http::StatusCode::GONE)?;
	let content_type = entry
		.content_type
		.as_deref()
		.ok_or(http::StatusCode::GONE)?
		.to_owned();
	let total = entry.byte_length.ok_or(http::StatusCode::GONE)?;
	let range = parse_range(request.headers().get(http::header::RANGE), total)?;
	let body = if request.method() == http::Method::HEAD {
		Vec::new()
	} else {
		read_encrypted_range(
			&root.join(&account_hash).join(file_name),
			&key,
			&direct_media_aad(
				&account_hash,
				&identifier_hash(&entry.conversation_id),
				&identifier_hash(&entry.peer_profile_id),
				&identifier_hash(&entry.message_id),
				&identifier_hash(&entry.media_id),
				&content_type,
			),
			range,
			MEDIA_MAGIC,
		)
		.map_err(|_| http::StatusCode::GONE)?
	};
	entry.last_accessed_ms = now_ms();
	let record_file = index.entries[position].record_file.clone();
	index.entries[position] = reference_for(&entry, record_file);
	let _ = save_record(
		&root,
		&account_hash,
		&index.entries[position],
		&key,
		&entry,
	);
	let _ = save_account_index(&root, &account_hash, &key, &index);
	build_response(request.method(), &content_type, total, range, body)
}

fn build_response(
	method: &http::Method,
	content_type: &str,
	total: u64,
	range: Option<(u64, u64)>,
	body: Vec<u8>,
) -> Result<http::Response<Vec<u8>>, http::StatusCode> {
	let (start, end) = range.unwrap_or((0, total.saturating_sub(1)));
	let length = if method == http::Method::HEAD && range.is_none() {
		total
	} else {
		end - start + 1
	};
	let mut builder = http::Response::builder()
		.status(if range.is_some() {
			http::StatusCode::PARTIAL_CONTENT
		} else {
			http::StatusCode::OK
		})
		.header(http::header::CONTENT_TYPE, content_type)
		.header(http::header::ACCEPT_RANGES, "bytes")
		.header(http::header::CACHE_CONTROL, "no-store")
		.header(http::header::CONTENT_LENGTH, length);
	if range.is_some() {
		builder = builder.header(
			http::header::CONTENT_RANGE,
			format!("bytes {start}-{end}/{total}"),
		);
	}
	builder
		.body(body)
		.map_err(|_| http::StatusCode::INTERNAL_SERVER_ERROR)
}

fn downloader() -> Result<reqwest::Client, AppError> {
	reqwest::Client::builder()
		.redirect(reqwest::redirect::Policy::custom(|attempt| {
			if attempt.previous().len() >= 5 {
				return attempt.error("too many redirects");
			}
			if cdn_host_allowed(attempt.url()) {
				attempt.follow()
			} else {
				attempt.stop()
			}
		}))
		.build()
		.map_err(|_| cache_error("could not initialize media downloader"))
}
fn validate_response(
	response: &reqwest::Response,
	expected: &str,
	maximum_bytes: u64,
) -> Result<String, AppError> {
	if !response.status().is_success() {
		return Err(cache_error("media download failed"));
	}
	if !cdn_host_allowed(response.url()) {
		return Err(cache_error("media redirect host is not allowed"));
	}
	if response
		.content_length()
		.is_some_and(|length| length > maximum_bytes)
	{
		return Err(cache_error("media exceeds maximumBytes"));
	}
	validate_response_content_type(
		expected,
		response
			.headers()
			.get(http::header::CONTENT_TYPE)
			.and_then(|value| value.to_str().ok()),
	)
}

fn validate_response_content_type(
	expected: &str,
	actual: Option<&str>,
) -> Result<String, AppError> {
	let actual = actual
		.and_then(|value| value.split(';').next())
		.map(str::trim)
		.filter(|value| !value.is_empty())
		.ok_or_else(|| cache_error("media content type is missing"))?;
	validate_content_type(actual)?;
	if !same_media_category(expected, actual) {
		return Err(cache_error("media content type does not match request"));
	}
	Ok(actual.to_ascii_lowercase())
}
fn validate_identity(
	account: &str,
	conversation: &str,
	peer: &str,
	message: &str,
	media: &str,
) -> Result<(), AppError> {
	for value in [account, conversation, peer, message, media] {
		validate_identifier(value)?;
	}
	Ok(())
}
fn validate_media_kind(kind: &str, message_type: &str) -> Result<(), AppError> {
	if !matches!(kind, "image" | "video") {
		return Err(cache_error("kind must be image or video"));
	}
	if !matches!(
		message_type,
		"Image"
			| "ExpiringImage"
			| "Video" | "PrivateVideo"
			| "NonExpiringVideo"
	) {
		return Err(cache_error("unsupported direct-media message type"));
	}
	Ok(())
}

fn validate_store_availability(
	availability: RemoteAvailability,
) -> Result<(), AppError> {
	if availability != RemoteAvailability::Available {
		Err(cache_error("unavailable media cannot be downloaded"))
	} else {
		Ok(())
	}
}

fn preserve_terminal_availability(
	current: RemoteAvailability,
	incoming: RemoteAvailability,
) -> RemoteAvailability {
	if incoming == RemoteAvailability::Retracted
		|| current == RemoteAvailability::Available
	{
		incoming
	} else {
		current
	}
}

fn decode_legacy_media(
	data_base64: &str,
	maximum_bytes: u64,
) -> Result<Vec<u8>, AppError> {
	let maximum_encoded = maximum_bytes
		.saturating_add(2)
		.saturating_div(3)
		.saturating_mul(4)
		.saturating_add(4);
	if data_base64.len() as u64 > maximum_encoded {
		return Err(cache_error("legacy media exceeds the cache limit"));
	}
	let bytes = STANDARD
		.decode(data_base64.as_bytes())
		.map_err(|_| cache_error("legacy media encoding is invalid"))?;
	if bytes.is_empty() || bytes.len() as u64 > maximum_bytes {
		return Err(cache_error("legacy media exceeds the cache limit"));
	}
	Ok(bytes)
}
fn cache_byte_limits(maximum_bytes: u64) -> Result<(u64, u64), AppError> {
	if maximum_bytes == 0 {
		return Err(cache_error("maximumBytes must be greater than zero"));
	}
	Ok((maximum_bytes, maximum_bytes.min(MAX_SINGLE_MEDIA_BYTES)))
}
fn ensure_active_account(account_id: &str) -> Result<(), AppError> {
	let session = AuthStorage::get_session()?.ok_or_else(|| {
		cache_error("direct-media cache requires an active account")
	})?;
	if session.profile_id == account_id {
		Ok(())
	} else {
		Err(cache_error(
			"direct-media cache account does not match active account",
		))
	}
}
fn cache_root(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
	app.path()
		.app_data_dir()
		.map(|path| path.join(CACHE_DIR))
		.map_err(|_| {
			cache_error("could not resolve direct-media cache directory")
		})
}
fn direct_media_aad(
	account: &str,
	conversation: &str,
	peer: &str,
	message: &str,
	media: &str,
	content_type: &str,
) -> Vec<u8> {
	aad_prefix(
		"direct-media-v1",
		&[account, conversation, peer, message, media, content_type],
	)
}

#[cfg(test)]
fn read_exact_entry_media(
	account_dir: &Path,
	account_hash: &str,
	key: &[u8; 32],
	entry: &DirectMediaEntry,
) -> Result<Vec<u8>, AppError> {
	let file_name = entry
		.file_name
		.as_deref()
		.ok_or_else(|| cache_error("cached media file is missing"))?;
	let content_type = entry
		.content_type
		.as_deref()
		.ok_or_else(|| cache_error("cached media content type is missing"))?;
	let expected_length = entry
		.byte_length
		.ok_or_else(|| cache_error("cached media length is missing"))?;
	let bytes = read_encrypted_range(
		&account_dir.join(file_name),
		key,
		&direct_media_aad(
			account_hash,
			&identifier_hash(&entry.conversation_id),
			&identifier_hash(&entry.peer_profile_id),
			&identifier_hash(&entry.message_id),
			&identifier_hash(&entry.media_id),
			content_type,
		),
		None,
		MEDIA_MAGIC,
	)?;
	if bytes.len() as u64 != expected_length {
		return Err(cache_error(
			"cached media length does not match its record",
		));
	}
	Ok(bytes)
}

fn probe_verified_entry_media(
	account_dir: &Path,
	account_hash: &str,
	key: &[u8; 32],
	entry: &DirectMediaEntry,
) -> Result<(), AppError> {
	let file_name = entry
		.file_name
		.as_deref()
		.ok_or_else(|| cache_error("cached media file is missing"))?;
	let content_type = entry
		.content_type
		.as_deref()
		.ok_or_else(|| cache_error("cached media content type is missing"))?;
	let expected_length = entry
		.byte_length
		.filter(|length| *length > 0)
		.ok_or_else(|| cache_error("cached media length is missing"))?;
	let path = account_dir.join(file_name);
	if encrypted_plaintext_length(&path, MEDIA_MAGIC)? != expected_length {
		return Err(cache_error(
			"cached media length does not match its record",
		));
	}
	let aad = direct_media_aad(
		account_hash,
		&identifier_hash(&entry.conversation_id),
		&identifier_hash(&entry.peer_profile_id),
		&identifier_hash(&entry.message_id),
		&identifier_hash(&entry.media_id),
		content_type,
	);
	let first =
		read_encrypted_range(&path, key, &aad, Some((0, 0)), MEDIA_MAGIC)?;
	let last_offset = expected_length - 1;
	let last = read_encrypted_range(
		&path,
		key,
		&aad,
		Some((last_offset, last_offset)),
		MEDIA_MAGIC,
	)?;
	if first.len() != 1 || last.len() != 1 {
		return Err(cache_error(
			"cached media length does not match its record",
		));
	}
	Ok(())
}
fn index_aad(account_hash: &str) -> Vec<u8> {
	aad_prefix("direct-media-index-v1", &[account_hash])
}

fn record_aad(account_hash: &str, identity_hash: &str) -> Vec<u8> {
	aad_prefix("direct-media-record-v1", &[account_hash, identity_hash])
}

fn composite_identity_hash(
	conversation: &str,
	peer: &str,
	message: &str,
	media: &str,
) -> String {
	identifier_hash(&format!("{conversation}\0{peer}\0{message}\0{media}"))
}

fn load_record(
	root: &Path,
	account_hash: &str,
	reference: &IndexEntry,
	key: &[u8; 32],
) -> Result<DirectMediaEntry, AppError> {
	let bytes = read_encrypted_range(
		&root.join(account_hash).join(&reference.record_file),
		key,
		&record_aad(account_hash, &reference.identity_hash),
		None,
		INDEX_MAGIC,
	)?;
	serde_json::from_slice(&bytes)
		.map_err(|_| cache_error("direct-media history record is invalid"))
}

fn save_record(
	root: &Path,
	account_hash: &str,
	reference: &IndexEntry,
	key: &[u8; 32],
	record: &DirectMediaEntry,
) -> Result<(), AppError> {
	fs::create_dir_all(root.join(account_hash)).map_err(|_| {
		cache_error("could not create direct-media cache directory")
	})?;
	let bytes = serde_json::to_vec(record).map_err(|_| {
		cache_error("could not encode direct-media history record")
	})?;
	write_encrypted_atomic(
		&root.join(account_hash).join(&reference.record_file),
		&bytes,
		key,
		&record_aad(account_hash, &reference.identity_hash),
		INDEX_MAGIC,
	)
}

fn reference_for(record: &DirectMediaEntry, record_file: String) -> IndexEntry {
	IndexEntry {
		identity_hash: composite_identity_hash(
			&record.conversation_id,
			&record.peer_profile_id,
			&record.message_id,
			&record.media_id,
		),
		conversation_hash: identifier_hash(&record.conversation_id),
		peer_hash: identifier_hash(&record.peer_profile_id),
		record_file,
		sent_at: record.sent_at,
		last_accessed_ms: record.last_accessed_ms,
		byte_length: record.byte_length,
		cache_availability: record.cache_availability,
		cache_token_hash: record.cache_token.as_deref().map(identifier_hash),
	}
}
fn load_account_index(
	root: &Path,
	account_hash: &str,
	key: &[u8; 32],
) -> Result<AccountIndex, AppError> {
	let path = root.join(account_hash).join(INDEX_FILE);
	if !path.is_file() {
		return Ok(AccountIndex::default());
	}
	let bytes = read_encrypted_range(
		&path,
		key,
		&index_aad(account_hash),
		None,
		INDEX_MAGIC,
	)?;
	serde_json::from_slice(&bytes)
		.map_err(|_| cache_error("direct-media history index is invalid"))
}
fn save_account_index(
	root: &Path,
	account_hash: &str,
	key: &[u8; 32],
	index: &AccountIndex,
) -> Result<(), AppError> {
	let dir = root.join(account_hash);
	fs::create_dir_all(&dir).map_err(|_| {
		cache_error("could not create direct-media cache directory")
	})?;
	let bytes = serde_json::to_vec(index).map_err(|_| {
		cache_error("could not encode direct-media history index")
	})?;
	write_encrypted_atomic(
		&dir.join(INDEX_FILE),
		&bytes,
		key,
		&index_aad(account_hash),
		INDEX_MAGIC,
	)
}

fn repair_persisted_records(app: &tauri::AppHandle) -> Result<(), AppError> {
	let root = cache_root(app)?;
	for account_hash in account_hashes(&root)? {
		let Ok(key) = load_key(KEY_SERVICE, &account_hash) else {
			continue;
		};
		repair_account_records(&root, &account_hash, &key)?;
	}
	Ok(())
}

fn repair_account_records(
	root: &Path,
	account_hash: &str,
	key: &[u8; 32],
) -> Result<(), AppError> {
	let mut index = load_account_index(root, account_hash, key)?;
	let account_dir = root.join(account_hash);
	let orphan_candidates = fs::read_dir(&account_dir)
		.into_iter()
		.flatten()
		.filter_map(Result::ok)
		.filter_map(|entry| {
			let name = entry.file_name().to_str()?.to_owned();
			name.ends_with(".ogdm").then_some(name)
		})
		.collect::<Vec<_>>();
	let mut referenced_media = HashSet::new();
	let mut changed = false;
	let mut position = 0;
	while position < index.entries.len() {
		let reference = index.entries[position].clone();
		let mut record = match load_record(root, account_hash, &reference, key)
		{
			Ok(record) => record,
			Err(_) => {
				let removed = index.entries.remove(position);
				let _ = fs::remove_file(account_dir.join(removed.record_file));
				changed = true;
				continue;
			}
		};
		let mut valid_file = record.file_name.as_deref().filter(|file| {
			Path::new(file).file_name().and_then(|value| value.to_str())
				== Some(*file)
				&& file.ends_with(".ogdm")
				&& account_dir.join(file).is_file()
				&& probe_verified_entry_media(
					&account_dir,
					account_hash,
					key,
					&record,
				)
				.is_ok()
		});
		let recovered_file = if valid_file.is_none() {
			orphan_candidates.iter().find(|candidate| {
				if referenced_media.contains(*candidate) {
					return false;
				}
				let mut candidate_record = record.clone();
				candidate_record.file_name = Some((*candidate).clone());
				probe_verified_entry_media(
					&account_dir,
					account_hash,
					key,
					&candidate_record,
				)
				.is_ok()
			})
		} else {
			None
		};
		if let Some(recovered) = recovered_file {
			record.file_name = Some(recovered.clone());
			let updated = reference_for(&record, reference.record_file.clone());
			save_record(root, account_hash, &updated, key, &record)?;
			index.entries[position] = updated;
			referenced_media.insert(recovered.clone());
			valid_file = record.file_name.as_deref();
			changed = true;
		}
		if record.cache_availability == CacheAvailability::Cached {
			if let Some(file) = valid_file {
				referenced_media.insert(file.to_owned());
			} else if record.remote_availability
				== RemoteAvailability::Retracted
			{
				let removed = index.entries.remove(position);
				let _ = fs::remove_file(account_dir.join(removed.record_file));
				changed = true;
				continue;
			} else {
				record.file_name = None;
				record.byte_length = None;
				record.content_type = None;
				record.cache_token = None;
				record.cache_availability = CacheAvailability::Evicted;
				let updated =
					reference_for(&record, reference.record_file.clone());
				save_record(root, account_hash, &updated, key, &record)?;
				index.entries[position] = updated;
				changed = true;
			}
		} else if let Some(file) = record.file_name.take() {
			let _ = fs::remove_file(account_dir.join(file));
			record.byte_length = None;
			record.content_type = None;
			record.cache_token = None;
			let updated = reference_for(&record, reference.record_file.clone());
			save_record(root, account_hash, &updated, key, &record)?;
			index.entries[position] = updated;
			changed = true;
		}
		position += 1;
	}
	if changed {
		save_account_index(root, account_hash, key, &index)?;
	}
	for candidate in orphan_candidates {
		if !referenced_media.contains(&candidate) {
			let _ = fs::remove_file(account_dir.join(candidate));
		}
	}
	let referenced_records = index
		.entries
		.iter()
		.map(|entry| entry.record_file.as_str())
		.collect::<HashSet<_>>();
	for candidate in fs::read_dir(&account_dir)
		.into_iter()
		.flatten()
		.filter_map(Result::ok)
	{
		let Some(name) = candidate.file_name().to_str().map(str::to_owned)
		else {
			continue;
		};
		if name.ends_with(".ogdr")
			&& !referenced_records.contains(name.as_str())
		{
			let _ = fs::remove_file(candidate.path());
		}
	}
	Ok(())
}
#[cfg(test)]
fn matches_identity(
	entry: &DirectMediaEntry,
	conversation: &str,
	peer: &str,
	message: &str,
	media: &str,
) -> bool {
	entry.conversation_id == conversation
		&& entry.peer_profile_id == peer
		&& entry.message_id == message
		&& entry.media_id == media
}
#[cfg(test)]
fn apply_remote_availability(
	entries: &mut Vec<DirectMediaEntry>,
	conversation: &str,
	peer: &str,
	message: &str,
	media: &str,
	availability: RemoteAvailability,
) {
	if availability == RemoteAvailability::Retracted {
		entries.retain(|entry| {
			!matches_identity(entry, conversation, peer, message, media)
				|| entry.cache_availability == CacheAvailability::Cached
		});
	}
	if let Some(entry) = entries.iter_mut().find(|entry| {
		matches_identity(entry, conversation, peer, message, media)
	}) {
		entry.remote_availability = availability;
	}
}

#[cfg(test)]
fn evict_entry(
	entries: &mut Vec<DirectMediaEntry>,
	position: usize,
) -> Option<String> {
	if position >= entries.len() {
		return None;
	}
	if entries[position].remote_availability == RemoteAvailability::Retracted {
		return entries.remove(position).file_name;
	}
	let entry = &mut entries[position];
	let file = entry.file_name.take();
	entry.byte_length = None;
	entry.content_type = None;
	entry.cache_token = None;
	entry.cache_availability = CacheAvailability::Evicted;
	file
}
fn not_found() -> DirectMediaLookup {
	DirectMediaLookup {
		found: false,
		token: None,
		protocol_url: None,
		byte_length: None,
		content_type: None,
	}
}
#[cfg(test)]
fn page_entries(
	mut entries: Vec<DirectMediaEntry>,
	cursor: Option<&str>,
	page_size: usize,
) -> Result<DirectMediaPage, AppError> {
	let page_size = page_size.clamp(1, MAX_PAGE_SIZE);
	entries.sort_by(|left, right| {
		right
			.sent_at
			.cmp(&left.sent_at)
			.then_with(|| right.message_id.cmp(&left.message_id))
	});
	let total_count = entries.len() as u64;
	let offset = cursor.map(decode_cursor).transpose()?.unwrap_or(0);
	if offset > entries.len() {
		return Err(cache_error("invalid direct-media cursor"));
	}
	let items = entries
		.into_iter()
		.skip(offset)
		.take(page_size)
		.collect::<Vec<_>>();
	let next = offset + items.len();
	Ok(DirectMediaPage {
		items,
		next_cursor: (next < total_count as usize).then(|| encode_cursor(next)),
		total_count,
	})
}

fn page_references(
	mut entries: Vec<IndexEntry>,
	cursor: Option<&str>,
	page_size: usize,
) -> Result<(Vec<IndexEntry>, Option<String>, u64), AppError> {
	let page_size = page_size.clamp(1, MAX_PAGE_SIZE);
	entries.sort_by(|left, right| {
		right
			.sent_at
			.cmp(&left.sent_at)
			.then_with(|| right.identity_hash.cmp(&left.identity_hash))
	});
	let total_count = entries.len() as u64;
	let offset = cursor.map(decode_cursor).transpose()?.unwrap_or(0);
	if offset > entries.len() {
		return Err(cache_error("invalid direct-media cursor"));
	}
	let items = entries
		.into_iter()
		.skip(offset)
		.take(page_size)
		.collect::<Vec<_>>();
	let next = offset + items.len();
	Ok((
		items,
		(next < total_count as usize).then(|| encode_cursor(next)),
		total_count,
	))
}
fn encode_cursor(offset: usize) -> String {
	URL_SAFE_NO_PAD.encode((offset as u64).to_be_bytes())
}
fn decode_cursor(cursor: &str) -> Result<usize, AppError> {
	let bytes = URL_SAFE_NO_PAD
		.decode(cursor)
		.map_err(|_| cache_error("invalid direct-media cursor"))?;
	let array: [u8; 8] = bytes
		.try_into()
		.map_err(|_| cache_error("invalid direct-media cursor"))?;
	usize::try_from(u64::from_be_bytes(array))
		.map_err(|_| cache_error("invalid direct-media cursor"))
}
fn account_hashes(root: &Path) -> Result<Vec<String>, AppError> {
	let iter = match fs::read_dir(root) {
		Ok(iter) => iter,
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
			return Ok(Vec::new())
		}
		Err(_) => {
			return Err(cache_error("could not enumerate direct-media cache"))
		}
	};
	Ok(iter
		.filter_map(Result::ok)
		.filter(|entry| entry.path().is_dir())
		.filter_map(|entry| entry.file_name().into_string().ok())
		.collect())
}
fn stats_locked(root: &Path) -> Result<DirectMediaCacheStats, AppError> {
	stats_for_hashes(root, account_hashes(root)?)
}
fn stats_for_hashes(
	root: &Path,
	hashes: Vec<String>,
) -> Result<DirectMediaCacheStats, AppError> {
	let mut stats = DirectMediaCacheStats {
		byte_length: 0,
		cached_count: 0,
		history_count: 0,
		account_count: 0,
		cache_epoch: CACHE_EPOCH.load(Ordering::Acquire),
	};
	for hash in hashes {
		let Ok(key) = load_key(KEY_SERVICE, &hash) else {
			continue;
		};
		let index = load_account_index(root, &hash, &key)?;
		stats.account_count += 1;
		stats.history_count += index.entries.len() as u64;
		stats.cached_count += index
			.entries
			.iter()
			.filter(|entry| {
				entry.cache_availability == CacheAvailability::Cached
			})
			.count() as u64;
		stats.byte_length += index
			.entries
			.iter()
			.filter_map(|entry| entry.byte_length)
			.sum::<u64>();
	}
	Ok(stats)
}
fn cache_error(message: &str) -> AppError {
	media_error(message)
}

fn scope_matches(
	scopes: &HashMap<String, ActiveScope>,
	account_hash: &str,
	conversation_id: &str,
	peer_profile_id: &str,
	scope_token: &str,
) -> bool {
	scopes.get(account_hash).is_some_and(|current| {
		current.token == scope_token
			&& current.conversation_hash == identifier_hash(conversation_id)
			&& current.peer_hash == identifier_hash(peer_profile_id)
	})
}

async fn scope_is_current(
	account_hash: &str,
	conversation_id: &str,
	peer_profile_id: &str,
	scope_token: &str,
) -> bool {
	let scopes = ACTIVE_SCOPES.lock().await;
	scope_matches(
		&scopes,
		account_hash,
		conversation_id,
		peer_profile_id,
		scope_token,
	)
}

async fn ensure_scope_current(
	account_hash: &str,
	conversation_id: &str,
	peer_profile_id: &str,
	scope_token: &str,
) -> Result<(), AppError> {
	if scope_is_current(
		account_hash,
		conversation_id,
		peer_profile_id,
		scope_token,
	)
	.await
	{
		Ok(())
	} else {
		Err(cache_error("direct-media cache scope changed"))
	}
}

#[cfg(test)]
impl DirectMediaEntry {
	fn test(message_id: &str, sent_at: u64) -> Self {
		Self {
			account_profile_id: "account".into(),
			conversation_id: "conversation".into(),
			peer_profile_id: "peer".into(),
			message_id: message_id.into(),
			media_id: format!("media-{message_id}"),
			kind: "image".into(),
			message_type: "Image".into(),
			sent_at,
			remote_availability: RemoteAvailability::Available,
			cache_availability: CacheAvailability::NotCached,
			cache_token: None,
			content_type: None,
			byte_length: None,
			file_name: None,
			last_accessed_ms: sent_at,
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn temp_dir() -> PathBuf {
		let path = std::env::temp_dir().join(format!(
			"open-grind-direct-media-cache-test-{}",
			random_token()
		));
		fs::create_dir_all(&path).unwrap();
		path
	}
	#[test]
	fn aad_binds_every_direct_media_identity_dimension() {
		let base = direct_media_aad(
			"account",
			"conversation",
			"peer",
			"message",
			"media",
			"image/jpeg",
		);
		assert_ne!(
			base,
			direct_media_aad(
				"other",
				"conversation",
				"peer",
				"message",
				"media",
				"image/jpeg"
			)
		);
		assert_ne!(
			base,
			direct_media_aad(
				"account",
				"other",
				"peer",
				"message",
				"media",
				"image/jpeg"
			)
		);
		assert_ne!(
			base,
			direct_media_aad(
				"account",
				"conversation",
				"other",
				"message",
				"media",
				"image/jpeg"
			)
		);
		assert_ne!(
			base,
			direct_media_aad(
				"account",
				"conversation",
				"peer",
				"other",
				"media",
				"image/jpeg"
			)
		);
		assert_ne!(
			base,
			direct_media_aad(
				"account",
				"conversation",
				"peer",
				"message",
				"other",
				"image/jpeg"
			)
		);
	}
	#[test]
	fn list_page_is_stable_newest_first_and_cursor_is_opaque() {
		let entries = vec![
			DirectMediaEntry::test("older", 10),
			DirectMediaEntry::test("same-b", 20),
			DirectMediaEntry::test("same-a", 20),
		];
		let first = page_entries(entries.clone(), None, 2).unwrap();
		assert_eq!(
			first
				.items
				.iter()
				.map(|item| item.message_id.as_str())
				.collect::<Vec<_>>(),
			vec!["same-b", "same-a"]
		);
		let cursor = first.next_cursor.expect("next cursor");
		assert!(!cursor.contains("same-a"));
		let second = page_entries(entries, Some(&cursor), 2).unwrap();
		assert_eq!(
			second
				.items
				.iter()
				.map(|item| item.message_id.as_str())
				.collect::<Vec<_>>(),
			vec!["older"]
		);
	}
	#[test]
	fn trim_evicts_bytes_but_preserves_history_metadata() {
		let mut old = DirectMediaEntry::test("old", 1);
		old.byte_length = Some(40);
		old.file_name = Some("old.ogdm".into());
		old.cache_availability = CacheAvailability::Cached;
		let mut new = DirectMediaEntry::test("new", 9);
		new.byte_length = Some(50);
		new.file_name = Some("new.ogdm".into());
		new.cache_availability = CacheAvailability::Cached;
		let mut entries = vec![old, new];
		let files = {
			let mut total: u64 =
				entries.iter().filter_map(|entry| entry.byte_length).sum();
			let mut files = Vec::new();
			for entry in &mut entries {
				if total <= 50 {
					break;
				}
				total -= entry.byte_length.unwrap_or(0);
				files.push(entry.file_name.take().unwrap());
				entry.byte_length = None;
				entry.cache_availability = CacheAvailability::Evicted;
			}
			files
		};
		assert_eq!(files, vec!["old.ogdm"]);
		assert_eq!(entries.len(), 2);
		assert_eq!(entries[0].cache_availability, CacheAvailability::Evicted);
		assert_eq!(entries[1].cache_availability, CacheAvailability::Cached);
	}

	#[test]
	fn lru_selection_enforces_the_total_byte_limit() {
		let selected = lru_eviction_targets(
			vec![
				(30, "account".to_owned(), 2, 40),
				(10, "account".to_owned(), 0, 25),
				(20, "account".to_owned(), 1, 35),
			],
			50,
		);
		assert_eq!(
			selected,
			HashSet::from([
				("account".to_owned(), 0),
				("account".to_owned(), 1),
			])
		);
	}

	#[test]
	fn configured_total_cache_limit_is_not_capped_by_the_per_item_limit() {
		let configured = 500 * 1024 * 1024;
		let (total, per_item) = cache_byte_limits(configured).unwrap();
		assert_eq!(total, configured);
		assert_eq!(per_item, MAX_SINGLE_MEDIA_BYTES);
	}

	#[test]
	fn stale_history_upserts_never_regress_terminal_availability() {
		assert_eq!(
			preserve_terminal_availability(
				RemoteAvailability::ViewsExhausted,
				RemoteAvailability::Available,
			),
			RemoteAvailability::ViewsExhausted,
		);
		assert_eq!(
			preserve_terminal_availability(
				RemoteAvailability::ViewsExhausted,
				RemoteAvailability::Retracted,
			),
			RemoteAvailability::Retracted,
		);
		assert_eq!(
			preserve_terminal_availability(
				RemoteAvailability::Available,
				RemoteAvailability::Expired,
			),
			RemoteAvailability::Expired,
		);
	}
	#[test]
	fn page_size_is_capped_at_sixty_for_large_history() {
		let entries = (0..1000)
			.map(|value| {
				DirectMediaEntry::test(&format!("message-{value:04}"), value)
			})
			.collect();
		let page = page_entries(entries, None, 1000).unwrap();
		assert_eq!(page.items.len(), 60);
		assert_eq!(page.total_count, 1000);
		assert!(page.next_cursor.is_some());
	}

	#[test]
	fn history_metadata_is_encrypted_at_rest() {
		let root = temp_dir();
		let account_hash = identifier_hash("account");
		let key = [41_u8; 32];
		let record = DirectMediaEntry::test("private-message", 1);
		let reference = reference_for(&record, "record.ogdr".into());
		save_record(&root, &account_hash, &reference, &key, &record).unwrap();
		let index = AccountIndex {
			entries: vec![reference],
		};
		save_account_index(&root, &account_hash, &key, &index).unwrap();
		let stored =
			fs::read(root.join(&account_hash).join(INDEX_FILE)).unwrap();
		assert!(!stored
			.windows(b"private-message".len())
			.any(|window| window == b"private-message"));
		let loaded = load_account_index(&root, &account_hash, &key).unwrap();
		let loaded_record =
			load_record(&root, &account_hash, &loaded.entries[0], &key)
				.unwrap();
		assert_eq!(loaded_record.message_id, "private-message");
		fs::remove_dir_all(root).unwrap();
	}

	#[test]
	fn encrypted_records_preserve_their_opaque_media_file_across_restart() {
		let root = temp_dir();
		let account_hash = identifier_hash("account");
		let key = [42_u8; 32];
		let mut record = DirectMediaEntry::test("message", 1);
		record.cache_availability = CacheAvailability::Cached;
		record.cache_token = Some("opaque-token".into());
		record.content_type = Some("image/jpeg".into());
		record.byte_length = Some(b"legacy bytes".len() as u64);
		record.file_name = Some("opaque-media.ogdm".into());
		let reference = reference_for(&record, "record.ogdr".into());
		save_record(&root, &account_hash, &reference, &key, &record).unwrap();

		let loaded =
			load_record(&root, &account_hash, &reference, &key).unwrap();
		assert_eq!(loaded.file_name.as_deref(), Some("opaque-media.ogdm"));
		fs::remove_dir_all(root).unwrap();
	}

	#[test]
	fn migration_recovers_a_legacy_missing_filename_by_authenticated_aad() {
		let root = temp_dir();
		let account_hash = identifier_hash("account");
		let account_dir = root.join(&account_hash);
		fs::create_dir_all(&account_dir).unwrap();
		let key = [43_u8; 32];
		let mut record = DirectMediaEntry::test("message", 1);
		record.cache_availability = CacheAvailability::Cached;
		record.cache_token = Some("opaque-token".into());
		record.content_type = Some("image/jpeg".into());
		record.byte_length = Some(b"legacy bytes".len() as u64);
		record.file_name = None;
		let reference = reference_for(&record, "record.ogdr".into());
		save_record(&root, &account_hash, &reference, &key, &record).unwrap();
		save_account_index(
			&root,
			&account_hash,
			&key,
			&AccountIndex {
				entries: vec![reference],
			},
		)
		.unwrap();
		write_encrypted_atomic(
			&account_dir.join("orphan.ogdm"),
			b"legacy bytes",
			&key,
			&direct_media_aad(
				&account_hash,
				&identifier_hash("conversation"),
				&identifier_hash("peer"),
				&identifier_hash("message"),
				&identifier_hash("media-message"),
				"image/jpeg",
			),
			MEDIA_MAGIC,
		)
		.unwrap();
		write_encrypted_atomic(
			&account_dir.join("true-orphan.ogdm"),
			b"unreferenced private bytes",
			&key,
			b"unreferenced",
			MEDIA_MAGIC,
		)
		.unwrap();
		fs::write(account_dir.join("true-orphan.ogdr"), b"orphan record")
			.unwrap();

		repair_account_records(&root, &account_hash, &key).unwrap();
		let index = load_account_index(&root, &account_hash, &key).unwrap();
		let repaired =
			load_record(&root, &account_hash, &index.entries[0], &key).unwrap();
		assert_eq!(repaired.cache_availability, CacheAvailability::Cached);
		assert_eq!(repaired.file_name.as_deref(), Some("orphan.ogdm"));
		assert!(account_dir.join("orphan.ogdm").exists());
		assert!(!account_dir.join("true-orphan.ogdm").exists());
		assert!(!account_dir.join("true-orphan.ogdr").exists());
		fs::remove_dir_all(root).unwrap();
	}

	#[test]
	fn verified_media_read_authenticates_exact_bytes_and_rejects_corruption() {
		let root = temp_dir();
		let account_hash = identifier_hash("account");
		let account_dir = root.join(&account_hash);
		fs::create_dir_all(&account_dir).unwrap();
		let key = [44_u8; 32];
		let expected = b"exact beta4 bytes";
		let mut record = DirectMediaEntry::test("message", 1);
		record.cache_availability = CacheAvailability::Cached;
		record.cache_token = Some("opaque-token".into());
		record.content_type = Some("image/jpeg".into());
		record.byte_length = Some(expected.len() as u64);
		record.file_name = Some("verified.ogdm".into());
		let path = account_dir.join("verified.ogdm");
		write_encrypted_atomic(
			&path,
			expected,
			&key,
			&direct_media_aad(
				&account_hash,
				&identifier_hash("conversation"),
				&identifier_hash("peer"),
				&identifier_hash("message"),
				&identifier_hash("media-message"),
				"image/jpeg",
			),
			MEDIA_MAGIC,
		)
		.unwrap();
		assert_eq!(
			read_exact_entry_media(&account_dir, &account_hash, &key, &record)
				.unwrap(),
			expected,
		);
		assert!(probe_verified_entry_media(
			&account_dir,
			&account_hash,
			&key,
			&record
		)
		.is_ok());
		write_encrypted_atomic(
			&path,
			b"exact beta4 bytes with an unexpected suffix",
			&key,
			&direct_media_aad(
				&account_hash,
				&identifier_hash("conversation"),
				&identifier_hash("peer"),
				&identifier_hash("message"),
				&identifier_hash("media-message"),
				"image/jpeg",
			),
			MEDIA_MAGIC,
		)
		.unwrap();
		assert!(probe_verified_entry_media(
			&account_dir,
			&account_hash,
			&key,
			&record
		)
		.is_err());
		write_encrypted_atomic(
			&path,
			expected,
			&key,
			&direct_media_aad(
				&account_hash,
				&identifier_hash("conversation"),
				&identifier_hash("peer"),
				&identifier_hash("message"),
				&identifier_hash("media-message"),
				"image/jpeg",
			),
			MEDIA_MAGIC,
		)
		.unwrap();
		let mut corrupted = fs::read(&path).unwrap();
		corrupted.pop();
		fs::write(&path, corrupted).unwrap();
		assert!(read_exact_entry_media(
			&account_dir,
			&account_hash,
			&key,
			&record
		)
		.is_err());
		fs::remove_dir_all(root).unwrap();
	}

	#[test]
	fn uncached_retraction_is_not_retained_and_cached_retraction_survives() {
		let mut entries = vec![DirectMediaEntry::test("uncached", 1)];
		apply_remote_availability(
			&mut entries,
			"conversation",
			"peer",
			"uncached",
			"media-uncached",
			RemoteAvailability::Retracted,
		);
		assert!(entries.is_empty());

		let mut cached = DirectMediaEntry::test("cached", 2);
		cached.cache_availability = CacheAvailability::Cached;
		cached.file_name = Some("cached.ogdm".into());
		let mut entries = vec![cached];
		apply_remote_availability(
			&mut entries,
			"conversation",
			"peer",
			"cached",
			"media-cached",
			RemoteAvailability::Retracted,
		);
		assert_eq!(
			entries[0].remote_availability,
			RemoteAvailability::Retracted
		);
	}

	#[test]
	fn evicting_retracted_bytes_removes_retracted_only_history() {
		let mut entry = DirectMediaEntry::test("cached", 1);
		entry.remote_availability = RemoteAvailability::Retracted;
		entry.cache_availability = CacheAvailability::Cached;
		entry.byte_length = Some(10);
		entry.file_name = Some("cached.ogdm".into());
		let mut entries = vec![entry];
		evict_entry(&mut entries, 0);
		assert!(entries.is_empty());
	}

	#[test]
	fn retracted_media_can_never_start_a_network_store() {
		assert!(
			validate_store_availability(RemoteAvailability::Retracted).is_err()
		);
		assert!(
			validate_store_availability(RemoteAvailability::Expired).is_err()
		);
		assert!(validate_store_availability(
			RemoteAvailability::ViewsExhausted
		)
		.is_err());
		assert!(
			validate_store_availability(RemoteAvailability::Available).is_ok()
		);
	}

	#[test]
	fn downloader_requires_matching_image_or_video_content_type() {
		assert_eq!(
			validate_response_content_type(
				"image/*",
				Some("image/webp; charset=binary")
			)
			.unwrap(),
			"image/webp"
		);
		assert!(validate_response_content_type(
			"video/mp4",
			Some("image/jpeg")
		)
		.is_err());
		assert!(validate_response_content_type("image/jpeg", None).is_err());
	}

	#[test]
	fn legacy_import_preserves_exact_bytes_and_rejects_predecode_oversize() {
		assert_eq!(
			decode_legacy_media("AQIDBA==", 4).unwrap(),
			vec![1, 2, 3, 4]
		);
		assert!(decode_legacy_media("AQIDBA==", 3).is_err());
		assert!(decode_legacy_media("not-base64", 32).is_err());
	}

	#[test]
	fn scope_tokens_are_exact_and_account_partitioned() {
		let scopes = HashMap::from([(
			"account-a".to_owned(),
			ActiveScope {
				token: "scope-a".to_owned(),
				conversation_hash: identifier_hash("conversation-a"),
				peer_hash: identifier_hash("peer-a"),
			},
		)]);
		assert!(scope_matches(
			&scopes,
			"account-a",
			"conversation-a",
			"peer-a",
			"scope-a"
		));
		assert!(!scope_matches(
			&scopes,
			"account-a",
			"conversation-b",
			"peer-a",
			"scope-a"
		));
		assert!(!scope_matches(
			&scopes,
			"account-a",
			"conversation-a",
			"peer-b",
			"scope-a"
		));
		assert!(!scope_matches(
			&scopes,
			"account-a",
			"conversation-a",
			"peer-a",
			"scope-b"
		));
		assert!(!scope_matches(
			&scopes,
			"account-b",
			"conversation-a",
			"peer-a",
			"scope-a"
		));
	}
}
