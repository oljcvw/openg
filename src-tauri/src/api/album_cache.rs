use std::{
	collections::{HashMap, HashSet},
	fs,
	path::{Path, PathBuf},
	sync::atomic::{AtomicU64, Ordering},
};

use aes_gcm::{
	aead::{Aead, KeyInit, Payload},
	Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::{rngs::OsRng, RngCore};
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
const RECORD_PARTITION_INDEX_FILE: &str = "index-v6.ogai";
const RECORD_INDEX_SCHEMA_VERSION: u8 = 6;
const RECORD_MIGRATION_BATCH_SIZE: usize = 60;
const MAGIC: &[u8; 8] = b"OGALBC01";
const RECORD_MAGIC: &[u8; 8] = b"OGALBR02";
const RECORD_INDEX_MAGIC: &[u8; 8] = b"OGALIX06";
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AlbumRecordPartitionIndex {
	schema_version: u8,
	epoch: u64,
	entries: Vec<AlbumRecordEntry>,
}

impl Default for AlbumRecordPartitionIndex {
	fn default() -> Self {
		Self {
			schema_version: RECORD_INDEX_SCHEMA_VERSION,
			epoch: 0,
			entries: Vec::new(),
		}
	}
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AlbumRecordCursor {
	schema_version: u8,
	epoch: u64,
	history_order: Option<u64>,
	last_accessed_ms: u64,
	album_hash: String,
}

#[derive(Debug)]
struct AlbumRecordEntryPage {
	entries: Vec<AlbumRecordEntry>,
	next: Option<AlbumRecordCursor>,
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
#[expect(
	clippy::too_many_arguments,
	reason = "Tauri command parameters are the stable frontend invocation contract"
)]
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
	crate::api::location_wifi_safety::assert_grindr_traffic_allowed_for(
		"<cdn>",
	)?;
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
	let mut index = migrate_record_partition(
		&root,
		&account_hash,
		&owner_hash,
		operation_epoch,
		&key,
	)?;
	let previous = index
		.entries
		.iter()
		.find(|entry| entry.album_hash == album_hash);
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
	index.entries.retain(|entry| entry.album_hash != album_hash);
	index.entries.push(AlbumRecordEntry {
		account_hash: account_hash.clone(),
		owner_hash: owner_hash.clone(),
		album_hash,
		file_name,
		last_accessed_ms: record
			.get("lastAccessedAt")
			.and_then(serde_json::Value::as_u64)
			.unwrap_or_else(now_ms),
		history_order,
	});
	index.epoch = index.epoch.saturating_add(1);
	save_record_partition_index(&root, &account_hash, &owner_hash, &index, &key)
}

