use std::{
	collections::{BTreeMap, HashMap, HashSet},
	fs,
	path::{Component, Path, PathBuf},
	sync::{
		atomic::{AtomicU64, Ordering},
		LazyLock,
	},
};

use aes_gcm::{
	aead::{Aead, KeyInit, Payload},
	Aes256Gcm, Nonce,
};
use base64::{
	engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
	Engine,
};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use tauri::{http, Manager};

use crate::{
	api::encrypted_media_store::{
		aad_prefix, cdn_host_allowed, delete_key, identifier_hash, load_key,
		load_or_create_key, media_error, now_ms, parse_range, protocol_url,
		random_token, read_encrypted_range, same_media_category,
		stream_encrypted_atomic, validate_cdn_url, validate_content_type,
		validate_identifier, write_encrypted_atomic,
	},
	error::AppError,
	storage::AuthStorage,
};

#[cfg(test)]
use crate::api::encrypted_media_store::CHUNK_SIZE;

const SCHEME: &str = "direct-media-cache";
const CACHE_DIR: &str = "direct-media-cache-v1";
const INDEX_FILE: &str = "history.ogdi";
const INDEX_SCHEMA_VERSION: u32 = 2;
const INDEX_V2_DIR: &str = "history-v2";
const MIGRATION_PARTITION_BATCH: usize = 8;
const MEDIA_MAGIC: &[u8; 8] = b"OGDMED01";
const INDEX_MAGIC: &[u8; 8] = b"OGDIDX01";
const KEY_SERVICE: &str = "open-grind-direct-media-cache";
const DEFAULT_PAGE_SIZE: usize = 60;
const MAX_PAGE_SIZE: usize = 60;
const MAX_SINGLE_MEDIA_BYTES: u64 = 128 * 1024 * 1024;
const ACCESS_WRITE_INTERVAL_MS: u64 = 60_000;
static CACHE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static CACHE_EPOCH: AtomicU64 = AtomicU64::new(0);
static ACCOUNT_GENERATIONS: LazyLock<std::sync::Mutex<HashMap<String, u64>>> =
	LazyLock::new(|| std::sync::Mutex::new(HashMap::new()));
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct AccountIndex {
	entries: Vec<IndexEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConversationIndexEnvelope {
	schema_version: u32,
	conversation_hash: String,
	entries: Vec<IndexEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DirectMediaCursor {
	version: u8,
	sent_at: u64,
	identity_hash: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct BatchJournalManifest {
	accounts: Vec<BatchJournalAccount>,
	backups: Vec<BatchJournalBackup>,
}

#[derive(Debug, Serialize, Deserialize)]
struct BatchJournalAccount {
	account_hash: String,
	baseline_record_files: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct BatchJournalBackup {
	target: String,
	backup: String,
	existed: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectMediaHistoryDelta {
	account_id: String,
	conversation_id: String,
	peer_profile_id: String,
	message_id: String,
	media_id: String,
	kind: String,
	message_type: String,
	sent_at: u64,
	remote_availability: RemoteAvailability,
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
	pub items: Vec<DirectMediaPageEntry>,
	pub next_cursor: Option<String>,
	pub total_count: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectMediaPageEntry {
	#[serde(flatten)]
	entry: DirectMediaEntry,
	protocol_url: Option<String>,
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
			if let Ok(root) = cache_root(app) {
				if recover_batch_journals(&root).is_err() {
					tracing::warn!(
						"direct-media batch recovery was incomplete"
					);
				}
			}
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
	direct_media_cache_upsert_batch(
		app,
		vec![DirectMediaHistoryDelta {
			account_id,
			conversation_id,
			peer_profile_id,
			message_id,
			media_id,
			kind,
			message_type,
			sent_at,
			remote_availability,
		}],
	)
	.await
}

#[tauri::command]
pub async fn direct_media_cache_upsert_batch(
	app: tauri::AppHandle,
	deltas: Vec<DirectMediaHistoryDelta>,
) -> Result<(), AppError> {
	if deltas.is_empty() {
		return Ok(());
	}
	for delta in &deltas {
		validate_identity(
			&delta.account_id,
			&delta.conversation_id,
			&delta.peer_profile_id,
			&delta.message_id,
			&delta.media_id,
		)?;
		validate_media_kind(&delta.kind, &delta.message_type)?;
		ensure_active_account(&delta.account_id)?;
	}
	let generations = deltas
		.iter()
		.map(|delta| {
			let hash = identifier_hash(&delta.account_id);
			let generation = account_generation(&hash);
			(hash, generation)
		})
		.collect::<HashMap<_, _>>();
	let root = cache_root(&app)?;
	let captured_epoch = CACHE_EPOCH.load(Ordering::Acquire);
	let _guard = CACHE_LOCK.lock().await;
	if CACHE_EPOCH.load(Ordering::Acquire) != captured_epoch {
		return Err(cache_error("direct-media cache changed"));
	}
	if generations
		.iter()
		.any(|(hash, generation)| account_generation(hash) != *generation)
	{
		return Err(cache_error("direct-media account cache changed"));
	}
	let mut by_partition: BTreeMap<
		(String, String),
		Vec<DirectMediaHistoryDelta>,
	> = BTreeMap::new();
	for delta in deltas {
		by_partition
			.entry((delta.account_id.clone(), delta.conversation_id.clone()))
			.or_default()
			.push(delta);
	}
	sort_batch_partitions(&mut by_partition);
	recover_batch_journals(&root)?;
	let journal = create_batch_journal(&root, &by_partition)?;
	let result = apply_batch_partitions(&root, by_partition);
	match result {
		Ok(()) => match commit_batch_journal(&journal) {
			Ok(()) => Ok(()),
			Err(error) => {
				let _ = rollback_batch_journal(&journal);
				Err(error)
			}
		},
		Err(error) => {
			let _ = rollback_batch_journal(&journal);
			Err(error)
		}
	}
}

fn sort_batch_partitions(
	partitions: &mut BTreeMap<(String, String), Vec<DirectMediaHistoryDelta>>,
) {
	for deltas in partitions.values_mut() {
		deltas.sort_by_key(|delta| {
			composite_identity_hash(
				&delta.conversation_id,
				&delta.peer_profile_id,
				&delta.message_id,
				&delta.media_id,
			)
		});
	}
}

fn apply_batch_partitions(
	root: &Path,
	by_partition: BTreeMap<(String, String), Vec<DirectMediaHistoryDelta>>,
) -> Result<(), AppError> {
	for ((account_id, conversation_id), partition_deltas) in by_partition {
		let account_hash = identifier_hash(&account_id);
		let conversation_hash = identifier_hash(&conversation_id);
		let key = load_or_create_key(KEY_SERVICE, &account_hash)?;
		let mut index = load_conversation_index(
			&root,
			&account_hash,
			&conversation_hash,
			&key,
		)?;
		let mut index_changed = false;
		for delta in partition_deltas {
			index_changed |= apply_history_delta(
				&root,
				&account_hash,
				&key,
				&mut index,
				delta,
			)?;
		}
		if index_changed {
			save_conversation_index(
				&root.join(&account_hash),
				&account_hash,
				&conversation_hash,
				&key,
				&index,
			)?;
		}
	}
	Ok(())
}

fn apply_history_delta(
	root: &Path,
	account_hash: &str,
	key: &[u8; 32],
	index: &mut AccountIndex,
	delta: DirectMediaHistoryDelta,
) -> Result<bool, AppError> {
	let identity_hash = composite_identity_hash(
		&delta.conversation_id,
		&delta.peer_profile_id,
		&delta.message_id,
		&delta.media_id,
	);
	if let Some(position) = index
		.entries
		.iter()
		.position(|entry| entry.identity_hash == identity_hash)
	{
		let mut record =
			load_record(root, account_hash, &index.entries[position], key)?;
		if delta.remote_availability == RemoteAvailability::Retracted
			&& record.cache_availability != CacheAvailability::Cached
		{
			let reference = index.entries.remove(position);
			let _ = fs::remove_file(
				root.join(account_hash).join(reference.record_file),
			);
			return Ok(true);
		} else {
			let previous = record.clone();
			record.remote_availability = preserve_terminal_availability(
				record.remote_availability,
				delta.remote_availability,
			);
			record.kind = delta.kind;
			record.message_type = delta.message_type;
			record.sent_at = delta.sent_at;
			if record == previous {
				return Ok(false);
			}
			let record_file = index.entries[position].record_file.clone();
			let reference = reference_for(&record, record_file);
			save_record(root, account_hash, &reference, key, &record)?;
			index.entries[position] = reference;
			return Ok(true);
		}
	} else if delta.remote_availability != RemoteAvailability::Retracted {
		let record = DirectMediaEntry {
			account_profile_id: delta.account_id,
			conversation_id: delta.conversation_id,
			peer_profile_id: delta.peer_profile_id,
			message_id: delta.message_id,
			media_id: delta.media_id,
			kind: delta.kind,
			message_type: delta.message_type,
			sent_at: delta.sent_at,
			remote_availability: delta.remote_availability,
			cache_availability: CacheAvailability::NotCached,
			cache_token: None,
			content_type: None,
			byte_length: None,
			file_name: None,
			last_accessed_ms: now_ms(),
		};
		let reference =
			reference_for(&record, format!("{}.ogdr", random_token()));
		save_record(root, account_hash, &reference, key, &record)?;
		index.entries.push(reference);
		return Ok(true);
	}
	Ok(false)
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
	let index_before = index.clone();
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
	if let Err(error) = persist_account_index_changes(
		&root,
		&account_hash,
		&key,
		&index_before,
		&index,
	) {
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
	let index_before = index.clone();
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
	if let Err(error) = persist_account_index_changes(
		&root,
		&account_hash,
		&key,
		&index_before,
		&index,
	) {
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
	let index_before = index.clone();
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
	let accessed_at = now_ms();
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
	if should_persist_access(entry.last_accessed_ms, accessed_at) {
		entry.last_accessed_ms = accessed_at;
		index.entries[position] =
			reference_for(&entry, index.entries[position].record_file.clone());
		save_record(
			&root,
			&account_hash,
			&index.entries[position],
			&key,
			&entry,
		)?;
		persist_account_index_changes(
			&root,
			&account_hash,
			&key,
			&index_before,
			&index,
		)?;
	}
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
	let decoded_cursor = cursor
		.as_deref()
		.map(|cursor| {
			decode_direct_media_cursor(
				&key,
				&account_hash,
				&conversation_hash,
				&peer_hash,
				cursor,
			)
		})
		.transpose()?;
	let (references, next_entry, total_count) = page_references(
		references,
		decoded_cursor.as_ref(),
		page_size.unwrap_or(DEFAULT_PAGE_SIZE),
	)?;
	let next_cursor = next_entry
		.as_ref()
		.map(|entry| {
			encode_direct_media_cursor(
				&key,
				&account_hash,
				&conversation_hash,
				&peer_hash,
				entry,
			)
		})
		.transpose()?;
	let account_dir = root.join(&account_hash);
	let items = references
		.iter()
		.map(|reference| {
			let mut record =
				load_record(&root, &account_hash, reference, &key)?;
			let verified = record.cache_availability
				== CacheAvailability::Cached
				&& probe_verified_entry_media(
					&account_dir,
					&account_hash,
					&key,
					&record,
				)
				.is_ok();
			if verified {
				let playable_url = record
					.cache_token
					.as_deref()
					.map(|token| protocol_url(SCHEME, token));
				return Ok::<DirectMediaPageEntry, AppError>(
					DirectMediaPageEntry {
						entry: record,
						protocol_url: playable_url,
					},
				);
			} else if record.cache_availability == CacheAvailability::Cached {
				record.cache_availability = CacheAvailability::Evicted;
				record.cache_token = None;
				record.byte_length = None;
			}
			Ok::<DirectMediaPageEntry, AppError>(DirectMediaPageEntry {
				entry: record,
				protocol_url: None,
			})
		})
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
		let index_before = index.clone();
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
		persist_account_index_changes(
			root,
			&hash,
			&key,
			&index_before,
			&index,
		)?;
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
		bump_account_generation(&identifier_hash(id));
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
	let index_before = index.clone();
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
	let accessed_at = now_ms();
	if should_persist_access(entry.last_accessed_ms, accessed_at) {
		entry.last_accessed_ms = accessed_at;
		let record_file = index.entries[position].record_file.clone();
		index.entries[position] = reference_for(&entry, record_file);
		let _ = save_record(
			&root,
			&account_hash,
			&index.entries[position],
			&key,
			&entry,
		);
		let _ = persist_account_index_changes(
			&root,
			&account_hash,
			&key,
			&index_before,
			&index,
		);
	}
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

fn should_persist_access(previous_ms: u64, current_ms: u64) -> bool {
	current_ms.saturating_sub(previous_ms) >= ACCESS_WRITE_INTERVAL_MS
}

fn account_generation(account_hash: &str) -> u64 {
	ACCOUNT_GENERATIONS
		.lock()
		.unwrap_or_else(|poisoned| poisoned.into_inner())
		.get(account_hash)
		.copied()
		.unwrap_or(0)
}

fn bump_account_generation(account_hash: &str) {
	let mut generations = ACCOUNT_GENERATIONS
		.lock()
		.unwrap_or_else(|poisoned| poisoned.into_inner());
	let generation = generations.entry(account_hash.to_owned()).or_default();
	*generation = generation.wrapping_add(1);
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
	read_exact_entry_media(account_dir, account_hash, key, entry)?;
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
	let account_dir = root.join(account_hash);
	let legacy_path = account_dir.join(INDEX_FILE);
	let mut combined = if legacy_path.is_file() {
		load_v2_indexes(&account_dir, account_hash, key)?
	} else {
		load_v2_indexes(&account_dir, account_hash, key)?
	};
	if legacy_path.is_file() {
		let legacy = load_legacy_index(&legacy_path, account_hash, key)?;
		for entry in legacy.entries {
			if let Some(position) =
				combined.entries.iter().position(|candidate| {
					candidate.identity_hash == entry.identity_hash
				}) {
				combined.entries[position] = entry;
			} else {
				combined.entries.push(entry);
			}
		}
		let captured_epoch = CACHE_EPOCH.load(Ordering::Acquire);
		if let Err(error) = migrate_legacy_index(
			&account_dir,
			account_hash,
			key,
			&combined,
			captured_epoch,
		) {
			tracing::warn!(error = ?error, "direct-media index migration will resume later");
		}
	}
	Ok(combined)
}

fn load_conversation_index(
	root: &Path,
	account_hash: &str,
	conversation_hash: &str,
	key: &[u8; 32],
) -> Result<AccountIndex, AppError> {
	let account_dir = root.join(account_hash);
	let path = conversation_index_path(&account_dir, conversation_hash);
	let mut entries = if path.is_file() {
		load_conversation_envelope(&path, account_hash, conversation_hash, key)?
			.entries
	} else {
		Vec::new()
	};
	let legacy_path = account_dir.join(INDEX_FILE);
	if legacy_path.is_file() {
		for entry in load_legacy_index(&legacy_path, account_hash, key)?
			.entries
			.into_iter()
			.filter(|entry| entry.conversation_hash == conversation_hash)
		{
			if let Some(position) = entries.iter().position(|candidate| {
				candidate.identity_hash == entry.identity_hash
			}) {
				entries[position] = entry;
			} else {
				entries.push(entry);
			}
		}
	}
	Ok(AccountIndex { entries })
}

fn load_conversation_envelope(
	path: &Path,
	account_hash: &str,
	conversation_hash: &str,
	key: &[u8; 32],
) -> Result<ConversationIndexEnvelope, AppError> {
	let bytes = read_encrypted_range(
		path,
		key,
		&conversation_index_aad(account_hash, conversation_hash),
		None,
		INDEX_MAGIC,
	)?;
	let envelope: ConversationIndexEnvelope = serde_json::from_slice(&bytes)
		.map_err(|_| {
			cache_error("direct-media conversation index is invalid")
		})?;
	if envelope.schema_version != INDEX_SCHEMA_VERSION
		|| envelope.conversation_hash != conversation_hash
		|| envelope
			.entries
			.iter()
			.any(|entry| entry.conversation_hash != conversation_hash)
	{
		return Err(cache_error(
			"direct-media conversation index schema is invalid",
		));
	}
	Ok(envelope)
}

fn save_conversation_index(
	account_dir: &Path,
	account_hash: &str,
	conversation_hash: &str,
	key: &[u8; 32],
	index: &AccountIndex,
) -> Result<(), AppError> {
	if index
		.entries
		.iter()
		.any(|entry| entry.conversation_hash != conversation_hash)
	{
		return Err(cache_error(
			"direct-media conversation index scope mismatch",
		));
	}
	let envelope = ConversationIndexEnvelope {
		schema_version: INDEX_SCHEMA_VERSION,
		conversation_hash: conversation_hash.to_owned(),
		entries: index.entries.clone(),
	};
	let bytes = serde_json::to_vec(&envelope).map_err(|_| {
		cache_error("could not encode direct-media conversation index")
	})?;
	let directory = account_dir.join(INDEX_V2_DIR);
	fs::create_dir_all(&directory).map_err(|_| {
		cache_error("could not create direct-media index directory")
	})?;
	write_encrypted_atomic(
		&conversation_index_path(account_dir, conversation_hash),
		&bytes,
		key,
		&conversation_index_aad(account_hash, conversation_hash),
		INDEX_MAGIC,
	)
}

fn transaction_root(root: &Path) -> PathBuf {
	root.join(".transactions")
}

fn sync_directory(path: &Path) -> Result<(), AppError> {
	fs::File::open(path)
		.and_then(|file| file.sync_all())
		.map_err(|_| cache_error("could not sync direct-media directory"))
}

fn create_batch_journal(
	root: &Path,
	partitions: &BTreeMap<(String, String), Vec<DirectMediaHistoryDelta>>,
) -> Result<PathBuf, AppError> {
	let journal = transaction_root(root).join(random_token());
	fs::create_dir_all(journal.join("backups")).map_err(|_| {
		cache_error("could not create direct-media transaction")
	})?;
	sync_directory(root)?;
	sync_directory(&transaction_root(root))?;
	sync_directory(&journal)?;
	let mut accounts = BTreeMap::<String, Vec<String>>::new();
	let mut targets = BTreeMap::<String, bool>::new();
	for ((account_id, conversation_id), deltas) in partitions {
		let account_hash = identifier_hash(account_id);
		let conversation_hash = identifier_hash(conversation_id);
		let account_dir = root.join(&account_hash);
		accounts.entry(account_hash.clone()).or_insert_with(|| {
			fs::read_dir(&account_dir)
				.into_iter()
				.flatten()
				.filter_map(Result::ok)
				.filter_map(|entry| {
					let name = entry.file_name().to_str()?.to_owned();
					name.ends_with(".ogdr").then_some(name)
				})
				.collect()
		});
		let partition =
			conversation_index_path(&account_dir, &conversation_hash);
		targets.insert(
			relative_cache_path(root, &partition)?,
			partition.is_file(),
		);
		let key = load_or_create_key(KEY_SERVICE, &account_hash)?;
		let index = load_conversation_index(
			root,
			&account_hash,
			&conversation_hash,
			&key,
		)?;
		for delta in deltas {
			let identity = composite_identity_hash(
				&delta.conversation_id,
				&delta.peer_profile_id,
				&delta.message_id,
				&delta.media_id,
			);
			if let Some(reference) = index
				.entries
				.iter()
				.find(|entry| entry.identity_hash == identity)
			{
				let record = account_dir.join(&reference.record_file);
				targets.insert(
					relative_cache_path(root, &record)?,
					record.is_file(),
				);
			}
		}
	}
	let mut backups = Vec::new();
	for (position, (target, existed)) in targets.into_iter().enumerate() {
		let backup = format!("backups/{position}.bak");
		if existed {
			fs::copy(root.join(&target), journal.join(&backup)).map_err(
				|_| {
					cache_error(
						"could not back up direct-media transaction target",
					)
				},
			)?;
			fs::File::open(journal.join(&backup))
				.and_then(|file| file.sync_all())
				.map_err(|_| {
					cache_error(
						"could not sync direct-media transaction backup",
					)
				})?;
		}
		backups.push(BatchJournalBackup {
			target,
			backup,
			existed,
		});
	}
	let manifest = BatchJournalManifest {
		accounts: accounts
			.into_iter()
			.map(|(account_hash, mut baseline_record_files)| {
				baseline_record_files.sort();
				BatchJournalAccount {
					account_hash,
					baseline_record_files,
				}
			})
			.collect(),
		backups,
	};
	let manifest_path = journal.join("manifest.json");
	fs::write(
		&manifest_path,
		serde_json::to_vec(&manifest).map_err(|_| {
			cache_error("could not encode direct-media transaction")
		})?,
	)
	.map_err(|_| cache_error("could not write direct-media transaction"))?;
	fs::File::open(&manifest_path)
		.and_then(|file| file.sync_all())
		.map_err(|_| cache_error("could not sync direct-media transaction"))?;
	sync_directory(&journal)?;
	sync_directory(&transaction_root(root))?;
	Ok(journal)
}

fn relative_cache_path(root: &Path, path: &Path) -> Result<String, AppError> {
	path.strip_prefix(root)
		.map_err(|_| {
			cache_error("direct-media transaction path escaped cache")
		})?
		.to_str()
		.map(str::to_owned)
		.ok_or_else(|| cache_error("direct-media transaction path is invalid"))
}

fn validated_journal_relative_path(value: &str) -> Result<&Path, AppError> {
	let path = Path::new(value);
	if path.as_os_str().is_empty()
		|| path
			.components()
			.any(|component| !matches!(component, Component::Normal(_)))
	{
		return Err(cache_error("direct-media transaction path is invalid"));
	}
	Ok(path)
}

fn validated_journal_component(value: &str) -> Result<&Path, AppError> {
	let path = validated_journal_relative_path(value)?;
	if path.components().count() != 1 {
		return Err(cache_error(
			"direct-media transaction component is invalid",
		));
	}
	Ok(path)
}

fn rollback_batch_journal(journal: &Path) -> Result<(), AppError> {
	let root = journal.parent().and_then(Path::parent).ok_or_else(|| {
		cache_error("direct-media transaction root is invalid")
	})?;
	let manifest: BatchJournalManifest = serde_json::from_slice(
		&fs::read(journal.join("manifest.json")).map_err(|_| {
			cache_error("could not read direct-media transaction")
		})?,
	)
	.map_err(|_| cache_error("direct-media transaction is invalid"))?;
	// Validate the complete plaintext manifest before performing any recovery
	// mutation. A damaged journal must not turn relative cache paths into
	// arbitrary filesystem targets.
	let backups = manifest
		.backups
		.iter()
		.map(|backup| {
			Ok((
				root.join(validated_journal_relative_path(&backup.target)?),
				journal.join(validated_journal_relative_path(&backup.backup)?),
				backup.existed,
			))
		})
		.collect::<Result<Vec<_>, AppError>>()?;
	let accounts = manifest
		.accounts
		.iter()
		.map(|account| {
			for file in &account.baseline_record_files {
				validated_journal_component(file)?;
			}
			Ok((
				root.join(validated_journal_component(&account.account_hash)?),
				account.baseline_record_files.iter().collect::<HashSet<_>>(),
			))
		})
		.collect::<Result<Vec<_>, AppError>>()?;
	let mut affected_directories = std::collections::BTreeSet::new();
	for (target, backup, existed) in backups {
		if existed {
			if let Some(parent) = target.parent() {
				fs::create_dir_all(parent).map_err(|_| {
					cache_error("could not restore transaction directory")
				})?;
			}
			fs::copy(backup, &target).map_err(|_| {
				cache_error("could not restore direct-media transaction")
			})?;
			fs::File::open(&target)
				.and_then(|file| file.sync_all())
				.map_err(|_| {
					cache_error("could not sync restored direct-media target")
				})?;
		} else if target.is_file() {
			fs::remove_file(&target).map_err(|_| {
				cache_error("could not remove direct-media transaction target")
			})?;
		}
		if let Some(parent) = target.parent() {
			affected_directories.insert(parent.to_path_buf());
		}
	}
	for (account_dir, baseline) in accounts {
		for item in fs::read_dir(&account_dir)
			.into_iter()
			.flatten()
			.filter_map(Result::ok)
		{
			let Some(name) = item.file_name().to_str().map(str::to_owned)
			else {
				continue;
			};
			if name.ends_with(".ogdr") && !baseline.contains(&name) {
				fs::remove_file(item.path()).map_err(|_| {
					cache_error("could not remove orphaned direct-media record")
				})?;
			}
		}
		affected_directories.insert(account_dir);
	}
	for directory in affected_directories {
		if directory.is_dir() {
			sync_directory(&directory)?;
		}
	}
	let parent = journal
		.parent()
		.ok_or_else(|| {
			cache_error("direct-media transaction parent is invalid")
		})?
		.to_path_buf();
	fs::remove_dir_all(journal).map_err(|_| {
		cache_error("could not retire direct-media transaction")
	})?;
	sync_directory(&parent)?;
	Ok(())
}

fn commit_batch_journal(journal: &Path) -> Result<(), AppError> {
	let marker = journal.join("committed");
	fs::write(&marker, b"committed").map_err(|_| {
		cache_error("could not commit direct-media transaction")
	})?;
	fs::File::open(&marker)
		.and_then(|file| file.sync_all())
		.map_err(|_| {
			cache_error("could not sync direct-media transaction commit")
		})?;
	sync_directory(journal)?;
	let parent = journal
		.parent()
		.ok_or_else(|| {
			cache_error("direct-media transaction parent is invalid")
		})?
		.to_path_buf();
	sync_directory(&parent)?;
	fs::remove_dir_all(journal).map_err(|_| {
		cache_error("could not retire direct-media transaction")
	})?;
	sync_directory(&parent)?;
	Ok(())
}

fn recover_batch_journals(root: &Path) -> Result<(), AppError> {
	let transactions = transaction_root(root);
	if !transactions.is_dir() {
		return Ok(());
	}
	let mut journals = fs::read_dir(&transactions)
		.map_err(|_| cache_error("could not read direct-media transactions"))?
		.filter_map(Result::ok)
		.map(|entry| entry.path())
		.filter(|path| path.is_dir())
		.collect::<Vec<_>>();
	journals.sort();
	for journal in journals {
		if !journal.join("manifest.json").is_file() {
			fs::remove_dir_all(&journal).map_err(|_| {
				cache_error(
					"could not retire incomplete direct-media transaction",
				)
			})?;
			sync_directory(&transactions)?;
			continue;
		}
		if journal.join("committed").is_file() {
			fs::remove_dir_all(&journal).map_err(|_| {
				cache_error(
					"could not retire committed direct-media transaction",
				)
			})?;
			sync_directory(&transactions)?;
		} else {
			rollback_batch_journal(&journal)?;
		}
	}
	Ok(())
}

#[cfg(test)]
fn save_account_index(
	root: &Path,
	account_hash: &str,
	key: &[u8; 32],
	index: &AccountIndex,
) -> Result<(), AppError> {
	save_v2_indexes(&root.join(account_hash), account_hash, key, index)
}

fn persist_account_index_changes(
	root: &Path,
	account_hash: &str,
	key: &[u8; 32],
	before: &AccountIndex,
	after: &AccountIndex,
) -> Result<(), AppError> {
	let grouped = |index: &AccountIndex| {
		let mut groups: BTreeMap<String, Vec<IndexEntry>> = BTreeMap::new();
		for entry in &index.entries {
			groups
				.entry(entry.conversation_hash.clone())
				.or_default()
				.push(entry.clone());
		}
		for entries in groups.values_mut() {
			entries.sort_by(|left, right| {
				left.identity_hash.cmp(&right.identity_hash)
			});
		}
		groups
	};
	let before_groups = grouped(before);
	let after_groups = grouped(after);
	let conversations = before_groups
		.keys()
		.chain(after_groups.keys())
		.cloned()
		.collect::<std::collections::BTreeSet<_>>();
	for conversation_hash in conversations {
		let old = before_groups
			.get(&conversation_hash)
			.map(Vec::as_slice)
			.unwrap_or_default();
		let new = after_groups
			.get(&conversation_hash)
			.map(Vec::as_slice)
			.unwrap_or_default();
		if old == new {
			continue;
		}
		let path = conversation_index_path(
			&root.join(account_hash),
			&conversation_hash,
		);
		if new.is_empty() {
			if path.is_file() {
				fs::remove_file(&path).map_err(|_| {
					cache_error(
						"could not remove direct-media conversation index",
					)
				})?;
				if let Some(parent) = path.parent() {
					fs::File::open(parent)
						.and_then(|file| file.sync_all())
						.map_err(|_| {
							cache_error(
								"could not sync direct-media index directory",
							)
						})?;
				}
			}
		} else {
			save_conversation_index(
				&root.join(account_hash),
				account_hash,
				&conversation_hash,
				key,
				&AccountIndex {
					entries: new.to_vec(),
				},
			)?;
		}
	}
	Ok(())
}

fn conversation_index_aad(
	account_hash: &str,
	conversation_hash: &str,
) -> Vec<u8> {
	aad_prefix(
		"direct-media-conversation-index-v2",
		&[account_hash, conversation_hash],
	)
}

fn conversation_index_path(
	account_dir: &Path,
	conversation_hash: &str,
) -> PathBuf {
	account_dir
		.join(INDEX_V2_DIR)
		.join(format!("{conversation_hash}.ogdi"))
}

fn load_legacy_index(
	path: &Path,
	account_hash: &str,
	key: &[u8; 32],
) -> Result<AccountIndex, AppError> {
	let bytes = read_encrypted_range(
		path,
		key,
		&index_aad(account_hash),
		None,
		INDEX_MAGIC,
	)?;
	serde_json::from_slice(&bytes)
		.map_err(|_| cache_error("direct-media history index is invalid"))
}

fn load_v2_indexes(
	account_dir: &Path,
	account_hash: &str,
	key: &[u8; 32],
) -> Result<AccountIndex, AppError> {
	let directory = account_dir.join(INDEX_V2_DIR);
	if !directory.is_dir() {
		return Ok(AccountIndex::default());
	}
	let mut index = AccountIndex::default();
	for item in fs::read_dir(&directory).map_err(|_| {
		cache_error("could not read direct-media index directory")
	})? {
		let path = item
			.map_err(|_| {
				cache_error("could not read direct-media index entry")
			})?
			.path();
		if path.extension().and_then(|value| value.to_str()) != Some("ogdi") {
			continue;
		}
		let Some(conversation_hash) =
			path.file_stem().and_then(|value| value.to_str())
		else {
			return Err(cache_error(
				"direct-media conversation index name is invalid",
			));
		};
		let bytes = read_encrypted_range(
			&path,
			key,
			&conversation_index_aad(account_hash, conversation_hash),
			None,
			INDEX_MAGIC,
		)?;
		let envelope: ConversationIndexEnvelope =
			serde_json::from_slice(&bytes).map_err(|_| {
				cache_error("direct-media conversation index is invalid")
			})?;
		if envelope.schema_version != INDEX_SCHEMA_VERSION
			|| envelope.conversation_hash != conversation_hash
			|| envelope
				.entries
				.iter()
				.any(|entry| entry.conversation_hash != conversation_hash)
		{
			return Err(cache_error(
				"direct-media conversation index schema is invalid",
			));
		}
		index.entries.extend(envelope.entries);
	}
	Ok(index)
}

#[cfg(test)]
fn save_v2_indexes(
	account_dir: &Path,
	account_hash: &str,
	key: &[u8; 32],
	index: &AccountIndex,
) -> Result<(), AppError> {
	let directory = account_dir.join(INDEX_V2_DIR);
	fs::create_dir_all(&directory).map_err(|_| {
		cache_error("could not create direct-media index directory")
	})?;
	let mut grouped: HashMap<String, Vec<IndexEntry>> = HashMap::new();
	for entry in &index.entries {
		grouped
			.entry(entry.conversation_hash.clone())
			.or_default()
			.push(entry.clone());
	}
	for (conversation_hash, entries) in &grouped {
		let envelope = ConversationIndexEnvelope {
			schema_version: INDEX_SCHEMA_VERSION,
			conversation_hash: conversation_hash.clone(),
			entries: entries.clone(),
		};
		let bytes = serde_json::to_vec(&envelope).map_err(|_| {
			cache_error("could not encode direct-media conversation index")
		})?;
		write_encrypted_atomic(
			&conversation_index_path(account_dir, conversation_hash),
			&bytes,
			key,
			&conversation_index_aad(account_hash, conversation_hash),
			INDEX_MAGIC,
		)?;
	}
	for item in fs::read_dir(&directory).map_err(|_| {
		cache_error("could not read direct-media index directory")
	})? {
		let path = item
			.map_err(|_| {
				cache_error("could not read direct-media index entry")
			})?
			.path();
		let Some(stem) = path.file_stem().and_then(|value| value.to_str())
		else {
			continue;
		};
		if path.extension().and_then(|value| value.to_str()) == Some("ogdi")
			&& !grouped.contains_key(stem)
		{
			fs::remove_file(path).map_err(|_| {
				cache_error("could not retire direct-media index partition")
			})?;
		}
	}
	fs::File::open(&directory)
		.and_then(|file| file.sync_all())
		.map_err(|_| {
			cache_error("could not sync direct-media index directory")
		})?;
	Ok(())
}

fn migrate_legacy_index(
	account_dir: &Path,
	account_hash: &str,
	key: &[u8; 32],
	index: &AccountIndex,
	captured_epoch: u64,
) -> Result<(), AppError> {
	let started = std::time::Instant::now();
	let result = migrate_legacy_index_with_hook(
		account_dir,
		account_hash,
		key,
		index,
		captured_epoch,
		|| Ok(()),
	);
	tracing::info!(
		source_schema = 1_u32,
		destination_schema = INDEX_SCHEMA_VERSION,
		record_count = index.entries.len(),
		duration_ms = started.elapsed().as_millis() as u64,
		outcome = if result.is_ok() { "complete" } else { "failed" },
		"direct-media history migration"
	);
	result
}

fn migrate_legacy_index_with_hook<F>(
	account_dir: &Path,
	account_hash: &str,
	key: &[u8; 32],
	index: &AccountIndex,
	captured_epoch: u64,
	after_stage: F,
) -> Result<(), AppError>
where
	F: FnOnce() -> Result<(), AppError>,
{
	stage_legacy_partitions_bounded(account_dir, account_hash, key, index)?;
	after_stage()?;
	let verified = load_v2_indexes(account_dir, account_hash, key)?;
	let mut expected = index.entries.clone();
	let mut actual = verified.entries.clone();
	expected
		.sort_by(|left, right| left.identity_hash.cmp(&right.identity_hash));
	actual.sort_by(|left, right| left.identity_hash.cmp(&right.identity_hash));
	if CACHE_EPOCH.load(Ordering::Acquire) != captured_epoch {
		return Err(cache_error(
			"direct-media index migration verification failed",
		));
	}
	if expected != actual {
		return Ok(());
	}
	let root = account_dir
		.parent()
		.ok_or_else(|| cache_error("direct-media account path is invalid"))?;
	for reference in &actual {
		let record = load_record(root, account_hash, reference, key)?;
		if reference_for(&record, reference.record_file.clone()) != *reference {
			return Err(cache_error(
				"direct-media migration record pointer verification failed",
			));
		}
	}
	fs::remove_file(account_dir.join(INDEX_FILE)).map_err(|_| {
		cache_error("could not retire legacy direct-media index")
	})?;
	fs::File::open(account_dir)
		.and_then(|file| file.sync_all())
		.map_err(|_| {
			cache_error("could not sync direct-media account directory")
		})?;
	Ok(())
}

fn stage_legacy_partitions_bounded(
	account_dir: &Path,
	account_hash: &str,
	key: &[u8; 32],
	index: &AccountIndex,
) -> Result<(), AppError> {
	let mut existing: BTreeMap<String, Vec<IndexEntry>> = BTreeMap::new();
	for entry in load_v2_indexes(account_dir, account_hash, key)?.entries {
		existing
			.entry(entry.conversation_hash.clone())
			.or_default()
			.push(entry);
	}
	let mut grouped: BTreeMap<String, Vec<IndexEntry>> = BTreeMap::new();
	for entry in &index.entries {
		grouped
			.entry(entry.conversation_hash.clone())
			.or_default()
			.push(entry.clone());
	}
	for entries in existing.values_mut().chain(grouped.values_mut()) {
		entries.sort_by(|left, right| {
			left.identity_hash.cmp(&right.identity_hash)
		});
	}
	let directory = account_dir.join(INDEX_V2_DIR);
	fs::create_dir_all(&directory).map_err(|_| {
		cache_error("could not create direct-media index directory")
	})?;
	let mut missing = grouped
		.into_iter()
		.filter(|(conversation_hash, entries)| {
			existing.get(conversation_hash) != Some(entries)
		})
		.collect::<Vec<_>>();
	missing.sort_by(|left, right| left.0.cmp(&right.0));
	for (conversation_hash, entries) in
		missing.into_iter().take(MIGRATION_PARTITION_BATCH)
	{
		let envelope = ConversationIndexEnvelope {
			schema_version: INDEX_SCHEMA_VERSION,
			conversation_hash: conversation_hash.clone(),
			entries,
		};
		let bytes = serde_json::to_vec(&envelope).map_err(|_| {
			cache_error("could not encode direct-media conversation index")
		})?;
		write_encrypted_atomic(
			&conversation_index_path(account_dir, &conversation_hash),
			&bytes,
			key,
			&conversation_index_aad(account_hash, &conversation_hash),
			INDEX_MAGIC,
		)?;
	}
	fs::File::open(&directory)
		.and_then(|file| file.sync_all())
		.map_err(|_| {
			cache_error("could not sync direct-media index directory")
		})?;
	Ok(())
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
	let index_before = index.clone();
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
		persist_account_index_changes(
			root,
			account_hash,
			key,
			&index_before,
			&index,
		)?;
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
	let offset = cursor.map(decode_test_cursor).transpose()?.unwrap_or(0);
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
		items: items
			.into_iter()
			.map(|entry| DirectMediaPageEntry {
				entry,
				protocol_url: None,
			})
			.collect(),
		next_cursor: (next < total_count as usize)
			.then(|| encode_test_cursor(next)),
		total_count,
	})
}

fn page_references(
	mut entries: Vec<IndexEntry>,
	cursor: Option<&DirectMediaCursor>,
	page_size: usize,
) -> Result<(Vec<IndexEntry>, Option<IndexEntry>, u64), AppError> {
	let page_size = page_size.clamp(1, MAX_PAGE_SIZE);
	entries.sort_by(|left, right| {
		right
			.sent_at
			.cmp(&left.sent_at)
			.then_with(|| right.identity_hash.cmp(&left.identity_hash))
	});
	let total_count = entries.len() as u64;
	let offset = cursor.map_or(0, |cursor| {
		entries.partition_point(|entry| {
			entry.sent_at > cursor.sent_at
				|| (entry.sent_at == cursor.sent_at
					&& entry.identity_hash >= cursor.identity_hash)
		})
	});
	let items = entries
		.into_iter()
		.skip(offset)
		.take(page_size)
		.collect::<Vec<_>>();
	let next = offset + items.len();
	let next_entry = (next < total_count as usize)
		.then(|| items.last().cloned())
		.flatten();
	Ok((items, next_entry, total_count))
}
#[cfg(test)]
fn encode_test_cursor(offset: usize) -> String {
	URL_SAFE_NO_PAD.encode((offset as u64).to_be_bytes())
}
#[cfg(test)]
fn decode_test_cursor(cursor: &str) -> Result<usize, AppError> {
	let bytes = URL_SAFE_NO_PAD
		.decode(cursor)
		.map_err(|_| cache_error("invalid direct-media cursor"))?;
	let array: [u8; 8] = bytes
		.try_into()
		.map_err(|_| cache_error("invalid direct-media cursor"))?;
	usize::try_from(u64::from_be_bytes(array))
		.map_err(|_| cache_error("invalid direct-media cursor"))
}

fn direct_media_cursor_aad(
	account_hash: &str,
	conversation_hash: &str,
	peer_hash: &str,
) -> Vec<u8> {
	aad_prefix(
		"history-cursor-v1",
		&[account_hash, conversation_hash, peer_hash],
	)
}

fn encode_direct_media_cursor(
	key: &[u8; 32],
	account_hash: &str,
	conversation_hash: &str,
	peer_hash: &str,
	entry: &IndexEntry,
) -> Result<String, AppError> {
	let payload = serde_json::to_vec(&DirectMediaCursor {
		version: 1,
		sent_at: entry.sent_at,
		identity_hash: entry.identity_hash.clone(),
	})
	.map_err(|_| cache_error("could not encode direct-media cursor"))?;
	let cipher = Aes256Gcm::new_from_slice(key)
		.map_err(|_| cache_error("could not initialize direct-media cursor"))?;
	let mut nonce = [0_u8; 12];
	OsRng.fill_bytes(&mut nonce);
	let ciphertext = cipher
		.encrypt(
			Nonce::from_slice(&nonce),
			Payload {
				msg: &payload,
				aad: &direct_media_cursor_aad(
					account_hash,
					conversation_hash,
					peer_hash,
				),
			},
		)
		.map_err(|_| cache_error("could not protect direct-media cursor"))?;
	let mut encoded = nonce.to_vec();
	encoded.extend(ciphertext);
	Ok(URL_SAFE_NO_PAD.encode(encoded))
}

fn decode_direct_media_cursor(
	key: &[u8; 32],
	account_hash: &str,
	conversation_hash: &str,
	peer_hash: &str,
	cursor: &str,
) -> Result<DirectMediaCursor, AppError> {
	let encoded = URL_SAFE_NO_PAD
		.decode(cursor)
		.map_err(|_| cache_error("invalid direct-media cursor"))?;
	if encoded.len() <= 12 {
		return Err(cache_error("invalid direct-media cursor"));
	}
	let cipher = Aes256Gcm::new_from_slice(key)
		.map_err(|_| cache_error("could not initialize direct-media cursor"))?;
	let payload = cipher
		.decrypt(
			Nonce::from_slice(&encoded[..12]),
			Payload {
				msg: &encoded[12..],
				aad: &direct_media_cursor_aad(
					account_hash,
					conversation_hash,
					peer_hash,
				),
			},
		)
		.map_err(|_| cache_error("invalid direct-media cursor"))?;
	let cursor: DirectMediaCursor = serde_json::from_slice(&payload)
		.map_err(|_| cache_error("invalid direct-media cursor"))?;
	if cursor.version != 1 || cursor.identity_hash.is_empty() {
		return Err(cache_error("invalid direct-media cursor"));
	}
	Ok(cursor)
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
		.filter(|entry| entry.file_name() != ".transactions")
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

	fn history_delta(message_id: &str) -> DirectMediaHistoryDelta {
		DirectMediaHistoryDelta {
			account_id: "account".into(),
			conversation_id: "conversation".into(),
			peer_profile_id: "peer".into(),
			message_id: message_id.into(),
			media_id: format!("media-{message_id}"),
			kind: "image".into(),
			message_type: "Image".into(),
			sent_at: 1,
			remote_availability: RemoteAvailability::Available,
		}
	}

	fn save_legacy_records(
		root: &Path,
		account_hash: &str,
		key: &[u8; 32],
		records: &[DirectMediaEntry],
	) -> AccountIndex {
		let account_dir = root.join(account_hash);
		fs::create_dir_all(&account_dir).unwrap();
		let index = AccountIndex {
			entries: records
				.iter()
				.enumerate()
				.map(|(position, record)| {
					let reference = reference_for(
						record,
						format!("legacy-record-{position}.ogdr"),
					);
					save_record(root, account_hash, &reference, key, record)
						.unwrap();
					reference
				})
				.collect(),
		};
		write_encrypted_atomic(
			&account_dir.join(INDEX_FILE),
			&serde_json::to_vec(&index).unwrap(),
			key,
			&index_aad(account_hash),
			INDEX_MAGIC,
		)
		.unwrap();
		index
	}

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
				.map(|item| item.entry.message_id.as_str())
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
				.map(|item| item.entry.message_id.as_str())
				.collect::<Vec<_>>(),
			vec!["older"]
		);
	}

	#[test]
	fn native_page_cursor_is_authenticated_scope_bound_and_keyset_stable() {
		let key = [91_u8; 32];
		let account_hash = identifier_hash("account");
		let conversation_hash = identifier_hash("conversation");
		let peer_hash = identifier_hash("peer");
		let references = [
			DirectMediaEntry::test("newest", 30),
			DirectMediaEntry::test("middle", 20),
			DirectMediaEntry::test("oldest", 10),
		]
		.into_iter()
		.map(|entry| {
			reference_for(&entry, format!("{}.ogdr", entry.message_id))
		})
		.collect::<Vec<_>>();
		let (first, next, _) =
			page_references(references.clone(), None, 2).unwrap();
		assert_eq!(first.len(), 2);
		let token = encode_direct_media_cursor(
			&key,
			&account_hash,
			&conversation_hash,
			&peer_hash,
			next.as_ref().unwrap(),
		)
		.unwrap();
		assert!(!token.contains(&next.unwrap().identity_hash));
		let decoded = decode_direct_media_cursor(
			&key,
			&account_hash,
			&conversation_hash,
			&peer_hash,
			&token,
		)
		.unwrap();
		assert!(decode_direct_media_cursor(
			&key,
			&account_hash,
			&identifier_hash("other-conversation"),
			&peer_hash,
			&token,
		)
		.is_err());
		let mut tampered = token.into_bytes();
		let last = tampered.len() - 1;
		tampered[last] = if tampered[last] == b'A' { b'B' } else { b'A' };
		assert!(decode_direct_media_cursor(
			&key,
			&account_hash,
			&conversation_hash,
			&peer_hash,
			std::str::from_utf8(&tampered).unwrap(),
		)
		.is_err());

		let inserted = DirectMediaEntry::test("inserted-later", 40);
		let mut changed = references;
		changed.push(reference_for(&inserted, "inserted.ogdr".into()));
		let (second, _, _) =
			page_references(changed, Some(&decoded), 2).unwrap();
		assert_eq!(second.len(), 1);
		assert_eq!(second[0].sent_at, 10);
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
	fn identical_history_delta_requires_zero_record_or_index_writes() {
		let root = temp_dir();
		let account_hash = identifier_hash("account");
		let key = [55_u8; 32];
		let mut index = AccountIndex::default();
		assert!(apply_history_delta(
			&root,
			&account_hash,
			&key,
			&mut index,
			history_delta("message"),
		)
		.unwrap());
		assert!(!apply_history_delta(
			&root,
			&account_hash,
			&key,
			&mut index,
			history_delta("message"),
		)
		.unwrap());
		assert_eq!(index.entries.len(), 1);
		fs::remove_dir_all(root).unwrap();
	}

	#[test]
	fn access_updates_are_coalesced_to_one_write_per_interval() {
		assert!(!should_persist_access(1_000, 60_999));
		assert!(should_persist_access(1_000, 61_000));
		assert!(!should_persist_access(61_000, 61_001));
	}

	#[test]
	fn account_generation_changes_are_account_partitioned() {
		let first = identifier_hash("first-account");
		let second = identifier_hash("second-account");
		let first_before = account_generation(&first);
		let second_before = account_generation(&second);
		bump_account_generation(&first);
		assert_eq!(account_generation(&first), first_before.wrapping_add(1));
		assert_eq!(account_generation(&second), second_before);
	}

	#[test]
	fn batch_partition_and_identity_commit_order_is_deterministic() {
		let mut partitions = BTreeMap::new();
		partitions.insert(
			("account-b".into(), "conversation-b".into()),
			vec![history_delta("z"), history_delta("a")],
		);
		partitions.insert(
			("account-a".into(), "conversation-a".into()),
			vec![history_delta("m")],
		);
		sort_batch_partitions(&mut partitions);
		assert_eq!(
			partitions.keys().cloned().collect::<Vec<_>>(),
			vec![
				("account-a".into(), "conversation-a".into()),
				("account-b".into(), "conversation-b".into()),
			],
		);
		let identities = partitions
			.get(&("account-b".into(), "conversation-b".into()))
			.unwrap()
			.iter()
			.map(|delta| {
				composite_identity_hash(
					&delta.conversation_id,
					&delta.peer_profile_id,
					&delta.message_id,
					&delta.media_id,
				)
			})
			.collect::<Vec<_>>();
		assert!(identities.windows(2).all(|pair| pair[0] <= pair[1]));
	}

	#[test]
	fn incomplete_batch_journal_rolls_back_partial_commit_and_orphans() {
		let root = temp_dir();
		let account_hash = identifier_hash("account");
		let second_hash = identifier_hash("second-account");
		let account_dir = root.join(&account_hash);
		let second_dir = root.join(&second_hash);
		fs::create_dir_all(account_dir.join(INDEX_V2_DIR)).unwrap();
		fs::create_dir_all(&second_dir).unwrap();
		fs::write(account_dir.join("existing.ogdr"), b"before-record").unwrap();
		fs::write(second_dir.join("existing.ogdr"), b"second-before").unwrap();
		let partition = account_dir.join(INDEX_V2_DIR).join("partition.ogdi");
		fs::write(&partition, b"before-index").unwrap();
		let journal = transaction_root(&root).join("fault-injected");
		fs::create_dir_all(journal.join("backups")).unwrap();
		fs::copy(
			account_dir.join("existing.ogdr"),
			journal.join("backups/0.bak"),
		)
		.unwrap();
		fs::copy(&partition, journal.join("backups/1.bak")).unwrap();
		fs::copy(
			second_dir.join("existing.ogdr"),
			journal.join("backups/2.bak"),
		)
		.unwrap();
		let manifest = BatchJournalManifest {
			accounts: vec![
				BatchJournalAccount {
					account_hash: account_hash.clone(),
					baseline_record_files: vec!["existing.ogdr".into()],
				},
				BatchJournalAccount {
					account_hash: second_hash.clone(),
					baseline_record_files: vec!["existing.ogdr".into()],
				},
			],
			backups: vec![
				BatchJournalBackup {
					target: format!("{account_hash}/existing.ogdr"),
					backup: "backups/0.bak".into(),
					existed: true,
				},
				BatchJournalBackup {
					target: format!("{second_hash}/existing.ogdr"),
					backup: "backups/2.bak".into(),
					existed: true,
				},
				BatchJournalBackup {
					target: format!(
						"{account_hash}/{INDEX_V2_DIR}/partition.ogdi"
					),
					backup: "backups/1.bak".into(),
					existed: true,
				},
			],
		};
		fs::write(
			journal.join("manifest.json"),
			serde_json::to_vec(&manifest).unwrap(),
		)
		.unwrap();
		fs::write(account_dir.join("existing.ogdr"), b"partial-record")
			.unwrap();
		fs::write(&partition, b"partial-index").unwrap();
		fs::write(account_dir.join("orphan.ogdr"), b"orphan").unwrap();
		fs::write(second_dir.join("existing.ogdr"), b"second-partial").unwrap();
		fs::write(second_dir.join("orphan.ogdr"), b"second-orphan").unwrap();
		recover_batch_journals(&root).unwrap();
		assert_eq!(
			fs::read(account_dir.join("existing.ogdr")).unwrap(),
			b"before-record"
		);
		assert_eq!(fs::read(&partition).unwrap(), b"before-index");
		assert!(!account_dir.join("orphan.ogdr").exists());
		assert_eq!(
			fs::read(second_dir.join("existing.ogdr")).unwrap(),
			b"second-before"
		);
		assert!(!second_dir.join("orphan.ogdr").exists());
		assert!(!journal.exists());
		fs::remove_dir_all(root).unwrap();
	}

	#[test]
	fn journal_recovery_handles_pre_manifest_and_committed_power_loss_boundaries(
	) {
		let root = temp_dir();
		let transactions = transaction_root(&root);
		let incomplete = transactions.join("before-manifest");
		fs::create_dir_all(incomplete.join("backups")).unwrap();
		recover_batch_journals(&root).unwrap();
		assert!(!incomplete.exists());

		let committed = transactions.join("after-commit-marker");
		fs::create_dir_all(&committed).unwrap();
		fs::write(
			committed.join("manifest.json"),
			serde_json::to_vec(&BatchJournalManifest {
				accounts: vec![],
				backups: vec![],
			})
			.unwrap(),
		)
		.unwrap();
		fs::write(committed.join("committed"), b"committed").unwrap();
		let durable = root.join("durable-result");
		fs::write(&durable, b"keep").unwrap();
		recover_batch_journals(&root).unwrap();
		assert_eq!(fs::read(durable).unwrap(), b"keep");
		assert!(!committed.exists());
		fs::remove_dir_all(root).unwrap();
	}

	#[test]
	fn journal_recovery_rejects_paths_outside_the_cache_before_mutating() {
		let root = temp_dir();
		let outside = root
			.parent()
			.unwrap()
			.join(format!("outside-{}.txt", random_token()));
		fs::write(&outside, b"do-not-touch").unwrap();
		let journal = transaction_root(&root).join("malformed");
		fs::create_dir_all(journal.join("backups")).unwrap();
		fs::write(journal.join("backups/0.bak"), b"attacker-bytes").unwrap();
		fs::write(
			journal.join("manifest.json"),
			serde_json::to_vec(&BatchJournalManifest {
				accounts: vec![],
				backups: vec![BatchJournalBackup {
					target: format!(
						"../{}",
						outside.file_name().unwrap().to_string_lossy()
					),
					backup: "backups/0.bak".into(),
					existed: true,
				}],
			})
			.unwrap(),
		)
		.unwrap();

		assert!(recover_batch_journals(&root).is_err());
		assert_eq!(fs::read(&outside).unwrap(), b"do-not-touch");
		assert!(journal.is_dir());

		fs::remove_file(outside).unwrap();
		fs::remove_dir_all(root).unwrap();
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
	fn paging_is_stable_for_sixty_one_twenty_one_thousand_and_ten_thousand() {
		for total in [60_usize, 120, 1_000, 10_000] {
			let entries = (0..total)
				.map(|value| {
					DirectMediaEntry::test(
						&format!("message-{value:05}"),
						value as u64,
					)
				})
				.collect::<Vec<_>>();
			let mut cursor = None;
			let mut observed = Vec::new();
			loop {
				let page =
					page_entries(entries.clone(), cursor.as_deref(), 120)
						.unwrap();
				assert!(page.items.len() <= 60);
				observed.extend(
					page.items.into_iter().map(|entry| entry.entry.message_id),
				);
				cursor = page.next_cursor;
				if cursor.is_none() {
					break;
				}
			}
			assert_eq!(observed.len(), total);
			assert_eq!(observed.iter().collect::<HashSet<_>>().len(), total);
		}
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
		let stored = fs::read(conversation_index_path(
			&root.join(&account_hash),
			&identifier_hash("conversation"),
		))
		.unwrap();
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
	fn legacy_index_migration_is_partitioned_verified_and_idempotent() {
		let root = temp_dir();
		let account_hash = identifier_hash("account");
		let key = [61_u8; 32];
		let first = DirectMediaEntry::test("first", 1);
		let mut second = DirectMediaEntry::test("second", 2);
		second.conversation_id = "other-conversation".into();
		let index =
			save_legacy_records(&root, &account_hash, &key, &[first, second]);
		let account_dir = root.join(&account_hash);
		let epoch = CACHE_EPOCH.load(Ordering::Acquire);
		migrate_legacy_index(&account_dir, &account_hash, &key, &index, epoch)
			.unwrap();
		assert!(!account_dir.join(INDEX_FILE).exists());
		let loaded =
			load_v2_indexes(&account_dir, &account_hash, &key).unwrap();
		assert_eq!(loaded.entries.len(), 2);
		let conversation_hash = identifier_hash("conversation");
		let bytes = read_encrypted_range(
			&conversation_index_path(&account_dir, &conversation_hash),
			&key,
			&conversation_index_aad(&account_hash, &conversation_hash),
			None,
			INDEX_MAGIC,
		)
		.unwrap();
		let envelope: ConversationIndexEnvelope =
			serde_json::from_slice(&bytes).unwrap();
		assert_eq!(envelope.schema_version, INDEX_SCHEMA_VERSION);
		assert_eq!(
			fs::read_dir(account_dir.join(INDEX_V2_DIR))
				.unwrap()
				.count(),
			2
		);
		// Resume after completed retirement is a stable read, not a duplicate write.
		assert_eq!(
			load_account_index(&root, &account_hash, &key)
				.unwrap()
				.entries
				.len(),
			2
		);
		fs::remove_dir_all(root).unwrap();
	}

	#[test]
	fn interrupted_migration_retains_readable_source_until_verified() {
		let root = temp_dir();
		let account_hash = identifier_hash("account");
		let key = [62_u8; 32];
		let record = DirectMediaEntry::test("private-message", 1);
		let index = save_legacy_records(&root, &account_hash, &key, &[record]);
		let account_dir = root.join(&account_hash);
		let partition = conversation_index_path(
			&account_dir,
			&identifier_hash("conversation"),
		);
		let epoch = CACHE_EPOCH.load(Ordering::Acquire);
		let result = migrate_legacy_index_with_hook(
			&account_dir,
			&account_hash,
			&key,
			&index,
			epoch,
			|| {
				fs::write(&partition, b"interrupted").map_err(|_| {
					cache_error("injected migration interruption")
				})?;
				Ok(())
			},
		);
		assert!(result.is_err());
		assert!(account_dir.join(INDEX_FILE).is_file());
		assert_eq!(
			load_legacy_index(
				&account_dir.join(INDEX_FILE),
				&account_hash,
				&key
			)
			.unwrap()
			.entries
			.len(),
			1
		);
		// A corrupt staged partition must fail closed rather than being silently
		// overwritten. Once the invalid artifact is explicitly removed, migration
		// can resume and retire the still-readable legacy source after verification.
		fs::remove_file(&partition).unwrap();
		migrate_legacy_index(&account_dir, &account_hash, &key, &index, epoch)
			.unwrap();
		assert!(!account_dir.join(INDEX_FILE).exists());
		fs::remove_dir_all(root).unwrap();
	}

	#[test]
	fn migration_resumes_in_bounded_partition_batches() {
		let root = temp_dir();
		let account_hash = identifier_hash("account");
		let key = [64_u8; 32];
		let records = (0..(MIGRATION_PARTITION_BATCH + 2))
			.map(|value| {
				let mut record = DirectMediaEntry::test(
					&format!("message-{value}"),
					value as u64,
				);
				record.conversation_id = format!("conversation-{value}");
				record
			})
			.collect::<Vec<_>>();
		let index = save_legacy_records(&root, &account_hash, &key, &records);
		let account_dir = root.join(&account_hash);
		let epoch = CACHE_EPOCH.load(Ordering::Acquire);
		migrate_legacy_index(&account_dir, &account_hash, &key, &index, epoch)
			.unwrap();
		assert!(account_dir.join(INDEX_FILE).is_file());
		assert_eq!(
			load_v2_indexes(&account_dir, &account_hash, &key)
				.unwrap()
				.entries
				.len(),
			MIGRATION_PARTITION_BATCH
		);
		migrate_legacy_index(&account_dir, &account_hash, &key, &index, epoch)
			.unwrap();
		assert!(!account_dir.join(INDEX_FILE).exists());
		assert_eq!(
			load_v2_indexes(&account_dir, &account_hash, &key)
				.unwrap()
				.entries
				.len(),
			MIGRATION_PARTITION_BATCH + 2
		);
		fs::remove_dir_all(root).unwrap();
	}

	#[test]
	fn migration_retains_source_when_encrypted_record_pointer_is_stale() {
		let root = temp_dir();
		let account_hash = identifier_hash("account");
		let key = [65_u8; 32];
		let record = DirectMediaEntry::test("message", 1);
		let index =
			save_legacy_records(&root, &account_hash, &key, &[record.clone()]);
		let mut mismatched = record;
		mismatched.sent_at = 99;
		save_record(&root, &account_hash, &index.entries[0], &key, &mismatched)
			.unwrap();
		let account_dir = root.join(&account_hash);
		let epoch = CACHE_EPOCH.load(Ordering::Acquire);
		assert!(migrate_legacy_index(
			&account_dir,
			&account_hash,
			&key,
			&index,
			epoch
		)
		.is_err());
		assert!(account_dir.join(INDEX_FILE).is_file());
		fs::remove_dir_all(root).unwrap();
	}

	#[test]
	fn newer_legacy_entry_overrides_stale_authenticated_v2_before_retirement() {
		let root = temp_dir();
		let account_hash = identifier_hash("account");
		let key = [66_u8; 32];
		let mut legacy_record = DirectMediaEntry::test("message", 20);
		legacy_record.remote_availability = RemoteAvailability::Expired;
		let legacy =
			save_legacy_records(&root, &account_hash, &key, &[legacy_record]);
		let mut stale = legacy.entries[0].clone();
		stale.sent_at = 1;
		stale.last_accessed_ms = 1;
		let conversation_hash = stale.conversation_hash.clone();
		save_conversation_index(
			&root.join(&account_hash),
			&account_hash,
			&conversation_hash,
			&key,
			&AccountIndex {
				entries: vec![stale],
			},
		)
		.unwrap();
		let loaded = load_account_index(&root, &account_hash, &key).unwrap();
		assert_eq!(loaded.entries, legacy.entries);
		assert!(!root.join(&account_hash).join(INDEX_FILE).exists());
		let migrated =
			load_v2_indexes(&root.join(&account_hash), &account_hash, &key)
				.unwrap();
		assert_eq!(migrated.entries, legacy.entries);
		fs::remove_dir_all(root).unwrap();
	}

	#[test]
	fn corrupt_v2_partition_fails_closed_while_legacy_source_remains() {
		let root = temp_dir();
		let account_hash = identifier_hash("account");
		let key = [68_u8; 32];
		let legacy_record = DirectMediaEntry::test("legacy-message", 20);
		let legacy =
			save_legacy_records(&root, &account_hash, &key, &[legacy_record]);
		let account_dir = root.join(&account_hash);
		let conversation_hash = legacy.entries[0].conversation_hash.clone();
		save_conversation_index(
			&account_dir,
			&account_hash,
			&conversation_hash,
			&key,
			&legacy,
		)
		.unwrap();
		let partition =
			conversation_index_path(&account_dir, &conversation_hash);
		fs::write(&partition, b"corrupt-current-partition").unwrap();
		let corrupt_bytes = fs::read(&partition).unwrap();

		assert!(load_account_index(&root, &account_hash, &key).is_err());
		assert!(account_dir.join(INDEX_FILE).is_file());
		assert_eq!(fs::read(partition).unwrap(), corrupt_bytes);

		fs::remove_dir_all(root).unwrap();
	}

	#[test]
	fn normal_persistence_rewrites_only_changed_conversation_partition() {
		let root = temp_dir();
		let account_hash = identifier_hash("account");
		let key = [67_u8; 32];
		let records = (0..10)
			.map(|value| {
				let mut record =
					DirectMediaEntry::test(&format!("message-{value}"), value);
				record.conversation_id = format!("conversation-{value}");
				record
			})
			.collect::<Vec<_>>();
		let before = AccountIndex {
			entries: records
				.iter()
				.enumerate()
				.map(|(position, record)| {
					reference_for(record, format!("record-{position}.ogdr"))
				})
				.collect(),
		};
		save_account_index(&root, &account_hash, &key, &before).unwrap();
		let unchanged_hash = identifier_hash("conversation-9");
		let unchanged_path =
			conversation_index_path(&root.join(&account_hash), &unchanged_hash);
		let unchanged_bytes = fs::read(&unchanged_path).unwrap();
		let mut after = before.clone();
		after.entries[0].last_accessed_ms += 100;
		persist_account_index_changes(
			&root,
			&account_hash,
			&key,
			&before,
			&after,
		)
		.unwrap();
		assert_eq!(fs::read(unchanged_path).unwrap(), unchanged_bytes);
		fs::remove_dir_all(root).unwrap();
	}

	#[test]
	fn cache_epoch_change_fences_legacy_source_retirement() {
		let root = temp_dir();
		let account_hash = identifier_hash("account");
		let key = [63_u8; 32];
		let record = DirectMediaEntry::test("message", 1);
		let index = save_legacy_records(&root, &account_hash, &key, &[record]);
		let account_dir = root.join(&account_hash);
		let stale_epoch = CACHE_EPOCH.load(Ordering::Acquire).wrapping_sub(1);
		assert!(migrate_legacy_index(
			&account_dir,
			&account_hash,
			&key,
			&index,
			stale_epoch
		)
		.is_err());
		assert!(account_dir.join(INDEX_FILE).is_file());
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
		let middle = vec![7_u8; CHUNK_SIZE * 3];
		record.byte_length = Some(middle.len() as u64);
		write_encrypted_atomic(
			&path,
			&middle,
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
		let mut corrupted_middle = fs::read(&path).unwrap();
		let midpoint = corrupted_middle.len() / 2;
		corrupted_middle[midpoint] ^= 0x80;
		fs::write(&path, corrupted_middle).unwrap();
		assert!(probe_verified_entry_media(
			&account_dir,
			&account_hash,
			&key,
			&record,
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
