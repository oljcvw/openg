use std::{
	collections::{HashMap, HashSet},
	fs,
	path::{Path, PathBuf},
	sync::atomic::{AtomicU64, Ordering},
};

use serde::{Deserialize, Serialize};
use tauri::{http, Manager};

use crate::{
	api::encrypted_media_store::{
		aad_prefix as encrypted_aad_prefix, cdn_host_allowed,
		delete_key as delete_encryption_key, identifier_hash, load_json_index,
		load_key as load_encryption_key,
		load_or_create_key as load_or_create_encryption_key, media_error,
		now_ms as encrypted_now_ms, parse_range,
		protocol_url as encrypted_protocol_url,
		random_token as encrypted_random_token, read_encrypted_range,
		same_media_category, save_json_index, stream_encrypted_atomic,
		validate_cdn_url, validate_content_type, validate_identifier,
		write_encrypted_atomic,
	},
	error::AppError,
	storage::AuthStorage,
};

const SCHEME: &str = "album-cache";
const CACHE_DIR: &str = "album-cache-v1";
const INDEX_FILE: &str = "index.json";
const RECORD_INDEX_FILE: &str = "records.json";
const MAGIC: &[u8; 8] = b"OGALBC01";
const RECORD_MAGIC: &[u8; 8] = b"OGALBR02";
const MEMBERSHIP_MAGIC: &[u8; 8] = b"OGALMS05";
const KEY_SERVICE: &str = "open-grind-album-cache";
static CACHE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static CACHE_EPOCH: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheEntry {
	account_hash: String,
	#[serde(default)]
	owner_hash: String,
	album_hash: String,
	content_hash: String,
	content_type: String,
	byte_length: u64,
	file_name: String,
	token: String,
	last_accessed_ms: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct CacheIndex {
	entries: Vec<CacheEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AlbumRecordEntry {
	account_hash: String,
	owner_hash: String,
	album_hash: String,
	file_name: String,
	last_accessed_ms: u64,
	#[serde(default)]
	history_order: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumMembershipSnapshot {
	version: u8,
	current_album_ids: Vec<u64>,
	listed_at: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct AlbumRecordIndex {
	entries: Vec<AlbumRecordEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumRecordPage {
	pub records: Vec<serde_json::Value>,
	pub next_cursor: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumCacheStored {
	pub token: String,
	pub protocol_url: String,
	pub byte_length: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumCacheLookup {
	pub found: bool,
	pub token: Option<String>,
	pub protocol_url: Option<String>,
	pub byte_length: Option<u64>,
	pub content_type: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumCacheStats {
	pub byte_length: u64,
	pub entry_count: u64,
	pub album_count: u64,
	pub account_count: u64,
}

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
	tauri::plugin::Builder::new("open-grind-album-cache")
		.register_asynchronous_uri_scheme_protocol(
			SCHEME,
			|context, request, responder| {
				let app = context.app_handle().clone();
				tauri::async_runtime::spawn(async move {
					let response = serve_protocol(app, request).await;
					responder.respond(response);
				});
			},
		)
		.build()
}

#[tauri::command]
pub async fn album_cache_store(
	app: tauri::AppHandle,
	account_id: String,
	owner_profile_id: String,
	album_id: String,
	content_id: String,
	source_url: String,
	content_type: String,
	maximum_bytes: u64,
) -> Result<AlbumCacheStored, AppError> {
	validate_identifier(&account_id)?;
	ensure_active_account(&account_id)?;
	validate_identifier(&owner_profile_id)?;
	validate_identifier(&album_id)?;
	validate_identifier(&content_id)?;
	validate_content_type(&content_type)?;
	let source = validate_cdn_url(&source_url)?;
	if maximum_bytes == 0 {
		return Err(cache_error("maximumBytes must be greater than zero"));
	}

	let operation_epoch = CACHE_EPOCH.load(Ordering::Acquire);
	let client = reqwest::Client::builder()
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
		.map_err(|_| cache_error("could not initialize media downloader"))?;
	let response = client
		.get(source)
		.send()
		.await
		.map_err(|_| cache_error("media download failed"))?;
	if !response.status().is_success() {
		return Err(cache_error(&format!(
			"media download returned HTTP {}",
			response.status().as_u16()
		)));
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
	if let Some(received_type) =
		response.headers().get(http::header::CONTENT_TYPE)
	{
		let received_type = received_type.to_str().unwrap_or_default();
		if !same_media_category(&content_type, received_type) {
			return Err(cache_error(
				"media content type does not match request",
			));
		}
	}

	let root = cache_root(&app)?;
	let account_hash = identifier_hash(&account_id);
	let owner_hash = identifier_hash(&owner_profile_id);
	let album_hash = identifier_hash(&album_id);
	let content_hash = identifier_hash(&content_id);
	let key = {
		let _guard = CACHE_LOCK.lock().await;
		load_or_create_encryption_key(KEY_SERVICE, &account_hash)?
	};
	let token = random_token();
	let file_name = format!("{}.ogac", random_token());
	let account_dir = root.join(&account_hash);
	fs::create_dir_all(&account_dir)
		.map_err(|_| cache_error("could not create album cache directory"))?;
	let destination = account_dir.join(&file_name);
	let byte_length = stream_encrypted_atomic(
		response,
		&destination,
		&key,
		&aad_prefix_v2(
			&account_hash,
			&owner_hash,
			&album_hash,
			&content_hash,
			&content_type,
		),
		maximum_bytes,
		MAGIC,
	)
	.await?;
	if CACHE_EPOCH.load(Ordering::Acquire) != operation_epoch
		|| ensure_active_account(&account_id).is_err()
	{
		let _ = fs::remove_file(&destination);
		return Err(AppError::RequestCancelled);
	}

	let _guard = CACHE_LOCK.lock().await;
	if CACHE_EPOCH.load(Ordering::Acquire) != operation_epoch
		|| ensure_active_account(&account_id).is_err()
	{
		let _ = fs::remove_file(&destination);
		return Err(AppError::RequestCancelled);
	}
	let mut index = load_index(&root)?;
	let old_files: Vec<PathBuf> = index
		.entries
		.iter()
		.filter(|entry| {
			entry.account_hash == account_hash
				&& entry.owner_hash == owner_hash
				&& entry.album_hash == album_hash
				&& entry.content_hash == content_hash
		})
		.map(|entry| entry_path(&root, entry))
		.collect();
	index.entries.retain(|entry| {
		!(entry.account_hash == account_hash
			&& entry.owner_hash == owner_hash
			&& entry.album_hash == album_hash
			&& entry.content_hash == content_hash)
	});
	index.entries.push(CacheEntry {
		account_hash,
		owner_hash,
		album_hash,
		content_hash,
		content_type,
		byte_length,
		file_name,
		token: token.clone(),
		last_accessed_ms: now_ms(),
	});
	if let Err(error) = save_index(&root, &index) {
		let _ = fs::remove_file(&destination);
		return Err(error);
	}
	for path in old_files {
		let _ = fs::remove_file(path);
	}

	Ok(AlbumCacheStored {
		protocol_url: protocol_url(&token),
		token,
		byte_length,
	})
}

#[tauri::command]
pub async fn album_cache_lookup(
	app: tauri::AppHandle,
	account_id: String,
	owner_profile_id: String,
	album_id: String,
	content_id: String,
) -> Result<AlbumCacheLookup, AppError> {
	ensure_active_account(&account_id)?;
	validate_identifier(&owner_profile_id)?;
	let root = cache_root(&app)?;
	let account_hash = identifier_hash(&account_id);
	let owner_hash = identifier_hash(&owner_profile_id);
	let album_hash = identifier_hash(&album_id);
	let content_hash = identifier_hash(&content_id);
	let _guard = CACHE_LOCK.lock().await;
	let mut index = load_index(&root)?;
	let Some(entry) = index.entries.iter_mut().find(|entry| {
		entry.account_hash == account_hash
			&& entry.owner_hash == owner_hash
			&& entry.album_hash == album_hash
			&& entry.content_hash == content_hash
	}) else {
		return Ok(AlbumCacheLookup {
			found: false,
			token: None,
			protocol_url: None,
			byte_length: None,
			content_type: None,
		});
	};
	if !entry_path(&root, entry).is_file() {
		return Ok(AlbumCacheLookup {
			found: false,
			token: None,
			protocol_url: None,
			byte_length: None,
			content_type: None,
		});
	}
	entry.last_accessed_ms = now_ms();
	let result = AlbumCacheLookup {
		found: true,
		token: Some(entry.token.clone()),
		protocol_url: Some(protocol_url(&entry.token)),
		byte_length: Some(entry.byte_length),
		content_type: Some(entry.content_type.clone()),
	};
	save_index(&root, &index)?;
	Ok(result)
}

#[tauri::command]
pub async fn album_cache_bind_legacy_owner(
	app: tauri::AppHandle,
	account_id: String,
	owner_profile_id: String,
	album_id: String,
) -> Result<u64, AppError> {
	let operation_epoch = CACHE_EPOCH.load(Ordering::Acquire);
	validate_composite_identity(&account_id, &owner_profile_id, &album_id)?;
	ensure_active_account(&account_id)?;
	let root = cache_root(&app)?;
	let account_hash = identifier_hash(&account_id);
	let owner_hash = identifier_hash(&owner_profile_id);
	let album_hash = identifier_hash(&album_id);
	let _guard = CACHE_LOCK.lock().await;
	if CACHE_EPOCH.load(Ordering::Acquire) != operation_epoch
		|| ensure_active_account(&account_id).is_err()
	{
		return Err(AppError::RequestCancelled);
	}
	let key = load_encryption_key(KEY_SERVICE, &account_hash)?;
	let mut index = load_index(&root)?;
	let legacy = index
		.entries
		.iter()
		.filter(|entry| {
			entry.account_hash == account_hash
				&& entry.owner_hash.is_empty()
				&& entry.album_hash == album_hash
		})
		.cloned()
		.collect::<Vec<_>>();
	let mut replacements = Vec::with_capacity(legacy.len());
	for entry in &legacy {
		let bytes = read_encrypted_range(
			&entry_path(&root, entry),
			&key,
			&aad_prefix(
				&entry.account_hash,
				&entry.album_hash,
				&entry.content_hash,
				&entry.content_type,
			),
			None,
			MAGIC,
		)?;
		let mut replacement = entry.clone();
		replacement.owner_hash = owner_hash.clone();
		replacement.file_name = format!("{}.ogac", random_token());
		if let Err(error) = write_encrypted_atomic(
			&entry_path(&root, &replacement),
			&bytes,
			&key,
			&entry_aad(&replacement),
			MAGIC,
		) {
			for (_, created) in &replacements {
				let _ = fs::remove_file(entry_path(&root, created));
			}
			return Err(error);
		}
		replacements.push((entry.clone(), replacement));
	}
	for (legacy, replacement) in &replacements {
		if let Some(entry) = index.entries.iter_mut().find(|entry| {
			entry.account_hash == legacy.account_hash
				&& entry.owner_hash.is_empty()
				&& entry.album_hash == legacy.album_hash
				&& entry.content_hash == legacy.content_hash
				&& entry.file_name == legacy.file_name
		}) {
			*entry = replacement.clone();
		}
	}
	if let Err(error) = save_index(&root, &index) {
		for (_, created) in &replacements {
			let _ = fs::remove_file(entry_path(&root, created));
		}
		return Err(error);
	}
	for (legacy, _) in &replacements {
		let _ = fs::remove_file(entry_path(&root, legacy));
	}
	Ok(replacements.len() as u64)
}

#[tauri::command]
pub async fn album_cache_record_store(
	app: tauri::AppHandle,
	account_id: String,
	owner_profile_id: String,
	album_id: String,
	record: serde_json::Value,
) -> Result<(), AppError> {
	let operation_epoch = CACHE_EPOCH.load(Ordering::Acquire);
	validate_composite_identity(&account_id, &owner_profile_id, &album_id)?;
	ensure_active_account(&account_id)?;
	if contains_remote_url(&record) {
		return Err(cache_error("album metadata must not contain remote URLs"));
	}
	let bytes = serde_json::to_vec(&record)
		.map_err(|_| cache_error("could not encode album metadata"))?;
	if bytes.is_empty() || bytes.len() > 4 * 1024 * 1024 {
		return Err(cache_error(
			"album metadata size is outside the supported range",
		));
	}
	let root = cache_root(&app)?;
	let account_hash = identifier_hash(&account_id);
	let owner_hash = identifier_hash(&owner_profile_id);
	let album_hash = identifier_hash(&album_id);
	let _guard = CACHE_LOCK.lock().await;
	if CACHE_EPOCH.load(Ordering::Acquire) != operation_epoch
		|| ensure_active_account(&account_id).is_err()
	{
		return Err(AppError::RequestCancelled);
	}
	let key = load_or_create_encryption_key(KEY_SERVICE, &account_hash)?;
	let mut index: AlbumRecordIndex =
		load_json_index(&root, RECORD_INDEX_FILE)?;
	let previous = index.entries.iter().find(|entry| {
		entry.account_hash == account_hash
			&& entry.owner_hash == owner_hash
			&& entry.album_hash == album_hash
	});
	let history_order = history_order_for_record(&record, previous);
	let file_name = previous
		.map(|entry| entry.file_name.clone())
		.unwrap_or_else(|| format!("record-{}.ogar", random_token()));
	let account_dir = root.join(&account_hash);
	fs::create_dir_all(&account_dir)
		.map_err(|_| cache_error("could not create album cache directory"))?;
	write_encrypted_atomic(
		&account_dir.join(&file_name),
		&bytes,
		&key,
		&record_aad(&account_hash, &owner_hash, &album_hash),
		RECORD_MAGIC,
	)?;
	index.entries.retain(|entry| {
		!(entry.account_hash == account_hash
			&& entry.owner_hash == owner_hash
			&& entry.album_hash == album_hash)
	});
	index.entries.push(AlbumRecordEntry {
		account_hash,
		owner_hash,
		album_hash,
		file_name,
		last_accessed_ms: record
			.get("lastAccessedAt")
			.and_then(serde_json::Value::as_u64)
			.unwrap_or_else(now_ms),
		history_order,
	});
	save_json_index(&root, RECORD_INDEX_FILE, &index)
}

#[tauri::command]
pub async fn album_cache_record_read(
	app: tauri::AppHandle,
	account_id: String,
	owner_profile_id: String,
	album_id: String,
) -> Result<Option<serde_json::Value>, AppError> {
	validate_composite_identity(&account_id, &owner_profile_id, &album_id)?;
	ensure_active_account(&account_id)?;
	let root = cache_root(&app)?;
	let account_hash = identifier_hash(&account_id);
	let owner_hash = identifier_hash(&owner_profile_id);
	let album_hash = identifier_hash(&album_id);
	let _guard = CACHE_LOCK.lock().await;
	let index: AlbumRecordIndex = load_json_index(&root, RECORD_INDEX_FILE)?;
	let Some(entry) = index.entries.iter().find(|entry| {
		entry.account_hash == account_hash
			&& entry.owner_hash == owner_hash
			&& entry.album_hash == album_hash
	}) else {
		return Ok(None);
	};
	read_record(&root, entry).map(Some)
}

#[tauri::command]
pub async fn album_cache_records_page(
	app: tauri::AppHandle,
	account_id: String,
	owner_profile_id: String,
	cursor: Option<String>,
) -> Result<AlbumRecordPage, AppError> {
	validate_identifier(&account_id)?;
	validate_identifier(&owner_profile_id)?;
	ensure_active_account(&account_id)?;
	let root = cache_root(&app)?;
	let account_hash = identifier_hash(&account_id);
	let owner_hash = identifier_hash(&owner_profile_id);
	let _guard = CACHE_LOCK.lock().await;
	let index: AlbumRecordIndex = load_json_index(&root, RECORD_INDEX_FILE)?;
	let mut matching: Vec<_> = index
		.entries
		.iter()
		.filter(|entry| {
			entry.account_hash == account_hash && entry.owner_hash == owner_hash
		})
		.collect();
	matching.sort_by(|left, right| compare_record_entries(left, right));
	let start = match cursor {
		None => 0,
		Some(cursor) => matching
			.iter()
			.position(|entry| entry.album_hash == cursor)
			.map(|index| index + 1)
			.ok_or_else(|| cache_error("album history cursor is invalid"))?,
	};
	let page = matching
		.into_iter()
		.skip(start)
		.take(61)
		.collect::<Vec<_>>();
	let has_more = page.len() > 60;
	let records = page
		.iter()
		.take(60)
		.map(|entry| read_record(&root, entry))
		.collect::<Result<Vec<_>, _>>()?;
	let next_cursor = has_more.then(|| page[59].album_hash.clone());
	Ok(AlbumRecordPage {
		records,
		next_cursor,
	})
}

#[tauri::command]
pub async fn album_cache_membership_snapshot_store(
	app: tauri::AppHandle,
	account_id: String,
	owner_profile_id: String,
	current_album_ids: Vec<u64>,
	listed_at: u64,
) -> Result<(), AppError> {
	validate_identifier(&account_id)?;
	validate_identifier(&owner_profile_id)?;
	ensure_active_account(&account_id)?;
	let snapshot = AlbumMembershipSnapshot {
		version: 5,
		current_album_ids,
		listed_at,
	};
	let root = cache_root(&app)?;
	let account_hash = identifier_hash(&account_id);
	let owner_hash = identifier_hash(&owner_profile_id);
	let _guard = CACHE_LOCK.lock().await;
	ensure_active_account(&account_id)?;
	let key = load_or_create_encryption_key(KEY_SERVICE, &account_hash)?;
	store_membership_snapshot(
		&root,
		&account_hash,
		&owner_hash,
		&snapshot,
		&key,
	)
}

#[tauri::command]
pub async fn album_cache_membership_snapshot_read(
	app: tauri::AppHandle,
	account_id: String,
	owner_profile_id: String,
) -> Result<Option<AlbumMembershipSnapshot>, AppError> {
	validate_identifier(&account_id)?;
	validate_identifier(&owner_profile_id)?;
	ensure_active_account(&account_id)?;
	let root = cache_root(&app)?;
	let account_hash = identifier_hash(&account_id);
	let owner_hash = identifier_hash(&owner_profile_id);
	let _guard = CACHE_LOCK.lock().await;
	if !membership_snapshot_path(&root, &account_hash, &owner_hash).is_file() {
		return Ok(None);
	}
	let key = load_encryption_key(KEY_SERVICE, &account_hash)?;
	read_membership_snapshot(&root, &account_hash, &owner_hash, &key)
}

#[tauri::command]
pub async fn album_cache_records_reconcile_membership(
	app: tauri::AppHandle,
	account_id: String,
	owner_profile_id: String,
	current_album_ids: Vec<String>,
	listed_at: u64,
) -> Result<(), AppError> {
	validate_identifier(&account_id)?;
	validate_identifier(&owner_profile_id)?;
	for album_id in &current_album_ids {
		validate_identifier(album_id)?;
	}
	ensure_active_account(&account_id)?;
	let current = current_album_ids.into_iter().collect::<HashSet<_>>();
	let root = cache_root(&app)?;
	let account_hash = identifier_hash(&account_id);
	let owner_hash = identifier_hash(&owner_profile_id);
	let _guard = CACHE_LOCK.lock().await;
	let index: AlbumRecordIndex = load_json_index(&root, RECORD_INDEX_FILE)?;
	let key = load_or_create_encryption_key(KEY_SERVICE, &account_hash)?;
	for entry in index.entries.iter().filter(|entry| {
		entry.account_hash == account_hash && entry.owner_hash == owner_hash
	}) {
		let mut record = read_record(&root, entry)?;
		reconcile_record_membership(&mut record, &current, listed_at)?;
		let bytes = serde_json::to_vec(&record)
			.map_err(|_| cache_error("could not encode album metadata"))?;
		write_encrypted_atomic(
			&root.join(&account_hash).join(&entry.file_name),
			&bytes,
			&key,
			&record_aad(&account_hash, &owner_hash, &entry.album_hash),
			RECORD_MAGIC,
		)?;
	}
	Ok(())
}

fn reconcile_record_membership(
	record: &mut serde_json::Value,
	current_album_ids: &HashSet<String>,
	listed_at: u64,
) -> Result<(), AppError> {
	let album_id = record
		.pointer("/identity/albumId")
		.and_then(serde_json::Value::as_u64)
		.map(|value| value.to_string())
		.ok_or_else(|| cache_error("album history identity is invalid"))?;
	let is_current = current_album_ids.contains(&album_id);
	let membership = record
		.get_mut("membership")
		.and_then(serde_json::Value::as_object_mut)
		.ok_or_else(|| cache_error("album history membership is invalid"))?;
	membership.insert(
		"isCurrentlyShared".into(),
		serde_json::Value::Bool(is_current),
	);
	membership.insert(
		"lastListedAt".into(),
		serde_json::Value::Number(listed_at.into()),
	);
	if is_current {
		membership.insert("unavailableReason".into(), serde_json::Value::Null);
	} else if membership
		.get("unavailableReason")
		.is_none_or(serde_json::Value::is_null)
	{
		membership.insert(
			"unavailableReason".into(),
			serde_json::Value::String("unshared".into()),
		);
	}
	Ok(())
}

#[tauri::command]
pub async fn album_cache_stats(
	app: tauri::AppHandle,
	account_id: Option<String>,
) -> Result<AlbumCacheStats, AppError> {
	if let Some(account_id) = account_id.as_deref() {
		ensure_active_account(account_id)?;
	}
	let root = cache_root(&app)?;
	let _guard = CACHE_LOCK.lock().await;
	let account_hash = account_id.as_deref().map(identifier_hash);
	Ok(stats_for(&load_index(&root)?, account_hash.as_deref()))
}

#[tauri::command]
pub async fn album_cache_trim(
	app: tauri::AppHandle,
	maximum_bytes: u64,
) -> Result<AlbumCacheStats, AppError> {
	let root = cache_root(&app)?;
	let _guard = CACHE_LOCK.lock().await;
	let mut index = load_index(&root)?;
	trim_index(&root, &mut index, maximum_bytes)?;
	save_index(&root, &index)?;
	Ok(stats_for(&index, None))
}

#[tauri::command]
pub async fn album_cache_clear(
	app: tauri::AppHandle,
	account_id: Option<String>,
) -> Result<AlbumCacheStats, AppError> {
	CACHE_EPOCH.fetch_add(1, Ordering::AcqRel);
	if let Some(account_id) = account_id.as_deref() {
		ensure_active_account(account_id)?;
	}
	let root = cache_root(&app)?;
	let _guard = CACHE_LOCK.lock().await;
	let mut index = load_index(&root)?;
	let mut record_index: AlbumRecordIndex =
		load_json_index(&root, RECORD_INDEX_FILE)?;
	let requested_hash = account_id.as_deref().map(identifier_hash);
	let mut removed_accounts: HashSet<String> = index
		.entries
		.iter()
		.filter(|entry| {
			requested_hash
				.as_ref()
				.is_none_or(|id| id == &entry.account_hash)
		})
		.map(|entry| entry.account_hash.clone())
		.collect();
	removed_accounts.extend(
		record_index
			.entries
			.iter()
			.filter(|entry| {
				requested_hash
					.as_ref()
					.is_none_or(|id| id == &entry.account_hash)
			})
			.map(|entry| entry.account_hash.clone()),
	);
	if let Some(requested_hash) = requested_hash.as_ref() {
		removed_accounts.insert(requested_hash.clone());
	} else {
		removed_accounts.extend(account_directories(&root)?);
	}
	for entry in &index.entries {
		if requested_hash
			.as_ref()
			.is_none_or(|id| id == &entry.account_hash)
		{
			let _ = fs::remove_file(entry_path(&root, entry));
		}
	}
	index.entries.retain(|entry| {
		requested_hash
			.as_ref()
			.is_some_and(|id| id != &entry.account_hash)
	});
	record_index.entries.retain(|entry| {
		requested_hash
			.as_ref()
			.is_some_and(|id| id != &entry.account_hash)
	});
	clear_account_artifacts(&root, removed_accounts, |account_hash| {
		delete_encryption_key(KEY_SERVICE, account_hash)
	})?;
	save_index(&root, &index)?;
	save_json_index(&root, RECORD_INDEX_FILE, &record_index)?;
	Ok(stats_for(&index, None))
}

fn account_directories(root: &Path) -> Result<HashSet<String>, AppError> {
	let entries = match fs::read_dir(root) {
		Ok(entries) => entries,
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
			return Ok(HashSet::new());
		}
		Err(_) => {
			return Err(cache_error("could not enumerate album cache accounts"))
		}
	};
	let mut account_hashes = HashSet::new();
	for entry in entries {
		let entry = entry.map_err(|_| {
			cache_error("could not enumerate album cache accounts")
		})?;
		if entry
			.file_type()
			.map_err(|_| cache_error("could not inspect album cache account"))?
			.is_dir()
		{
			account_hashes
				.insert(entry.file_name().to_string_lossy().into_owned());
		}
	}
	Ok(account_hashes)
}

fn clear_account_artifacts<F>(
	root: &Path,
	account_hashes: HashSet<String>,
	mut delete_key: F,
) -> Result<(), AppError>
where
	F: FnMut(&str) -> Result<(), AppError>,
{
	for account_hash in account_hashes {
		let account_dir = root.join(&account_hash);
		match fs::remove_dir_all(&account_dir) {
			Ok(()) => {}
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
			Err(_) => {
				return Err(cache_error("could not clear album cache account"))
			}
		}
		delete_key(&account_hash)?;
	}
	Ok(())
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
	let token = request
		.uri()
		.path()
		.trim_matches('/')
		.split('/')
		.next()
		.filter(|token| {
			!token.is_empty()
				&& !request.uri().path().trim_matches('/').contains('/')
		})
		.ok_or(http::StatusCode::BAD_REQUEST)?;
	let root =
		cache_root(app).map_err(|_| http::StatusCode::INTERNAL_SERVER_ERROR)?;
	let _guard = CACHE_LOCK.lock().await;
	let mut index = load_index(&root)
		.map_err(|_| http::StatusCode::INTERNAL_SERVER_ERROR)?;
	let entry = index
		.entries
		.iter_mut()
		.find(|entry| entry.token == token)
		.ok_or(http::StatusCode::NOT_FOUND)?;
	let active_account_hash = AuthStorage::get_session()
		.map_err(|_| http::StatusCode::UNAUTHORIZED)?
		.map(|session| identifier_hash(&session.profile_id))
		.ok_or(http::StatusCode::UNAUTHORIZED)?;
	if entry.account_hash != active_account_hash {
		return Err(http::StatusCode::NOT_FOUND);
	}
	if entry.owner_hash.is_empty() {
		return Err(http::StatusCode::GONE);
	}
	let key = load_encryption_key(KEY_SERVICE, &entry.account_hash)
		.map_err(|_| http::StatusCode::GONE)?;
	let range = parse_range(
		request.headers().get(http::header::RANGE),
		entry.byte_length,
	)?;
	let body = if request.method() == http::Method::HEAD {
		Vec::new()
	} else {
		read_encrypted_range(
			&entry_path(&root, entry),
			&key,
			&entry_aad(entry),
			range,
			MAGIC,
		)
		.map_err(|_| http::StatusCode::GONE)?
	};
	entry.last_accessed_ms = now_ms();
	let content_type = entry.content_type.clone();
	let total = entry.byte_length;
	let _ = save_index(&root, &index);
	build_media_response(request.method(), &content_type, total, range, body)
}

fn build_media_response(
	method: &http::Method,
	content_type: &str,
	total: u64,
	range: Option<(u64, u64)>,
	body: Vec<u8>,
) -> Result<http::Response<Vec<u8>>, http::StatusCode> {
	let (start, end) = range.unwrap_or((0, total.saturating_sub(1)));
	let partial = range.is_some();
	let content_length = if method == http::Method::HEAD && !partial {
		total
	} else {
		end - start + 1
	};
	let mut response = http::Response::builder()
		.status(if partial {
			http::StatusCode::PARTIAL_CONTENT
		} else {
			http::StatusCode::OK
		})
		.header(http::header::CONTENT_TYPE, content_type)
		.header(http::header::ACCEPT_RANGES, "bytes")
		.header(http::header::CACHE_CONTROL, "no-store")
		.header(http::header::CONTENT_LENGTH, content_length);
	if partial {
		response = response.header(
			http::header::CONTENT_RANGE,
			format!("bytes {start}-{end}/{total}"),
		);
	}
	response
		.body(body)
		.map_err(|_| http::StatusCode::INTERNAL_SERVER_ERROR)
}

fn cache_root(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
	app.path()
		.app_data_dir()
		.map(|path| path.join(CACHE_DIR))
		.map_err(|_| cache_error("could not resolve album cache directory"))
}

fn ensure_active_account(account_id: &str) -> Result<(), AppError> {
	let session = AuthStorage::get_session()?
		.ok_or_else(|| cache_error("album cache requires an active account"))?;
	if session.profile_id == account_id {
		Ok(())
	} else {
		Err(cache_error(
			"album cache account does not match active account",
		))
	}
}

fn validate_composite_identity(
	account_id: &str,
	owner_profile_id: &str,
	album_id: &str,
) -> Result<(), AppError> {
	validate_identifier(account_id)?;
	validate_identifier(owner_profile_id)?;
	validate_identifier(album_id)
}

fn contains_remote_url(value: &serde_json::Value) -> bool {
	match value {
		serde_json::Value::String(value) => {
			value.starts_with("http://") || value.starts_with("https://")
		}
		serde_json::Value::Array(values) => {
			values.iter().any(contains_remote_url)
		}
		serde_json::Value::Object(values) => {
			values.values().any(contains_remote_url)
		}
		_ => false,
	}
}

fn record_aad(
	account_hash: &str,
	owner_hash: &str,
	album_hash: &str,
) -> Vec<u8> {
	encrypted_aad_prefix("record-v2", &[account_hash, owner_hash, album_hash])
}

fn compare_record_entries(
	left: &AlbumRecordEntry,
	right: &AlbumRecordEntry,
) -> std::cmp::Ordering {
	match (left.history_order, right.history_order) {
		(None, None) => right
			.last_accessed_ms
			.cmp(&left.last_accessed_ms)
			.then_with(|| left.album_hash.cmp(&right.album_hash)),
		(None, Some(_)) => std::cmp::Ordering::Less,
		(Some(_), None) => std::cmp::Ordering::Greater,
		(Some(left_order), Some(right_order)) => left_order
			.cmp(&right_order)
			.then_with(|| left.album_hash.cmp(&right.album_hash)),
	}
}

fn history_order_for_record(
	record: &serde_json::Value,
	previous: Option<&AlbumRecordEntry>,
) -> Option<u64> {
	record
		.pointer("/historyOrder/sequence")
		.and_then(serde_json::Value::as_u64)
		.or_else(|| previous.and_then(|entry| entry.history_order))
}

fn membership_snapshot_path(
	root: &Path,
	account_hash: &str,
	owner_hash: &str,
) -> PathBuf {
	root.join(account_hash)
		.join(format!("membership-{owner_hash}.ogam"))
}

fn membership_snapshot_aad(account_hash: &str, owner_hash: &str) -> Vec<u8> {
	encrypted_aad_prefix("membership-v5", &[account_hash, owner_hash])
}

fn store_membership_snapshot(
	root: &Path,
	account_hash: &str,
	owner_hash: &str,
	snapshot: &AlbumMembershipSnapshot,
	key: &[u8; 32],
) -> Result<(), AppError> {
	if snapshot.version != 5 {
		return Err(cache_error(
			"album membership snapshot version is invalid",
		));
	}
	let account_dir = root.join(account_hash);
	fs::create_dir_all(&account_dir)
		.map_err(|_| cache_error("could not create album cache directory"))?;
	let bytes = serde_json::to_vec(snapshot).map_err(|_| {
		cache_error("could not encode album membership snapshot")
	})?;
	write_encrypted_atomic(
		&membership_snapshot_path(root, account_hash, owner_hash),
		&bytes,
		key,
		&membership_snapshot_aad(account_hash, owner_hash),
		MEMBERSHIP_MAGIC,
	)
}

fn read_membership_snapshot(
	root: &Path,
	account_hash: &str,
	owner_hash: &str,
	key: &[u8; 32],
) -> Result<Option<AlbumMembershipSnapshot>, AppError> {
	let path = membership_snapshot_path(root, account_hash, owner_hash);
	if !path.is_file() {
		return Ok(None);
	}
	let bytes = read_encrypted_range(
		&path,
		key,
		&membership_snapshot_aad(account_hash, owner_hash),
		None,
		MEMBERSHIP_MAGIC,
	)?;
	let snapshot: AlbumMembershipSnapshot = serde_json::from_slice(&bytes)
		.map_err(|_| cache_error("album membership snapshot is invalid"))?;
	if snapshot.version != 5 {
		return Err(cache_error(
			"album membership snapshot version is invalid",
		));
	}
	Ok(Some(snapshot))
}

fn read_record(
	root: &Path,
	entry: &AlbumRecordEntry,
) -> Result<serde_json::Value, AppError> {
	let key = load_encryption_key(KEY_SERVICE, &entry.account_hash)?;
	let bytes = read_encrypted_range(
		&root.join(&entry.account_hash).join(&entry.file_name),
		&key,
		&record_aad(&entry.account_hash, &entry.owner_hash, &entry.album_hash),
		None,
		RECORD_MAGIC,
	)?;
	serde_json::from_slice(&bytes)
		.map_err(|_| cache_error("album metadata is invalid"))
}

fn aad_prefix(
	account_hash: &str,
	album_hash: &str,
	content_hash: &str,
	content_type: &str,
) -> Vec<u8> {
	encrypted_aad_prefix(
		"v1",
		&[account_hash, album_hash, content_hash, content_type],
	)
}

fn aad_prefix_v2(
	account_hash: &str,
	owner_hash: &str,
	album_hash: &str,
	content_hash: &str,
	content_type: &str,
) -> Vec<u8> {
	encrypted_aad_prefix(
		"v2",
		&[
			account_hash,
			owner_hash,
			album_hash,
			content_hash,
			content_type,
		],
	)
}

fn entry_aad(entry: &CacheEntry) -> Vec<u8> {
	if entry.owner_hash.is_empty() {
		aad_prefix(
			&entry.account_hash,
			&entry.album_hash,
			&entry.content_hash,
			&entry.content_type,
		)
	} else {
		aad_prefix_v2(
			&entry.account_hash,
			&entry.owner_hash,
			&entry.album_hash,
			&entry.content_hash,
			&entry.content_type,
		)
	}
}

fn load_index(root: &Path) -> Result<CacheIndex, AppError> {
	load_json_index(root, INDEX_FILE)
}

fn save_index(root: &Path, index: &CacheIndex) -> Result<(), AppError> {
	save_json_index(root, INDEX_FILE, index)
}

fn trim_index(
	root: &Path,
	index: &mut CacheIndex,
	maximum_bytes: u64,
) -> Result<(), AppError> {
	let mut total: u64 =
		index.entries.iter().map(|entry| entry.byte_length).sum();
	let mut albums: HashMap<(String, String, String), (u64, u64)> =
		HashMap::new();
	for entry in &index.entries {
		let album = albums
			.entry((
				entry.account_hash.clone(),
				entry.owner_hash.clone(),
				entry.album_hash.clone(),
			))
			.or_insert((0, entry.last_accessed_ms));
		album.0 += entry.byte_length;
		album.1 = album.1.max(entry.last_accessed_ms);
	}
	let mut albums: Vec<_> = albums.into_iter().collect();
	albums.sort_by_key(|(_, (_, accessed))| *accessed);
	let mut evict = HashSet::new();
	for ((account, owner, album), (bytes, _)) in albums {
		if total <= maximum_bytes {
			break;
		}
		total = total.saturating_sub(bytes);
		evict.insert((account, owner, album));
	}
	for entry in &index.entries {
		if evict.contains(&(
			entry.account_hash.clone(),
			entry.owner_hash.clone(),
			entry.album_hash.clone(),
		)) {
			let _ = fs::remove_file(entry_path(root, entry));
		}
	}
	index.entries.retain(|entry| {
		!evict.contains(&(
			entry.account_hash.clone(),
			entry.owner_hash.clone(),
			entry.album_hash.clone(),
		))
	});
	Ok(())
}

fn stats_for(index: &CacheIndex, account_id: Option<&str>) -> AlbumCacheStats {
	let entries: Vec<_> = index
		.entries
		.iter()
		.filter(|entry| account_id.is_none_or(|id| id == entry.account_hash))
		.collect();
	AlbumCacheStats {
		byte_length: entries.iter().map(|entry| entry.byte_length).sum(),
		entry_count: entries.len() as u64,
		album_count: entries
			.iter()
			.map(|entry| {
				(&entry.account_hash, &entry.owner_hash, &entry.album_hash)
			})
			.collect::<HashSet<_>>()
			.len() as u64,
		account_count: entries
			.iter()
			.map(|entry| &entry.account_hash)
			.collect::<HashSet<_>>()
			.len() as u64,
	}
}

fn entry_path(root: &Path, entry: &CacheEntry) -> PathBuf {
	root.join(&entry.account_hash).join(&entry.file_name)
}

fn protocol_url(token: &str) -> String {
	encrypted_protocol_url(SCHEME, token)
}
fn random_token() -> String {
	encrypted_random_token()
}
fn now_ms() -> u64 {
	encrypted_now_ms()
}
fn cache_error(message: &str) -> AppError {
	media_error(message)
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::api::encrypted_media_store::CHUNK_SIZE;
	use std::io::{Read, Seek, SeekFrom, Write};

	use crate::api::encrypted_media_store::{
		write_encrypted_atomic, MAX_RANGE_BYTES,
	};

	fn temp_dir() -> PathBuf {
		let path = std::env::temp_dir()
			.join(format!("open-grind-album-cache-test-{}", random_token()));
		fs::create_dir_all(&path).unwrap();
		path
	}

	#[test]
	fn authoritative_membership_reconciliation_handles_arbitrary_album_ids() {
		let mut record = serde_json::json!({
			"identity": { "albumId": 9001 },
			"membership": {
				"isCurrentlyShared": true,
				"lastListedAt": 1,
				"unavailableReason": null
			}
		});
		reconcile_record_membership(&mut record, &HashSet::new(), 50).unwrap();
		assert_eq!(record["membership"]["isCurrentlyShared"], false);
		assert_eq!(record["membership"]["lastListedAt"], 50);
		assert_eq!(record["membership"]["unavailableReason"], "unshared");
		reconcile_record_membership(
			&mut record,
			&HashSet::from(["9001".to_owned()]),
			75,
		)
		.unwrap();
		assert_eq!(record["membership"]["isCurrentlyShared"], true);
		assert_eq!(
			record["membership"]["unavailableReason"],
			serde_json::Value::Null
		);
	}

	#[test]
	fn encrypted_file_round_trips_full_and_cross_chunk_ranges() {
		let root = temp_dir();
		let path = root.join("media.ogac");
		let key = [7_u8; 32];
		let bytes: Vec<u8> = (0..CHUNK_SIZE * 2 + 91)
			.map(|index| (index % 251) as u8)
			.collect();
		write_encrypted_atomic(&path, &bytes, &key, b"identity", MAGIC)
			.unwrap();
		assert_ne!(fs::read(&path).unwrap(), bytes);
		assert_eq!(
			read_encrypted_range(&path, &key, b"identity", None, MAGIC)
				.unwrap(),
			bytes
		);
		let range = (CHUNK_SIZE as u64 - 17, CHUNK_SIZE as u64 + 23);
		assert_eq!(
			read_encrypted_range(&path, &key, b"identity", Some(range), MAGIC,)
				.unwrap(),
			bytes[range.0 as usize..=range.1 as usize]
		);
		fs::remove_dir_all(root).unwrap();
	}

	#[test]
	fn authenticated_identity_and_tampering_fail_closed() {
		let root = temp_dir();
		let path = root.join("media.ogac");
		let key = [9_u8; 32];
		write_encrypted_atomic(
			&path,
			b"private media",
			&key,
			b"account-a",
			MAGIC,
		)
		.unwrap();
		assert!(read_encrypted_range(&path, &key, b"account-b", None, MAGIC)
			.is_err());
		let mut file = fs::OpenOptions::new()
			.read(true)
			.write(true)
			.open(&path)
			.unwrap();
		file.seek(SeekFrom::End(-1)).unwrap();
		let mut byte = [0_u8; 1];
		file.read_exact(&mut byte).unwrap();
		file.seek(SeekFrom::End(-1)).unwrap();
		file.write_all(&[byte[0] ^ 1]).unwrap();
		assert!(read_encrypted_range(&path, &key, b"account-a", None, MAGIC)
			.is_err());
		fs::remove_dir_all(root).unwrap();
	}

	#[test]
	fn owner_bound_aad_separates_colliding_album_ids() {
		assert_ne!(
			aad_prefix_v2(
				"account",
				"owner-a",
				"album",
				"content",
				"image/jpeg"
			),
			aad_prefix_v2(
				"account",
				"owner-b",
				"album",
				"content",
				"image/jpeg"
			),
		);
	}

	#[test]
	fn encrypted_membership_snapshots_are_isolated_by_owner() {
		let root = temp_dir();
		let key = [17_u8; 32];
		let snapshot = AlbumMembershipSnapshot {
			version: 5,
			current_album_ids: vec![11, 22],
			listed_at: 123,
		};
		store_membership_snapshot(
			&root,
			"account-hash",
			"owner-a-hash",
			&snapshot,
			&key,
		)
		.unwrap();
		assert_eq!(
			read_membership_snapshot(
				&root,
				"account-hash",
				"owner-a-hash",
				&key
			)
			.unwrap(),
			Some(snapshot)
		);
		fs::copy(
			membership_snapshot_path(&root, "account-hash", "owner-a-hash"),
			membership_snapshot_path(&root, "account-hash", "owner-b-hash"),
		)
		.unwrap();
		assert!(read_membership_snapshot(
			&root,
			"account-hash",
			"owner-b-hash",
			&key
		)
		.is_err());
		fs::remove_dir_all(root).unwrap();
	}

	#[test]
	fn account_clear_removes_a_snapshot_only_account() {
		let root = temp_dir();
		let key = [23_u8; 32];
		let account_hash = "snapshot-only-account";
		store_membership_snapshot(
			&root,
			account_hash,
			"owner",
			&AlbumMembershipSnapshot {
				version: 5,
				current_album_ids: vec![1],
				listed_at: 10,
			},
			&key,
		)
		.unwrap();
		let mut deleted_keys = Vec::new();
		clear_account_artifacts(
			&root,
			HashSet::from([account_hash.to_owned()]),
			|hash| {
				deleted_keys.push(hash.to_owned());
				Ok(())
			},
		)
		.unwrap();
		assert!(!root.join(account_hash).exists());
		assert_eq!(deleted_keys, vec![account_hash]);
		fs::remove_dir_all(root).unwrap();
	}

	#[test]
	fn global_clear_discovers_snapshot_only_accounts() {
		let root = temp_dir();
		let key = [29_u8; 32];
		for account_hash in ["snapshot-account-a", "snapshot-account-b"] {
			store_membership_snapshot(
				&root,
				account_hash,
				"owner",
				&AlbumMembershipSnapshot {
					version: 5,
					current_album_ids: vec![1],
					listed_at: 10,
				},
				&key,
			)
			.unwrap();
		}
		let discovered = account_directories(&root).unwrap();
		assert_eq!(discovered.len(), 2);
		let mut deleted_keys = HashSet::new();
		clear_account_artifacts(&root, discovered, |hash| {
			deleted_keys.insert(hash.to_owned());
			Ok(())
		})
		.unwrap();
		assert_eq!(
			deleted_keys,
			HashSet::from([
				"snapshot-account-a".to_owned(),
				"snapshot-account-b".to_owned(),
			])
		);
		assert!(account_directories(&root).unwrap().is_empty());
		fs::remove_dir_all(root).unwrap();
	}

	#[test]
	fn migration_history_order_is_stable_when_timestamps_change() {
		let entry =
			|album_hash: &str, sequence: u64, accessed: u64| AlbumRecordEntry {
				account_hash: "account".to_owned(),
				owner_hash: "owner".to_owned(),
				album_hash: album_hash.to_owned(),
				file_name: format!("{album_hash}.ogar"),
				last_accessed_ms: accessed,
				history_order: Some(sequence),
			};
		let mut entries = vec![
			entry("album-2", 2, 100),
			entry("album-0", 0, 200),
			entry("album-1", 1, 9_999),
		];
		entries.sort_by(compare_record_entries);
		assert_eq!(
			entries
				.iter()
				.map(|entry| entry.album_hash.as_str())
				.collect::<Vec<_>>(),
			vec!["album-0", "album-1", "album-2"]
		);
	}

	#[test]
	fn record_updates_preserve_an_omitted_history_order() {
		let previous = AlbumRecordEntry {
			account_hash: "account".to_owned(),
			owner_hash: "owner".to_owned(),
			album_hash: "album".to_owned(),
			file_name: "record.ogar".to_owned(),
			last_accessed_ms: 1,
			history_order: Some(7),
		};
		assert_eq!(
			history_order_for_record(&serde_json::json!({}), Some(&previous)),
			Some(7)
		);
		assert_eq!(
			history_order_for_record(
				&serde_json::json!({ "historyOrder": { "sequence": 8 } }),
				Some(&previous)
			),
			Some(8)
		);
	}

	#[test]
	fn ranges_are_single_bounded_and_support_suffixes() {
		assert_eq!(
			parse_range(
				Some(&http::HeaderValue::from_static("bytes=10-19")),
				100
			)
			.unwrap(),
			Some((10, 19))
		);
		assert_eq!(
			parse_range(
				Some(&http::HeaderValue::from_static("bytes=-10")),
				100
			)
			.unwrap(),
			Some((90, 99))
		);
		assert!(parse_range(
			Some(&http::HeaderValue::from_static("bytes=1-2,4-5")),
			100
		)
		.is_err());
		assert!(parse_range(
			Some(
				&http::HeaderValue::from_str(&format!(
					"bytes=0-{MAX_RANGE_BYTES}"
				))
				.unwrap()
			),
			MAX_RANGE_BYTES + 1
		)
		.is_err());
	}

	#[test]
	fn protocol_headers_report_total_for_head_and_range_for_get() {
		let head = build_media_response(
			&http::Method::HEAD,
			"video/mp4",
			1234,
			None,
			Vec::new(),
		)
		.unwrap();
		assert_eq!(head.status(), http::StatusCode::OK);
		assert_eq!(head.headers()[http::header::CONTENT_LENGTH], "1234");
		assert!(head.body().is_empty());

		let partial = build_media_response(
			&http::Method::GET,
			"video/mp4",
			1234,
			Some((100, 199)),
			vec![0; 100],
		)
		.unwrap();
		assert_eq!(partial.status(), http::StatusCode::PARTIAL_CONTENT);
		assert_eq!(partial.headers()[http::header::CONTENT_LENGTH], "100");
		assert_eq!(
			partial.headers()[http::header::CONTENT_RANGE],
			"bytes 100-199/1234"
		);
	}

	#[test]
	fn cdn_allowlist_requires_https_and_exact_suffix_boundary() {
		assert!(cdn_host_allowed(
			&reqwest::Url::parse("https://cdns.grindr.com/media").unwrap()
		));
		assert!(cdn_host_allowed(
			&reqwest::Url::parse("https://abc.cloudfront.net/media").unwrap()
		));
		assert!(!cdn_host_allowed(
			&reqwest::Url::parse("http://abc.cloudfront.net/media").unwrap()
		));
		assert!(!cdn_host_allowed(
			&reqwest::Url::parse("https://cloudfront.net.evil.test/media")
				.unwrap()
		));
		assert!(!cdn_host_allowed(
			&reqwest::Url::parse("https://evilcdns.grindr.com/media").unwrap()
		));
	}

	#[test]
	fn trim_evicts_whole_least_recently_used_album() {
		let root = temp_dir();
		let mut index = CacheIndex {
			entries: vec![
				entry("a", "old", "1", 40, 1),
				entry("a", "old", "2", 40, 2),
				entry("a", "new", "3", 50, 9),
			],
		};
		for entry in &index.entries {
			let path = entry_path(&root, entry);
			fs::create_dir_all(path.parent().unwrap()).unwrap();
			fs::write(path, b"x").unwrap();
		}
		trim_index(&root, &mut index, 60).unwrap();
		assert_eq!(index.entries.len(), 1);
		assert_eq!(index.entries[0].album_hash, "new");
		fs::remove_dir_all(root).unwrap();
	}

	fn entry(
		account: &str,
		album: &str,
		content: &str,
		bytes: u64,
		accessed: u64,
	) -> CacheEntry {
		CacheEntry {
			account_hash: account.into(),
			owner_hash: "owner".into(),
			album_hash: album.into(),
			content_hash: content.into(),
			content_type: "image/jpeg".into(),
			byte_length: bytes,
			file_name: format!("{content}.ogac"),
			token: format!("token-{content}"),
			last_accessed_ms: accessed,
		}
	}
}