#[tauri::command]
pub async fn album_cache_record_read(
	app: tauri::AppHandle,
	account_id: String,
	owner_profile_id: String,
	album_id: String,
) -> Result<Option<serde_json::Value>, AppError> {
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
	let key = load_or_create_encryption_key(KEY_SERVICE, &account_hash)?;
	let partition = migrate_record_partition(
		&root,
		&account_hash,
		&owner_hash,
		operation_epoch,
		&key,
	)?;
	let entries =
		merged_record_entries(&root, partition, &account_hash, &owner_hash)?;
	let Some(entry) =
		entries.iter().find(|entry| entry.album_hash == album_hash)
	else {
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
	let operation_epoch = CACHE_EPOCH.load(Ordering::Acquire);
	validate_identifier(&account_id)?;
	validate_identifier(&owner_profile_id)?;
	ensure_active_account(&account_id)?;
	let root = cache_root(&app)?;
	let account_hash = identifier_hash(&account_id);
	let owner_hash = identifier_hash(&owner_profile_id);
	let _guard = CACHE_LOCK.lock().await;
	if CACHE_EPOCH.load(Ordering::Acquire) != operation_epoch
		|| ensure_active_account(&account_id).is_err()
	{
		return Err(AppError::RequestCancelled);
	}
	let key = load_or_create_encryption_key(KEY_SERVICE, &account_hash)?;
	let partition = migrate_record_partition(
		&root,
		&account_hash,
		&owner_hash,
		operation_epoch,
		&key,
	)?;
	let partition_epoch = partition.epoch;
	let entries =
		merged_record_entries(&root, partition, &account_hash, &owner_hash)?;
	let decoded_cursor = cursor
		.as_deref()
		.map(|cursor| {
			decode_record_cursor(&key, &account_hash, &owner_hash, cursor)
		})
		.transpose()?;
	if let Some(cursor) = decoded_cursor.as_ref() {
		record_cursor_epoch_is_current(cursor, partition_epoch)?;
	}
	let page = page_record_entries(&entries, decoded_cursor.as_ref(), 60)?;
	let records = page
		.entries
		.iter()
		.map(|entry| read_record(&root, entry))
		.collect::<Result<Vec<_>, _>>()?;
	let next_cursor = page
		.next
		.as_ref()
		.map(|_| {
			encode_record_cursor(
				&key,
				&account_hash,
				&owner_hash,
				partition_epoch,
				page.entries
					.last()
					.expect("a continuation requires a final entry"),
			)
		})
		.transpose()?;
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
	let operation_epoch = CACHE_EPOCH.load(Ordering::Acquire);
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
	if CACHE_EPOCH.load(Ordering::Acquire) != operation_epoch
		|| ensure_active_account(&account_id).is_err()
	{
		return Err(AppError::RequestCancelled);
	}
	let key = load_or_create_encryption_key(KEY_SERVICE, &account_hash)?;
	let mut partition = migrate_record_partition(
		&root,
		&account_hash,
		&owner_hash,
		operation_epoch,
		&key,
	)?;
	let entries = merged_record_entries(
		&root,
		partition.clone(),
		&account_hash,
		&owner_hash,
	)?;
	for entry in &entries {
		if CACHE_EPOCH.load(Ordering::Acquire) != operation_epoch {
			return Err(AppError::RequestCancelled);
		}
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
	partition.epoch = partition.epoch.saturating_add(1);
	save_record_partition_index(
		&root,
		&account_hash,
		&owner_hash,
		&partition,
		&key,
	)
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

fn record_partition_index_path(
	root: &Path,
	account_hash: &str,
	owner_hash: &str,
) -> PathBuf {
	root.join(account_hash)
		.join("history")
		.join(owner_hash)
		.join(RECORD_PARTITION_INDEX_FILE)
}

fn load_record_partition_index(
	root: &Path,
	account_hash: &str,
	owner_hash: &str,
	key: &[u8; 32],
) -> Result<AlbumRecordPartitionIndex, AppError> {
	let path = record_partition_index_path(root, account_hash, owner_hash);
	if !path.is_file() {
		return Ok(AlbumRecordPartitionIndex::default());
	}
	let bytes = read_encrypted_range(
		&path,
		key,
		&encrypted_aad_prefix("record-index-v6", &[account_hash, owner_hash]),
		None,
		RECORD_INDEX_MAGIC,
	)?;
	let index: AlbumRecordPartitionIndex = serde_json::from_slice(&bytes)
		.map_err(|_| cache_error("album history partition is invalid"))?;
	if index.schema_version != RECORD_INDEX_SCHEMA_VERSION {
		return Err(cache_error(
			"album history partition schema version is unsupported",
		));
	}
	if index.entries.iter().any(|entry| {
		entry.account_hash != account_hash || entry.owner_hash != owner_hash
	}) {
		return Err(cache_error("album history partition scope is invalid"));
	}
	Ok(index)
}

fn save_record_partition_index(
	root: &Path,
	account_hash: &str,
	owner_hash: &str,
	index: &AlbumRecordPartitionIndex,
	key: &[u8; 32],
) -> Result<(), AppError> {
	if index.schema_version != RECORD_INDEX_SCHEMA_VERSION
		|| index.entries.iter().any(|entry| {
			entry.account_hash != account_hash || entry.owner_hash != owner_hash
		}) {
		return Err(cache_error("album history partition scope is invalid"));
	}
	let path = record_partition_index_path(root, account_hash, owner_hash);
	let parent = path.parent().ok_or_else(|| {
		cache_error("album history partition path is invalid")
	})?;
	fs::create_dir_all(parent)
		.map_err(|_| cache_error("could not create album history partition"))?;
	let bytes = serde_json::to_vec(index)
		.map_err(|_| cache_error("could not encode album history partition"))?;
	write_encrypted_atomic(
		&path,
		&bytes,
		key,
		&encrypted_aad_prefix("record-index-v6", &[account_hash, owner_hash]),
		RECORD_INDEX_MAGIC,
	)
}

fn cursor_aad(account_hash: &str, owner_hash: &str) -> Vec<u8> {
	encrypted_aad_prefix("record-cursor-v6", &[account_hash, owner_hash])
}

fn cursor_for_entry(epoch: u64, entry: &AlbumRecordEntry) -> AlbumRecordCursor {
	AlbumRecordCursor {
		schema_version: RECORD_INDEX_SCHEMA_VERSION,
		epoch,
		history_order: entry.history_order,
		last_accessed_ms: entry.last_accessed_ms,
		album_hash: entry.album_hash.clone(),
	}
}

fn encode_record_cursor(
	key: &[u8; 32],
	account_hash: &str,
	owner_hash: &str,
	epoch: u64,
	entry: &AlbumRecordEntry,
) -> Result<String, AppError> {
	let payload = serde_json::to_vec(&cursor_for_entry(epoch, entry))
		.map_err(|_| cache_error("could not encode album history cursor"))?;
	let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| {
		cache_error("could not initialize album history cursor")
	})?;
	let mut nonce = [0_u8; 12];
	OsRng.fill_bytes(&mut nonce);
	let ciphertext = cipher
		.encrypt(
			Nonce::from_slice(&nonce),
			Payload {
				msg: &payload,
				aad: &cursor_aad(account_hash, owner_hash),
			},
		)
		.map_err(|_| cache_error("could not protect album history cursor"))?;
	let mut encoded = nonce.to_vec();
	encoded.extend(ciphertext);
	Ok(URL_SAFE_NO_PAD.encode(encoded))
}

fn decode_record_cursor(
	key: &[u8; 32],
	account_hash: &str,
	owner_hash: &str,
	cursor: &str,
) -> Result<AlbumRecordCursor, AppError> {
	let encoded = URL_SAFE_NO_PAD
		.decode(cursor)
		.map_err(|_| cache_error("album history cursor is invalid"))?;
	if encoded.len() <= 12 {
		return Err(cache_error("album history cursor is invalid"));
	}
	let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| {
		cache_error("could not initialize album history cursor")
	})?;
	let payload = cipher
		.decrypt(
			Nonce::from_slice(&encoded[..12]),
			Payload {
				msg: &encoded[12..],
				aad: &cursor_aad(account_hash, owner_hash),
			},
		)
		.map_err(|_| cache_error("album history cursor is invalid"))?;
	let decoded: AlbumRecordCursor = serde_json::from_slice(&payload)
		.map_err(|_| cache_error("album history cursor is invalid"))?;
	if decoded.schema_version != RECORD_INDEX_SCHEMA_VERSION {
		return Err(cache_error("album history cursor is invalid"));
	}
	Ok(decoded)
}

fn record_cursor_epoch_is_current(
	cursor: &AlbumRecordCursor,
	partition_epoch: u64,
) -> Result<(), AppError> {
	if cursor.epoch == partition_epoch {
		Ok(())
	} else {
		Err(cache_error("album history cursor is stale"))
	}
}

fn json_identity_hash(value: &serde_json::Value) -> Option<String> {
	value
		.as_u64()
		.map(|value| identifier_hash(&value.to_string()))
		.or_else(|| value.as_str().map(identifier_hash))
}

fn record_matches_index_identity(
	record: &serde_json::Value,
	entry: &AlbumRecordEntry,
) -> bool {
	let Some(object) = record.as_object() else {
		return false;
	};
	let Some(identity) =
		object.get("identity").and_then(|value| value.as_object())
	else {
		return false;
	};
	let canonical_account_id = identity
		.get("accountProfileId")
		.and_then(|value| value.as_u64());
	let account_matches = canonical_account_id
		.map(|value| identifier_hash(&value.to_string()))
		.is_some_and(|hash| hash == entry.account_hash);
	let owner_matches = identity
		.get("ownerProfileId")
		.and_then(json_identity_hash)
		.is_some_and(|hash| hash == entry.owner_hash);
	let album_matches = identity
		.get("albumId")
		.and_then(json_identity_hash)
		.is_some_and(|hash| hash == entry.album_hash);
	let canonical_album_id =
		identity.get("albumId").and_then(|value| value.as_u64());
	let canonical_owner_id = identity
		.get("ownerProfileId")
		.and_then(|value| value.as_u64());
	let membership_complete = object
		.get("membership")
		.and_then(|value| value.as_object())
		.is_some_and(|membership| {
			membership
				.get("isCurrentlyShared")
				.is_some_and(serde_json::Value::is_boolean)
				&& membership
					.get("lastListedAt")
					.is_some_and(serde_json::Value::is_u64)
				&& membership.contains_key("unavailableReason")
		});
	let album_complete = object
		.get("album")
		.and_then(|value| value.as_object())
		.is_some_and(|album| {
			album.get("albumId").and_then(|value| value.as_u64())
				== canonical_album_id
				&& album.get("profileId").and_then(|value| value.as_u64())
					== canonical_owner_id
				&& album
					.get("content")
					.is_some_and(serde_json::Value::is_array)
				&& album
					.get("hasUnseenContent")
					.is_some_and(serde_json::Value::is_boolean)
				&& album.contains_key("albumName")
				&& album
					.get("albumViewable")
					.is_some_and(serde_json::Value::is_boolean)
				&& album
					.get("sharedCount")
					.is_some_and(serde_json::Value::is_u64)
				&& album
					.get("createdAt")
					.is_some_and(serde_json::Value::is_string)
				&& album
					.get("updatedAt")
					.is_some_and(serde_json::Value::is_string)
		});
	let history_order = object.get("historyOrder");
	let history_matches = match entry.history_order {
		Some(expected) => {
			history_order
				.and_then(|value| value.get("sequence"))
				.and_then(|value| value.as_u64())
				== Some(expected)
		}
		None => history_order.is_some_and(serde_json::Value::is_null),
	};
	object.get("version").and_then(|value| value.as_u64()) == Some(2)
		&& account_matches
		&& owner_matches
		&& album_matches
		&& object.get("albumId").and_then(|value| value.as_u64())
			== canonical_album_id
		&& object
			.get("ownerProfileId")
			.and_then(|value| value.as_u64())
			== canonical_owner_id
		&& object
			.get("lastAccessedAt")
			.and_then(|value| value.as_u64())
			== Some(entry.last_accessed_ms)
		&& membership_complete
		&& object
			.get("access")
			.and_then(|value| value.get("status"))
			.and_then(|value| value.as_str())
			.is_some_and(|status| {
				matches!(status, "active" | "unavailable" | "unknown")
			}) && object.contains_key("currentSnapshot")
		&& object
			.get("retainedItems")
			.is_some_and(serde_json::Value::is_array)
		&& object.get("media").is_some_and(serde_json::Value::is_array)
		&& object.contains_key("expirationType")
		&& object.contains_key("expiresAt")
		&& album_complete
		&& history_matches
}

fn page_record_entries(
	entries: &[AlbumRecordEntry],
	cursor: Option<&AlbumRecordCursor>,
	limit: usize,
) -> Result<AlbumRecordEntryPage, AppError> {
	let mut sorted = entries.to_vec();
	sorted.sort_by(compare_record_entries);
	let start = cursor.map_or(0, |cursor| {
		sorted.partition_point(|entry| {
			compare_record_entries(
				entry,
				&AlbumRecordEntry {
					account_hash: entry.account_hash.clone(),
					owner_hash: entry.owner_hash.clone(),
					album_hash: cursor.album_hash.clone(),
					file_name: String::new(),
					last_accessed_ms: cursor.last_accessed_ms,
					history_order: cursor.history_order,
				},
			) != std::cmp::Ordering::Greater
		})
	});
	let page = sorted
		.into_iter()
		.skip(start)
		.take(limit + 1)
		.collect::<Vec<_>>();
	let has_more = page.len() > limit;
	let entries = page.into_iter().take(limit).collect::<Vec<_>>();
	let next = has_more
		.then(|| entries.last().map(|entry| cursor_for_entry(0, entry)))
		.flatten();
	Ok(AlbumRecordEntryPage { entries, next })
}

fn migration_batch(
	source: &[AlbumRecordEntry],
	partition: &[AlbumRecordEntry],
	account_hash: &str,
	owner_hash: &str,
	limit: usize,
) -> Vec<AlbumRecordEntry> {
	let existing = partition
		.iter()
		.map(|entry| entry.album_hash.as_str())
		.collect::<HashSet<_>>();
	source
		.iter()
		.filter(|entry| {
			entry.account_hash == account_hash
				&& !entry.owner_hash.is_empty()
				&& entry.owner_hash == owner_hash
				&& !existing.contains(entry.album_hash.as_str())
		})
		.take(limit)
		.cloned()
		.collect()
}

fn retire_migrated_entries(
	source: &[AlbumRecordEntry],
	staged: &[AlbumRecordEntry],
	verified: bool,
) -> Vec<AlbumRecordEntry> {
	if !verified {
		return source.to_vec();
	}
	let migrated = staged
		.iter()
		.map(|entry| {
			(
				entry.account_hash.as_str(),
				entry.owner_hash.as_str(),
				entry.album_hash.as_str(),
				entry.file_name.as_str(),
			)
		})
		.collect::<HashSet<_>>();
	source
		.iter()
		.filter(|entry| {
			!migrated.contains(&(
				entry.account_hash.as_str(),
				entry.owner_hash.as_str(),
				entry.album_hash.as_str(),
				entry.file_name.as_str(),
			))
		})
		.cloned()
		.collect()
}

fn staged_retirement_batch(
	source: &[AlbumRecordEntry],
	partition: &[AlbumRecordEntry],
	account_hash: &str,
	owner_hash: &str,
	limit: usize,
) -> Vec<AlbumRecordEntry> {
	source
		.iter()
		.filter(|source| {
			source.account_hash == account_hash
				&& !source.owner_hash.is_empty()
				&& source.owner_hash == owner_hash
				&& partition.iter().any(|entry| {
					entry.album_hash == source.album_hash
						&& entry.file_name == source.file_name
				})
		})
		.take(limit)
		.cloned()
		.collect()
}

fn migration_epoch_matches(operation_epoch: u64, current_epoch: u64) -> bool {
	operation_epoch == current_epoch
}

fn migrate_record_partition(
	root: &Path,
	account_hash: &str,
	owner_hash: &str,
	operation_epoch: u64,
	key: &[u8; 32],
) -> Result<AlbumRecordPartitionIndex, AppError> {
	let started = std::time::Instant::now();
	let legacy_count =
		load_json_index::<AlbumRecordIndex>(root, RECORD_INDEX_FILE)
			.map(|index| index.entries.len())
			.unwrap_or(0);
	let result = migrate_record_partition_inner(
		root,
		account_hash,
		owner_hash,
		operation_epoch,
		key,
	);
	tracing::info!(
		source_schema = 1_u32,
		destination_schema = RECORD_INDEX_SCHEMA_VERSION,
		record_count = legacy_count,
		duration_ms = started.elapsed().as_millis() as u64,
		outcome = if result.is_ok() { "complete" } else { "failed" },
		"album history migration"
	);
	result
}

fn migrate_record_partition_inner(
	root: &Path,
	account_hash: &str,
	owner_hash: &str,
	operation_epoch: u64,
	key: &[u8; 32],
) -> Result<AlbumRecordPartitionIndex, AppError> {
	if !migration_epoch_matches(
		operation_epoch,
		CACHE_EPOCH.load(Ordering::Acquire),
	) {
		return Err(AppError::RequestCancelled);
	}
	let mut legacy: AlbumRecordIndex =
		load_json_index(root, RECORD_INDEX_FILE)?;
	let mut partition =
		load_record_partition_index(root, account_hash, owner_hash, key)?;
	// A prior run may have durably staged the partition and then stopped before
	// retiring the source index. Finish that retirement first, still bounded.
	let already_staged = staged_retirement_batch(
		&legacy.entries,
		&partition.entries,
		account_hash,
		owner_hash,
		RECORD_MIGRATION_BATCH_SIZE,
	);
	if !already_staged.is_empty() {
		let verified = already_staged.iter().all(|entry| {
			read_record(root, entry).is_ok_and(|record| {
				record_matches_index_identity(&record, entry)
			})
		});
		if !verified {
			return Err(cache_error(
				"album history migration verification failed",
			));
		}
		if !migration_epoch_matches(
			operation_epoch,
			CACHE_EPOCH.load(Ordering::Acquire),
		) {
			return Err(AppError::RequestCancelled);
		}
		legacy.entries =
			retire_migrated_entries(&legacy.entries, &already_staged, true);
		save_json_index(root, RECORD_INDEX_FILE, &legacy)?;
		return Ok(partition);
	}
	let staged = migration_batch(
		&legacy.entries,
		&partition.entries,
		account_hash,
		owner_hash,
		RECORD_MIGRATION_BATCH_SIZE,
	);
	if staged.is_empty() {
		return Ok(partition);
	}
	partition.entries.extend(staged.iter().cloned());
	partition.epoch = partition.epoch.saturating_add(1);
	save_record_partition_index(
		root,
		account_hash,
		owner_hash,
		&partition,
		key,
	)?;

	let durable =
		load_record_partition_index(root, account_hash, owner_hash, key)?;
	let verified = staged.iter().all(|staged_entry| {
		durable.entries.iter().any(|entry| {
			entry.account_hash == staged_entry.account_hash
				&& entry.owner_hash == staged_entry.owner_hash
				&& entry.album_hash == staged_entry.album_hash
				&& entry.file_name == staged_entry.file_name
				&& entry.last_accessed_ms == staged_entry.last_accessed_ms
				&& entry.history_order == staged_entry.history_order
		}) && read_record(root, staged_entry).is_ok_and(|record| {
			record_matches_index_identity(&record, staged_entry)
		})
	});
	if !verified
		|| !migration_epoch_matches(
			operation_epoch,
			CACHE_EPOCH.load(Ordering::Acquire),
		) {
		partition.entries =
			retire_migrated_entries(&partition.entries, &staged, true);
		let _ = save_record_partition_index(
			root,
			account_hash,
			owner_hash,
			&partition,
			key,
		);
		return Err(if verified {
			AppError::RequestCancelled
		} else {
			cache_error("album history migration verification failed")
		});
	}
	legacy.entries = retire_migrated_entries(&legacy.entries, &staged, true);
	save_json_index(root, RECORD_INDEX_FILE, &legacy)?;
	Ok(partition)
}

fn merged_record_entries(
	root: &Path,
	partition: AlbumRecordPartitionIndex,
	account_hash: &str,
	owner_hash: &str,
) -> Result<Vec<AlbumRecordEntry>, AppError> {
	let legacy: AlbumRecordIndex = load_json_index(root, RECORD_INDEX_FILE)?;
	let mut entries = partition.entries;
	let existing = entries
		.iter()
		.map(|entry| entry.album_hash.clone())
		.collect::<HashSet<_>>();
	entries.extend(legacy.entries.into_iter().filter(|entry| {
		entry.account_hash == account_hash
			&& entry.owner_hash == owner_hash
			&& !existing.contains(&entry.album_hash)
	}));
	Ok(entries)
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
		let mut entries = [
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
	fn record_partitions_isolate_colliding_accounts_and_owners() {
		let root = PathBuf::from("/cache");
		assert_ne!(
			record_partition_index_path(&root, "account-a", "owner"),
			record_partition_index_path(&root, "account-b", "owner")
		);
		assert_ne!(
			record_partition_index_path(&root, "account-a", "owner-a"),
			record_partition_index_path(&root, "account-a", "owner-b")
		);
		assert_eq!(
			AlbumRecordPartitionIndex::default().schema_version,
			RECORD_INDEX_SCHEMA_VERSION
		);
	}

	#[test]
	fn partition_index_persists_explicit_schema_and_composite_scope() {
		let root = temp_dir();
		let key = [41_u8; 32];
		let entry = AlbumRecordEntry {
			account_hash: "account".into(),
			owner_hash: "owner".into(),
			album_hash: "album".into(),
			file_name: "record.ogar".into(),
			last_accessed_ms: 1,
			history_order: None,
		};
		let index = AlbumRecordPartitionIndex {
			schema_version: RECORD_INDEX_SCHEMA_VERSION,
			epoch: 4,
			entries: vec![entry.clone()],
		};
		save_record_partition_index(&root, "account", "owner", &index, &key)
			.unwrap();
		let path = record_partition_index_path(&root, "account", "owner");
		assert!(path.is_file());
		let encrypted = fs::read(&path).unwrap();
		assert_eq!(&encrypted[..RECORD_INDEX_MAGIC.len()], RECORD_INDEX_MAGIC);
		assert_ne!(encrypted, serde_json::to_vec(&index).unwrap());
		let loaded =
			load_record_partition_index(&root, "account", "owner", &key)
				.unwrap();
		assert_eq!(loaded.schema_version, RECORD_INDEX_SCHEMA_VERSION);
		assert_eq!(loaded.epoch, 4);
		assert_eq!(loaded.entries, vec![entry]);
		assert!(
			load_record_partition_index(&root, "account", "other", &key,)
				.unwrap()
				.entries
				.is_empty()
		);
		fs::remove_dir_all(root).unwrap();
	}

	#[test]
	fn stateless_cursor_is_integrity_protected_and_scope_bound() {
		let key = [31_u8; 32];
		let entry = AlbumRecordEntry {
			account_hash: "account".into(),
			owner_hash: "owner".into(),
			album_hash: "album".into(),
			file_name: "record.ogar".into(),
			last_accessed_ms: 123,
			history_order: Some(7),
		};
		let cursor =
			encode_record_cursor(&key, "account", "owner", 9, &entry).unwrap();
		let decoded =
			decode_record_cursor(&key, "account", "owner", &cursor).unwrap();
		assert_eq!(decoded.epoch, 9);
		assert_eq!(decoded.album_hash, "album");
		assert!(
			decode_record_cursor(&key, "account", "other", &cursor).is_err()
		);
		let mut tampered = cursor.into_bytes();
		let last = tampered.len() - 1;
		tampered[last] = if tampered[last] == b'A' { b'B' } else { b'A' };
		assert!(decode_record_cursor(
			&key,
			"account",
			"owner",
			std::str::from_utf8(&tampered).unwrap()
		)
		.is_err());
		assert!(record_cursor_epoch_is_current(&decoded, 9).is_ok());
		assert!(record_cursor_epoch_is_current(&decoded, 10).is_err());
	}

	#[test]
	fn migrated_record_must_match_complete_authoritative_index_identity() {
		let entry = AlbumRecordEntry {
			account_hash: identifier_hash("7"),
			owner_hash: identifier_hash("42"),
			album_hash: identifier_hash("9"),
			file_name: "record.ogar".into(),
			last_accessed_ms: 123,
			history_order: Some(4),
		};
		let canonical = serde_json::json!({
			"version": 2,
			"albumId": 9,
			"ownerProfileId": 42,
			"identity": {
				"accountProfileId": 7,
				"ownerProfileId": 42,
				"albumId": 9
			},
			"membership": {
				"isCurrentlyShared": false,
				"lastListedAt": 123,
				"unavailableReason": "unshared"
			},
			"currentSnapshot": null,
			"retainedItems": [],
			"historyOrder": { "source": "beta4", "sequence": 4 },
			"expirationType": null,
			"expiresAt": null,
			"access": { "status": "unknown", "lastValidatedAt": null },
			"album": {
				"albumId": 9,
				"hasUnseenContent": false,
				"albumName": null,
				"profileId": 42,
				"albumViewable": false,
				"sharedCount": 0,
				"createdAt": "2026-01-01T00:00:00Z",
				"updatedAt": "2026-01-01T00:00:00Z",
				"content": []
			},
			"media": [],
			"lastAccessedAt": 123
		});
		assert!(record_matches_index_identity(&canonical, &entry));
		let mut wrong_owner = canonical.clone();
		wrong_owner["identity"]["ownerProfileId"] = 99.into();
		assert!(!record_matches_index_identity(&wrong_owner, &entry));
		let mut wrong_metadata_owner = canonical.clone();
		wrong_metadata_owner["album"]["profileId"] = 99.into();
		assert!(!record_matches_index_identity(
			&wrong_metadata_owner,
			&entry
		));
		let mut noncanonical_account = canonical.clone();
		noncanonical_account["identity"]["accountProfileId"] = "7".into();
		assert!(!record_matches_index_identity(
			&noncanonical_account,
			&entry
		));
		let mut incomplete = canonical;
		incomplete.as_object_mut().unwrap().remove("retainedItems");
		assert!(!record_matches_index_identity(&incomplete, &entry));
	}

	#[test]
	fn ten_thousand_records_page_stably_without_full_record_hydration() {
		let entries = (0..10_000)
			.map(|index| AlbumRecordEntry {
				account_hash: "account".into(),
				owner_hash: "owner".into(),
				album_hash: format!("album-{index:05}"),
				file_name: format!("record-{index:05}.ogar"),
				last_accessed_ms: 10_000 - index,
				history_order: Some(index),
			})
			.collect::<Vec<_>>();
		let mut cursor = None;
		let mut seen = Vec::new();
		loop {
			let page =
				page_record_entries(&entries, cursor.as_ref(), 60).unwrap();
			seen.extend(
				page.entries.iter().map(|entry| entry.album_hash.clone()),
			);
			cursor = page.next;
			if cursor.is_none() {
				break;
			}
		}
		assert_eq!(seen.len(), 10_000);
		assert_eq!(seen[0], "album-00000");
		assert_eq!(seen[9_999], "album-09999");
	}

	#[test]
	fn bounded_migration_keeps_source_entries_until_verified_retirement() {
		let source = (0..125)
			.map(|index| AlbumRecordEntry {
				account_hash: "account".into(),
				owner_hash: "owner".into(),
				album_hash: format!("album-{index}"),
				file_name: format!("record-{index}.ogar"),
				last_accessed_ms: index,
				history_order: Some(index),
			})
			.collect::<Vec<_>>();
		let staged = migration_batch(&source, &[], "account", "owner", 60);
		assert_eq!(staged.len(), 60);
		let interrupted_source =
			retire_migrated_entries(&source, &staged, false);
		assert_eq!(interrupted_source.len(), 125);
		let retired_source = retire_migrated_entries(&source, &staged, true);
		assert_eq!(retired_source.len(), 65);
		let restaged =
			migration_batch(&source, &staged, "account", "owner", 60);
		assert_eq!(restaged.len(), 60);
		assert!(restaged.iter().all(|entry| !staged
			.iter()
			.any(|old| old.album_hash == entry.album_hash)));
		let resumable_retirement =
			staged_retirement_batch(&source, &staged, "account", "owner", 60);
		assert_eq!(resumable_retirement, staged);
		assert_eq!(
			retire_migrated_entries(&source, &resumable_retirement, true,)
				.len(),
			65
		);
	}

	#[test]
	fn migration_uses_composite_scope_and_clear_epoch_fence() {
		let collision = |account: &str, owner: &str| AlbumRecordEntry {
			account_hash: account.into(),
			owner_hash: owner.into(),
			album_hash: "same-album".into(),
			file_name: format!("{account}-{owner}.ogar"),
			last_accessed_ms: 1,
			history_order: None,
		};
		let source = vec![
			collision("account-a", "owner-a"),
			collision("account-a", "owner-b"),
			collision("account-b", "owner-a"),
			collision("account-a", ""),
		];
		let staged = migration_batch(&source, &[], "account-a", "owner-a", 60);
		assert_eq!(staged.len(), 1);
		assert_eq!(staged[0].file_name, "account-a-owner-a.ogar");
		assert!(migration_epoch_matches(7, 7));
		assert!(!migration_epoch_matches(7, 8));
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
