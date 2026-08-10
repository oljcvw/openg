use std::{
	fs,
	path::{Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::Manager;

use crate::{
	api::encrypted_media_store::{
		aad_prefix, delete_key, identifier_hash, load_key, load_or_create_key,
		media_error, now_ms, read_encrypted_range, same_media_category,
		validate_cdn_url, validate_content_type, validate_identifier,
		write_encrypted_atomic, CHUNK_SIZE,
	},
	error::AppError,
	storage::AuthStorage,
};

const PRESET_DIR: &str = "album-presets-v1";
const PRESET_KEY_SERVICE: &str = "open-grind-album-presets";
const MANIFEST_FILE: &str = "manifest.ogpm";
const MANIFEST_MAGIC: &[u8; 8] = b"OGPRMF01";
const MEDIA_MAGIC: &[u8; 8] = b"OGPRMD01";
const JOURNAL_MAGIC: &[u8; 8] = b"OGPRAJ01";
const MAX_ITEM_BYTES: usize = 128 * 1024 * 1024;
const MAX_SET_BYTES: usize = 1024 * 1024 * 1024;
const STORAGE_HEADROOM_BYTES: u64 = 8 * 1024 * 1024;
static PRESET_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AlbumPresetManifest {
	version: u8,
	preset_id: String,
	name: String,
	created_at: u64,
	updated_at: u64,
	items: Vec<AlbumPresetItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AlbumPresetItem {
	item_id: String,
	kind: String,
	mime_type: String,
	byte_length: u64,
	checksum: String,
	width: Option<u32>,
	height: Option<u32>,
	duration_ms: Option<u64>,
	order: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AlbumPresetImportItem {
	item_id: String,
	kind: String,
	mime_type: String,
	data: String,
	width: Option<u32>,
	height: Option<u32>,
	duration_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AlbumPresetRemoteItem {
	item_id: String,
	kind: String,
	mime_type: String,
	source_url: String,
	maximum_bytes: u64,
	width: Option<u32>,
	height: Option<u32>,
	duration_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumPresetReadItem {
	data: String,
	mime_type: String,
	byte_length: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumPresetStats {
	preset_count: u64,
	byte_length: u64,
}

#[derive(Debug)]
struct DecodedItem {
	item_id: String,
	kind: String,
	mime_type: String,
	bytes: Vec<u8>,
	width: Option<u32>,
	height: Option<u32>,
	duration_ms: Option<u64>,
}

#[tauri::command]
pub async fn album_preset_import(
	app: tauri::AppHandle,
	account_id: String,
	preset_id: String,
	name: String,
	items: Vec<AlbumPresetImportItem>,
) -> Result<AlbumPresetManifest, AppError> {
	validate_account(&account_id)?;
	let mut decoded = Vec::with_capacity(items.len());
	for item in items {
		let bytes = STANDARD
			.decode(item.data)
			.map_err(|_| preset_error("saved-set media encoding is invalid"))?;
		decoded.push(DecodedItem {
			item_id: item.item_id,
			kind: item.kind,
			mime_type: item.mime_type,
			bytes,
			width: item.width,
			height: item.height,
			duration_ms: item.duration_ms,
		});
	}
	validate_account(&account_id)?;
	let root = preset_root(&app)?;
	let _guard = PRESET_LOCK.lock().await;
	store_decoded_set(&root, &account_id, &preset_id, &name, decoded)
}

#[tauri::command]
pub async fn album_preset_import_remote(
	app: tauri::AppHandle,
	account_id: String,
	preset_id: String,
	name: String,
	items: Vec<AlbumPresetRemoteItem>,
) -> Result<AlbumPresetManifest, AppError> {
	validate_account(&account_id)?;
	let client = reqwest::Client::builder()
		.redirect(reqwest::redirect::Policy::custom(|attempt| {
			if attempt.previous().len() >= 5 {
				return attempt.error("too many redirects");
			}
			if super::encrypted_media_store::cdn_host_allowed(attempt.url()) {
				attempt.follow()
			} else {
				attempt.stop()
			}
		}))
		.build()
		.map_err(|_| {
			preset_error("could not initialize saved-set downloader")
		})?;
	let mut decoded = Vec::with_capacity(items.len());
	for item in items {
		validate_content_type(&item.mime_type)?;
		let url = validate_cdn_url(&item.source_url)?;
		if item.maximum_bytes == 0 || item.maximum_bytes > MAX_ITEM_BYTES as u64
		{
			return Err(preset_error("saved-set maximumBytes is invalid"));
		}
		let mut response = client
			.get(url)
			.send()
			.await
			.map_err(|_| preset_error("saved-set media download failed"))?;
		if !response.status().is_success()
			|| !super::encrypted_media_store::cdn_host_allowed(response.url())
		{
			return Err(preset_error("saved-set media download was rejected"));
		}
		if response
			.content_length()
			.is_some_and(|length| length > item.maximum_bytes)
		{
			return Err(preset_error("saved-set media exceeds maximumBytes"));
		}
		validate_remote_media_type(
			&item.mime_type,
			response
				.headers()
				.get(reqwest::header::CONTENT_TYPE)
				.and_then(|value| value.to_str().ok()),
		)?;
		let mut bytes = Vec::with_capacity(
			response
				.content_length()
				.unwrap_or_default()
				.min(item.maximum_bytes) as usize,
		);
		while let Some(chunk) = response
			.chunk()
			.await
			.map_err(|_| preset_error("saved-set media download failed"))?
		{
			if bytes.len().saturating_add(chunk.len()) as u64
				> item.maximum_bytes
			{
				return Err(preset_error(
					"saved-set media exceeds maximumBytes",
				));
			}
			bytes.extend_from_slice(&chunk);
		}
		if bytes.is_empty() {
			return Err(preset_error("saved-set media size is invalid"));
		}
		decoded.push(DecodedItem {
			item_id: item.item_id,
			kind: item.kind,
			mime_type: item.mime_type,
			bytes,
			width: item.width,
			height: item.height,
			duration_ms: item.duration_ms,
		});
	}
	validate_account(&account_id)?;
	let root = preset_root(&app)?;
	let _guard = PRESET_LOCK.lock().await;
	store_decoded_set(&root, &account_id, &preset_id, &name, decoded)
}

#[tauri::command]
pub async fn album_preset_list(
	app: tauri::AppHandle,
	account_id: String,
) -> Result<Vec<AlbumPresetManifest>, AppError> {
	validate_account(&account_id)?;
	let root = preset_root(&app)?;
	let _guard = PRESET_LOCK.lock().await;
	list_manifests(&root, &account_id)
}

#[tauri::command]
pub async fn album_preset_read_item(
	app: tauri::AppHandle,
	account_id: String,
	preset_id: String,
	item_id: String,
) -> Result<AlbumPresetReadItem, AppError> {
	validate_account(&account_id)?;
	validate_local_id(&preset_id)?;
	validate_local_id(&item_id)?;
	let root = preset_root(&app)?;
	let _guard = PRESET_LOCK.lock().await;
	let account_hash = identifier_hash(&account_id);
	let key = load_key(PRESET_KEY_SERVICE, &account_hash)?;
	let manifest = read_manifest(&root, &account_hash, &preset_id, &key)?;
	let item = manifest
		.items
		.iter()
		.find(|item| item.item_id == item_id)
		.ok_or_else(|| preset_error("saved-set item is unavailable"))?;
	let bytes = read_encrypted_range(
		&item_path(&root, &account_hash, &preset_id, &item_id),
		&key,
		&media_aad(&account_hash, &preset_id, &item_id, &item.mime_type),
		None,
		MEDIA_MAGIC,
	)?;
	Ok(AlbumPresetReadItem {
		data: STANDARD.encode(&bytes),
		mime_type: item.mime_type.clone(),
		byte_length: bytes.len() as u64,
	})
}

#[tauri::command]
pub async fn album_preset_delete(
	app: tauri::AppHandle,
	account_id: String,
	preset_id: String,
) -> Result<(), AppError> {
	validate_account(&account_id)?;
	validate_local_id(&preset_id)?;
	let root = preset_root(&app)?;
	let _guard = PRESET_LOCK.lock().await;
	let directory =
		preset_path(&root, &identifier_hash(&account_id), &preset_id);
	remove_directory(&directory)
}

#[tauri::command]
pub async fn album_preset_stats(
	app: tauri::AppHandle,
	account_id: String,
) -> Result<AlbumPresetStats, AppError> {
	let manifests = album_preset_list(app, account_id).await?;
	Ok(AlbumPresetStats {
		preset_count: manifests.len() as u64,
		byte_length: manifests
			.iter()
			.flat_map(|manifest| &manifest.items)
			.map(|item| item.byte_length)
			.sum(),
	})
}

#[tauri::command]
pub async fn album_preset_clear(
	app: tauri::AppHandle,
	account_id: Option<String>,
) -> Result<(), AppError> {
	if let Some(account) = account_id.as_deref() {
		validate_account(account)?;
	}
	let root = preset_root(&app)?;
	let _guard = PRESET_LOCK.lock().await;
	if let Some(account) = account_id {
		let hash = identifier_hash(&account);
		remove_directory(&root.join(&hash))?;
		delete_key(PRESET_KEY_SERVICE, &hash)
	} else {
		let hashes = account_directories(&root)?;
		remove_directory(&root)?;
		for hash in hashes {
			delete_key(PRESET_KEY_SERVICE, &hash)?;
		}
		Ok(())
	}
}

#[tauri::command]
pub async fn album_activation_journal_save(
	app: tauri::AppHandle,
	account_id: String,
	target_album_id: String,
	journal: serde_json::Value,
) -> Result<(), AppError> {
	validate_account(&account_id)?;
	validate_identifier(&target_album_id)?;
	let bytes = serde_json::to_vec(&journal)
		.map_err(|_| preset_error("activation journal is invalid"))?;
	if bytes.len() > 1024 * 1024 {
		return Err(preset_error("activation journal is too large"));
	}
	let root = preset_root(&app)?;
	let _guard = PRESET_LOCK.lock().await;
	let account_hash = identifier_hash(&account_id);
	let target_hash = identifier_hash(&target_album_id);
	let key = load_or_create_key(PRESET_KEY_SERVICE, &account_hash)?;
	let dir = root.join(&account_hash).join("journals");
	fs::create_dir_all(&dir).map_err(|_| {
		preset_error("could not create activation journal directory")
	})?;
	write_encrypted_atomic(
		&dir.join(format!("{target_hash}.ogaj")),
		&bytes,
		&key,
		&aad_prefix(
			"album-activation-journal-v1",
			&[&account_hash, &target_hash],
		),
		JOURNAL_MAGIC,
	)
}

#[tauri::command]
pub async fn album_activation_journal_read(
	app: tauri::AppHandle,
	account_id: String,
	target_album_id: String,
) -> Result<Option<serde_json::Value>, AppError> {
	validate_account(&account_id)?;
	validate_identifier(&target_album_id)?;
	let root = preset_root(&app)?;
	let _guard = PRESET_LOCK.lock().await;
	let account_hash = identifier_hash(&account_id);
	let target_hash = identifier_hash(&target_album_id);
	let path = root
		.join(&account_hash)
		.join("journals")
		.join(format!("{target_hash}.ogaj"));
	if !path.exists() {
		return Ok(None);
	}
	let key = load_key(PRESET_KEY_SERVICE, &account_hash)?;
	let bytes = read_encrypted_range(
		&path,
		&key,
		&aad_prefix(
			"album-activation-journal-v1",
			&[&account_hash, &target_hash],
		),
		None,
		JOURNAL_MAGIC,
	)?;
	serde_json::from_slice(&bytes)
		.map(Some)
		.map_err(|_| preset_error("activation journal is invalid"))
}

fn store_decoded_set(
	root: &Path,
	account_id: &str,
	preset_id: &str,
	name: &str,
	items: Vec<DecodedItem>,
) -> Result<AlbumPresetManifest, AppError> {
	validate_local_id(preset_id)?;
	let name = name.trim();
	if name.is_empty() || name.len() > 120 {
		return Err(preset_error("saved-set name is invalid"));
	}
	let total = items.iter().try_fold(0_usize, |total, item| {
		if item.bytes.is_empty() || item.bytes.len() > MAX_ITEM_BYTES {
			return Err(preset_error("saved-set item size is invalid"));
		}
		total
			.checked_add(item.bytes.len())
			.ok_or_else(|| preset_error("saved-set size overflow"))
	})?;
	if total > MAX_SET_BYTES {
		return Err(preset_error("saved-set storage requirement is too large"));
	}
	let account_hash = identifier_hash(account_id);
	let key = load_or_create_key(PRESET_KEY_SERVICE, &account_hash)?;
	let account_dir = root.join(&account_hash);
	fs::create_dir_all(&account_dir).map_err(|_| {
		preset_error("could not create saved-set account directory")
	})?;
	let manifest_estimate = items
		.len()
		.checked_mul(1024)
		.and_then(|value| value.checked_add(name.len() + 1024))
		.ok_or_else(|| {
			preset_error("saved-set storage requirement overflow")
		})?;
	let required = required_storage_bytes(
		&items
			.iter()
			.map(|item| item.bytes.len())
			.collect::<Vec<_>>(),
		manifest_estimate,
	)
	.ok_or_else(|| preset_error("saved-set storage requirement overflow"))?;
	ensure_available_space(&account_dir, required)?;
	let destination = preset_path(root, &account_hash, preset_id);
	if destination.exists() {
		return Err(preset_error("saved set already exists"));
	}
	let staging = account_dir.join(format!(".staging-{preset_id}"));
	remove_directory(&staging)?;
	fs::create_dir_all(&staging)
		.map_err(|_| preset_error("could not stage saved set"))?;
	let result = (|| {
		let now = now_ms();
		let mut manifest_items = Vec::with_capacity(items.len());
		for (order, item) in items.into_iter().enumerate() {
			validate_local_id(&item.item_id)?;
			validate_content_type(&item.mime_type)?;
			if (item.kind == "image") != item.mime_type.starts_with("image/")
				|| (item.kind != "image" && item.kind != "video")
			{
				return Err(preset_error("saved-set media kind is invalid"));
			}
			let checksum = format!("{:x}", Sha256::digest(&item.bytes));
			write_encrypted_atomic(
				&staging.join(format!("{}.ogpi", item.item_id)),
				&item.bytes,
				&key,
				&media_aad(
					&account_hash,
					preset_id,
					&item.item_id,
					&item.mime_type,
				),
				MEDIA_MAGIC,
			)?;
			manifest_items.push(AlbumPresetItem {
				item_id: item.item_id,
				kind: item.kind,
				mime_type: item.mime_type,
				byte_length: item.bytes.len() as u64,
				checksum,
				width: item.width,
				height: item.height,
				duration_ms: item.duration_ms,
				order: order as u32,
			});
		}
		let manifest = AlbumPresetManifest {
			version: 1,
			preset_id: preset_id.to_owned(),
			name: name.to_owned(),
			created_at: now,
			updated_at: now,
			items: manifest_items,
		};
		let manifest_bytes = serde_json::to_vec(&manifest)
			.map_err(|_| preset_error("could not encode saved-set manifest"))?;
		write_encrypted_atomic(
			&staging.join(MANIFEST_FILE),
			&manifest_bytes,
			&key,
			&manifest_aad(&account_hash, preset_id),
			MANIFEST_MAGIC,
		)?;
		fs::rename(&staging, &destination)
			.map_err(|_| preset_error("could not commit saved set"))?;
		Ok(manifest)
	})();
	if result.is_err() {
		let _ = fs::remove_dir_all(&staging);
	}
	result
}

fn list_manifests(
	root: &Path,
	account_id: &str,
) -> Result<Vec<AlbumPresetManifest>, AppError> {
	let account_hash = identifier_hash(account_id);
	let account_dir = root.join(&account_hash);
	if !account_dir.exists() {
		return Ok(Vec::new());
	}
	let key = load_key(PRESET_KEY_SERVICE, &account_hash)?;
	let mut manifests = Vec::new();
	for entry in fs::read_dir(&account_dir)
		.map_err(|_| preset_error("could not enumerate saved sets"))?
	{
		let entry = entry
			.map_err(|_| preset_error("could not enumerate saved sets"))?;
		if !entry
			.file_type()
			.map_err(|_| preset_error("could not inspect saved set"))?
			.is_dir()
		{
			continue;
		}
		let preset_id = entry.file_name().to_string_lossy().into_owned();
		if preset_id.starts_with('.') || preset_id == "journals" {
			continue;
		}
		manifests.push(read_manifest(root, &account_hash, &preset_id, &key)?);
	}
	manifests.sort_by_key(|manifest| std::cmp::Reverse(manifest.updated_at));
	Ok(manifests)
}

fn read_manifest(
	root: &Path,
	account_hash: &str,
	preset_id: &str,
	key: &[u8; 32],
) -> Result<AlbumPresetManifest, AppError> {
	let bytes = read_encrypted_range(
		&preset_path(root, account_hash, preset_id).join(MANIFEST_FILE),
		key,
		&manifest_aad(account_hash, preset_id),
		None,
		MANIFEST_MAGIC,
	)?;
	let manifest: AlbumPresetManifest = serde_json::from_slice(&bytes)
		.map_err(|_| preset_error("saved-set manifest is invalid"))?;
	if manifest.version != 1 || manifest.preset_id != preset_id {
		return Err(preset_error("saved-set manifest identity is invalid"));
	}
	Ok(manifest)
}

fn validate_account(account_id: &str) -> Result<(), AppError> {
	validate_identifier(account_id)?;
	let session = AuthStorage::get_session()?
		.ok_or_else(|| preset_error("saved sets require an active account"))?;
	if session.profile_id == account_id {
		Ok(())
	} else {
		Err(preset_error(
			"saved-set account does not match active account",
		))
	}
}

fn validate_local_id(value: &str) -> Result<(), AppError> {
	if value.len() != 36
		|| value
			.bytes()
			.any(|byte| !(byte.is_ascii_hexdigit() || byte == b'-'))
	{
		Err(preset_error("saved-set local id is invalid"))
	} else {
		Ok(())
	}
}

fn validate_remote_media_type(
	expected: &str,
	actual: Option<&str>,
) -> Result<(), AppError> {
	let expected = expected
		.split(';')
		.next()
		.map(str::trim)
		.unwrap_or_default();
	let actual = actual
		.and_then(|value| value.split(';').next())
		.map(str::trim)
		.filter(|value| !value.is_empty())
		.ok_or_else(|| {
			preset_error("saved-set media content type is missing")
		})?;
	validate_content_type(actual)?;
	if !same_media_category(expected, actual)
		|| !expected.eq_ignore_ascii_case(actual)
	{
		return Err(preset_error(
			"saved-set media content type does not match request",
		));
	}
	Ok(())
}

fn preset_root(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
	app.path()
		.app_data_dir()
		.map(|path| path.join(PRESET_DIR))
		.map_err(|_| preset_error("could not resolve saved-set directory"))
}

fn preset_path(root: &Path, account_hash: &str, preset_id: &str) -> PathBuf {
	root.join(account_hash).join(preset_id)
}

fn item_path(
	root: &Path,
	account_hash: &str,
	preset_id: &str,
	item_id: &str,
) -> PathBuf {
	preset_path(root, account_hash, preset_id).join(format!("{item_id}.ogpi"))
}

fn manifest_aad(account_hash: &str, preset_id: &str) -> Vec<u8> {
	aad_prefix("album-preset-manifest-v1", &[account_hash, preset_id])
}

fn media_aad(
	account_hash: &str,
	preset_id: &str,
	item_id: &str,
	mime_type: &str,
) -> Vec<u8> {
	aad_prefix(
		"album-preset-media-v1",
		&[account_hash, preset_id, item_id, mime_type],
	)
}

fn remove_directory(path: &Path) -> Result<(), AppError> {
	match fs::remove_dir_all(path) {
		Ok(()) => Ok(()),
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
		Err(_) => Err(preset_error("could not remove saved-set data")),
	}
}

fn encrypted_storage_bytes(plaintext_bytes: usize) -> Option<u64> {
	let plaintext = u64::try_from(plaintext_bytes).ok()?;
	let chunks = plaintext.div_ceil(CHUNK_SIZE as u64);
	plaintext
		.checked_add(20)?
		.checked_add(chunks.checked_mul(32)?)
}

fn required_storage_bytes(
	item_lengths: &[usize],
	manifest_estimate: usize,
) -> Option<u64> {
	let encrypted = item_lengths.iter().try_fold(
		encrypted_storage_bytes(manifest_estimate)?,
		|total, length| total.checked_add(encrypted_storage_bytes(*length)?),
	)?;
	encrypted
		.checked_add(encrypted / 20)?
		.checked_add(STORAGE_HEADROOM_BYTES)
}

fn has_sufficient_space(available: u64, required: u64) -> bool {
	available >= required
}

fn ensure_available_space(path: &Path, required: u64) -> Result<(), AppError> {
	let available = available_space(path)?;
	if has_sufficient_space(available, required) {
		Ok(())
	} else {
		Err(preset_error(
			"saved set requires more available device storage",
		))
	}
}

#[cfg(unix)]
fn available_space(path: &Path) -> Result<u64, AppError> {
	use std::{ffi::CString, mem::MaybeUninit, os::unix::ffi::OsStrExt};

	let encoded = CString::new(path.as_os_str().as_bytes())
		.map_err(|_| preset_error("saved-set storage path is invalid"))?;
	let mut stats = MaybeUninit::<libc::statvfs>::uninit();
	// SAFETY: `encoded` is a live, NUL-terminated path and `stats` points to
	// writable storage that is initialized by a successful `statvfs` call.
	let status = unsafe { libc::statvfs(encoded.as_ptr(), stats.as_mut_ptr()) };
	if status != 0 {
		return Err(preset_error(
			"could not inspect available saved-set storage",
		));
	}
	// SAFETY: a zero return from `statvfs` guarantees the output was initialized.
	let stats = unsafe { stats.assume_init() };
	u64::from(stats.f_bavail)
		.checked_mul(stats.f_frsize)
		.ok_or_else(|| preset_error("saved-set available storage overflow"))
}

#[cfg(windows)]
fn available_space(path: &Path) -> Result<u64, AppError> {
	use std::os::windows::ffi::OsStrExt;
	use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

	let encoded = path
		.as_os_str()
		.encode_wide()
		.chain(std::iter::once(0))
		.collect::<Vec<_>>();
	let mut available = 0_u64;
	// SAFETY: `encoded` is NUL terminated and `available` is a valid output
	// pointer. The unused total-space pointers may be null by API contract.
	let status = unsafe {
		GetDiskFreeSpaceExW(
			encoded.as_ptr(),
			&mut available,
			std::ptr::null_mut(),
			std::ptr::null_mut(),
		)
	};
	if status == 0 {
		Err(preset_error(
			"could not inspect available saved-set storage",
		))
	} else {
		Ok(available)
	}
}

#[cfg(not(any(unix, windows)))]
fn available_space(_path: &Path) -> Result<u64, AppError> {
	Err(preset_error(
		"available saved-set storage is unsupported on this platform",
	))
}

fn account_directories(root: &Path) -> Result<Vec<String>, AppError> {
	if !root.exists() {
		return Ok(Vec::new());
	}
	fs::read_dir(root)
		.map_err(|_| preset_error("could not enumerate saved-set accounts"))?
		.filter_map(|entry| {
			let entry = entry.ok()?;
			entry
				.file_type()
				.ok()?
				.is_dir()
				.then(|| entry.file_name().to_string_lossy().into_owned())
		})
		.collect::<Vec<_>>()
		.pipe(Ok)
}

fn preset_error(message: &str) -> AppError {
	media_error(message)
}

trait Pipe: Sized {
	fn pipe<T>(self, function: impl FnOnce(Self) -> T) -> T {
		function(self)
	}
}
impl<T> Pipe for T {}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn encrypted_manifest_and_media_are_account_bound() {
		let temp = std::env::temp_dir()
			.join(format!("open-grind-presets-{}", now_ms()));
		fs::create_dir_all(&temp).unwrap();
		let account = "account-a";
		let account_hash = identifier_hash(account);
		let key = [7_u8; 32];
		let preset = "11111111-1111-4111-8111-111111111111";
		let item = "22222222-2222-4222-8222-222222222222";
		let dir = preset_path(&temp, &account_hash, preset);
		fs::create_dir_all(&dir).unwrap();
		write_encrypted_atomic(
			&dir.join(format!("{item}.ogpi")),
			b"private-media",
			&key,
			&media_aad(&account_hash, preset, item, "image/jpeg"),
			MEDIA_MAGIC,
		)
		.unwrap();
		let raw = fs::read(dir.join(format!("{item}.ogpi"))).unwrap();
		assert!(!raw.windows(13).any(|window| window == b"private-media"));
		assert!(read_encrypted_range(
			&dir.join(format!("{item}.ogpi")),
			&key,
			&media_aad(
				&identifier_hash("account-b"),
				preset,
				item,
				"image/jpeg"
			),
			None,
			MEDIA_MAGIC,
		)
		.is_err());
		fs::remove_dir_all(temp).unwrap();
	}

	#[test]
	fn local_ids_cannot_escape_the_preset_directory() {
		assert!(validate_local_id("../../private/account-data").is_err());
		assert!(
			validate_local_id("11111111-1111-4111-8111-111111111111").is_ok()
		);
	}

	#[test]
	fn remote_snapshots_require_an_exact_supported_media_type() {
		assert!(validate_remote_media_type(
			"image/jpeg",
			Some("image/jpeg; charset=binary")
		)
		.is_ok());
		assert!(validate_remote_media_type("image/jpeg", Some("image/png"))
			.is_err());
		assert!(validate_remote_media_type("video/mp4", None).is_err());
	}

	#[test]
	fn saved_set_capacity_preflight_accounts_for_encryption_and_headroom() {
		let required = required_storage_bytes(&[256 * 1024, 1], 512).unwrap();
		assert!(required > (256 * 1024 + 1 + 512) as u64);
		assert!(has_sufficient_space(required, required));
		assert!(!has_sufficient_space(required - 1, required));
	}
}
