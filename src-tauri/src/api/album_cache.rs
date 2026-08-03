use std::{
	collections::{HashMap, HashSet},
	fs::{self, File},
	io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write},
	path::{Path, PathBuf},
	time::{SystemTime, UNIX_EPOCH},
};

use aes_gcm::{
	aead::{Aead, KeyInit, Payload},
	Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{http, Manager};

use crate::{error::AppError, storage::AuthStorage};

const SCHEME: &str = "album-cache";
const CACHE_DIR: &str = "album-cache-v1";
const INDEX_FILE: &str = "index.json";
const MAGIC: &[u8; 8] = b"OGALBC01";
const CHUNK_SIZE: usize = 256 * 1024;
const MAX_RANGE_BYTES: u64 = 8 * 1024 * 1024;
const KEY_SERVICE: &str = "open-grind-album-cache";
static CACHE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheEntry {
	account_hash: String,
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
	album_id: String,
	content_id: String,
	source_url: String,
	content_type: String,
	maximum_bytes: u64,
) -> Result<AlbumCacheStored, AppError> {
	validate_identifier(&account_id)?;
	ensure_active_account(&account_id)?;
	validate_identifier(&album_id)?;
	validate_identifier(&content_id)?;
	validate_content_type(&content_type)?;
	let source = validate_cdn_url(&source_url)?;
	if maximum_bytes == 0 {
		return Err(cache_error("maximumBytes must be greater than zero"));
	}

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
	let album_hash = identifier_hash(&album_id);
	let content_hash = identifier_hash(&content_id);
	let key = {
		let _guard = CACHE_LOCK.lock().await;
		load_or_create_key(&account_hash)?
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
		&aad_prefix(&account_hash, &album_hash, &content_hash, &content_type),
		maximum_bytes,
	)
	.await?;

	let _guard = CACHE_LOCK.lock().await;
	let mut index = load_index(&root)?;
	let old_files: Vec<PathBuf> = index
		.entries
		.iter()
		.filter(|entry| {
			entry.account_hash == account_hash
				&& entry.album_hash == album_hash
				&& entry.content_hash == content_hash
		})
		.map(|entry| entry_path(&root, entry))
		.collect();
	index.entries.retain(|entry| {
		!(entry.account_hash == account_hash
			&& entry.album_hash == album_hash
			&& entry.content_hash == content_hash)
	});
	index.entries.push(CacheEntry {
		account_hash,
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
	album_id: String,
	content_id: String,
) -> Result<AlbumCacheLookup, AppError> {
	ensure_active_account(&account_id)?;
	let root = cache_root(&app)?;
	let account_hash = identifier_hash(&account_id);
	let album_hash = identifier_hash(&album_id);
	let content_hash = identifier_hash(&content_id);
	let _guard = CACHE_LOCK.lock().await;
	let mut index = load_index(&root)?;
	let Some(entry) = index.entries.iter_mut().find(|entry| {
		entry.account_hash == account_hash
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
	if let Some(account_id) = account_id.as_deref() {
		ensure_active_account(account_id)?;
	}
	let root = cache_root(&app)?;
	let _guard = CACHE_LOCK.lock().await;
	let mut index = load_index(&root)?;
	let requested_hash = account_id.as_deref().map(identifier_hash);
	let removed_accounts: HashSet<String> = index
		.entries
		.iter()
		.filter(|entry| {
			requested_hash
				.as_ref()
				.is_none_or(|id| id == &entry.account_hash)
		})
		.map(|entry| entry.account_hash.clone())
		.collect();
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
	for account in removed_accounts {
		delete_key(&account)?;
		let _ = fs::remove_dir_all(root.join(account));
	}
	save_index(&root, &index)?;
	Ok(stats_for(&index, None))
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
	let key =
		load_key(&entry.account_hash).map_err(|_| http::StatusCode::GONE)?;
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
			&aad_prefix(
				&entry.account_hash,
				&entry.album_hash,
				&entry.content_hash,
				&entry.content_type,
			),
			range,
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

fn validate_identifier(value: &str) -> Result<(), AppError> {
	if value.is_empty()
		|| value.len() > 256
		|| value.chars().any(char::is_control)
	{
		Err(cache_error("invalid album cache identifier"))
	} else {
		Ok(())
	}
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

fn validate_content_type(value: &str) -> Result<(), AppError> {
	if matches!(value.split(';').next(), Some(kind) if kind.starts_with("image/") || kind.starts_with("video/"))
	{
		Ok(())
	} else {
		Err(cache_error("contentType must be image or video media"))
	}
}

fn validate_cdn_url(value: &str) -> Result<reqwest::Url, AppError> {
	let url = reqwest::Url::parse(value)
		.map_err(|_| cache_error("invalid media URL"))?;
	if cdn_host_allowed(&url) {
		Ok(url)
	} else {
		Err(cache_error("media URL host is not allowed"))
	}
}

fn cdn_host_allowed(url: &reqwest::Url) -> bool {
	url.scheme() == "https"
		&& url.host_str().is_some_and(|host| {
			host.eq_ignore_ascii_case("cdns.grindr.com")
				|| host.to_ascii_lowercase().ends_with(".cloudfront.net")
		})
}

fn same_media_category(expected: &str, actual: &str) -> bool {
	expected.split('/').next() == actual.split('/').next()
}

fn identifier_hash(identifier: &str) -> String {
	URL_SAFE_NO_PAD.encode(Sha256::digest(identifier.as_bytes()))
}

fn key_entry(account_hash: &str) -> Result<keyring_core::Entry, AppError> {
	keyring_core::Entry::new(KEY_SERVICE, account_hash)
		.map_err(|_| cache_error("could not access album cache key"))
}

fn load_or_create_key(account_hash: &str) -> Result<[u8; 32], AppError> {
	match key_entry(account_hash)?.get_secret() {
		Ok(bytes) => key_from_bytes(&bytes),
		Err(keyring_core::Error::NoEntry) => {
			let mut key = [0_u8; 32];
			OsRng.fill_bytes(&mut key);
			key_entry(account_hash)?.set_secret(&key).map_err(|_| {
				cache_error("could not persist album cache key")
			})?;
			Ok(key)
		}
		Err(_) => Err(cache_error("could not read album cache key")),
	}
}

fn load_key(account_hash: &str) -> Result<[u8; 32], AppError> {
	let bytes = key_entry(account_hash)?
		.get_secret()
		.map_err(|_| cache_error("album cache key is unavailable"))?;
	key_from_bytes(&bytes)
}

fn key_from_bytes(bytes: &[u8]) -> Result<[u8; 32], AppError> {
	bytes
		.try_into()
		.map_err(|_| cache_error("album cache key is invalid"))
}

fn delete_key(account_hash: &str) -> Result<(), AppError> {
	match key_entry(account_hash)?.delete_credential() {
		Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
		Err(_) => Err(cache_error("could not delete album cache key")),
	}
}

fn aad_prefix(
	account_hash: &str,
	album_hash: &str,
	content_hash: &str,
	content_type: &str,
) -> Vec<u8> {
	format!("v1\0{account_hash}\0{album_hash}\0{content_hash}\0{content_type}")
		.into_bytes()
}

fn chunk_aad(prefix: &[u8], index: u64) -> Vec<u8> {
	let mut aad = Vec::with_capacity(prefix.len() + 8);
	aad.extend_from_slice(prefix);
	aad.extend_from_slice(&index.to_le_bytes());
	aad
}

#[cfg(test)]
fn write_encrypted_atomic(
	path: &Path,
	bytes: &[u8],
	key: &[u8; 32],
	aad: &[u8],
) -> Result<(), AppError> {
	let parent = path
		.parent()
		.ok_or_else(|| cache_error("invalid cache path"))?;
	let temp = parent.join(format!(".{}.tmp", random_token()));
	let result = (|| {
		let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| {
			cache_error("could not initialize album encryption")
		})?;
		let mut writer = BufWriter::new(
			File::create(&temp)
				.map_err(|_| cache_error("could not create cache file"))?,
		);
		writer.write_all(MAGIC).map_err(io_error)?;
		writer
			.write_all(&(CHUNK_SIZE as u32).to_le_bytes())
			.map_err(io_error)?;
		writer
			.write_all(&(bytes.len() as u64).to_le_bytes())
			.map_err(io_error)?;
		for (index, chunk) in bytes.chunks(CHUNK_SIZE).enumerate() {
			let mut nonce = [0_u8; 12];
			OsRng.fill_bytes(&mut nonce);
			let ciphertext = cipher
				.encrypt(
					Nonce::from_slice(&nonce),
					Payload {
						msg: chunk,
						aad: &chunk_aad(aad, index as u64),
					},
				)
				.map_err(|_| cache_error("album encryption failed"))?;
			writer.write_all(&nonce).map_err(io_error)?;
			writer
				.write_all(&(ciphertext.len() as u32).to_le_bytes())
				.map_err(io_error)?;
			writer.write_all(&ciphertext).map_err(io_error)?;
		}
		writer.flush().map_err(io_error)?;
		writer.get_ref().sync_all().map_err(io_error)?;
		fs::rename(&temp, path)
			.map_err(|_| cache_error("could not commit cache file"))?;
		File::open(parent)
			.and_then(|file| file.sync_all())
			.map_err(io_error)?;
		Ok(())
	})();
	if result.is_err() {
		let _ = fs::remove_file(&temp);
	}
	result
}

async fn stream_encrypted_atomic(
	mut response: reqwest::Response,
	path: &Path,
	key: &[u8; 32],
	aad: &[u8],
	maximum_bytes: u64,
) -> Result<u64, AppError> {
	let parent = path
		.parent()
		.ok_or_else(|| cache_error("invalid cache path"))?;
	let temp = parent.join(format!(".{}.tmp", random_token()));
	let result = async {
		let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| {
			cache_error("could not initialize album encryption")
		})?;
		let mut writer = BufWriter::new(
			File::create(&temp)
				.map_err(|_| cache_error("could not create cache file"))?,
		);
		writer.write_all(MAGIC).map_err(io_error)?;
		writer
			.write_all(&(CHUNK_SIZE as u32).to_le_bytes())
			.map_err(io_error)?;
		writer.write_all(&0_u64.to_le_bytes()).map_err(io_error)?;

		let mut pending = Vec::with_capacity(CHUNK_SIZE * 2);
		let mut byte_length = 0_u64;
		let mut chunk_index = 0_u64;
		while let Some(chunk) = response
			.chunk()
			.await
			.map_err(|_| cache_error("media download failed"))?
		{
			byte_length = byte_length
				.checked_add(chunk.len() as u64)
				.ok_or_else(|| cache_error("media size overflow"))?;
			if byte_length > maximum_bytes {
				return Err(cache_error("media exceeds maximumBytes"));
			}
			pending.extend_from_slice(&chunk);
			while pending.len() >= CHUNK_SIZE {
				let remainder = pending.split_off(CHUNK_SIZE);
				write_encrypted_chunk(
					&mut writer,
					&cipher,
					&pending,
					aad,
					chunk_index,
				)?;
				pending = remainder;
				chunk_index += 1;
			}
		}
		if byte_length == 0 {
			return Err(cache_error("media response was empty"));
		}
		if !pending.is_empty() {
			write_encrypted_chunk(
				&mut writer,
				&cipher,
				&pending,
				aad,
				chunk_index,
			)?;
		}
		writer.seek(SeekFrom::Start(12)).map_err(io_error)?;
		writer
			.write_all(&byte_length.to_le_bytes())
			.map_err(io_error)?;
		writer.flush().map_err(io_error)?;
		writer.get_ref().sync_all().map_err(io_error)?;
		fs::rename(&temp, path)
			.map_err(|_| cache_error("could not commit cache file"))?;
		File::open(parent)
			.and_then(|file| file.sync_all())
			.map_err(io_error)?;
		Ok(byte_length)
	}
	.await;
	if result.is_err() {
		let _ = fs::remove_file(&temp);
	}
	result
}

fn write_encrypted_chunk(
	writer: &mut impl Write,
	cipher: &Aes256Gcm,
	plaintext: &[u8],
	aad: &[u8],
	chunk_index: u64,
) -> Result<(), AppError> {
	let mut nonce = [0_u8; 12];
	OsRng.fill_bytes(&mut nonce);
	let ciphertext = cipher
		.encrypt(
			Nonce::from_slice(&nonce),
			Payload {
				msg: plaintext,
				aad: &chunk_aad(aad, chunk_index),
			},
		)
		.map_err(|_| cache_error("album encryption failed"))?;
	writer.write_all(&nonce).map_err(io_error)?;
	writer
		.write_all(&(ciphertext.len() as u32).to_le_bytes())
		.map_err(io_error)?;
	writer.write_all(&ciphertext).map_err(io_error)
}

fn read_encrypted_range(
	path: &Path,
	key: &[u8; 32],
	aad: &[u8],
	range: Option<(u64, u64)>,
) -> Result<Vec<u8>, AppError> {
	let cipher = Aes256Gcm::new_from_slice(key)
		.map_err(|_| cache_error("could not initialize album encryption"))?;
	let mut reader = BufReader::new(
		File::open(path)
			.map_err(|_| cache_error("cache file is unavailable"))?,
	);
	let (chunk_size, total) = read_header(&mut reader)?;
	let (start, end) = range.unwrap_or((0, total.saturating_sub(1)));
	let first_chunk = start / chunk_size as u64;
	let last_chunk = end / chunk_size as u64;
	let mut output = Vec::with_capacity((end - start + 1) as usize);
	for index in 0..=(total.saturating_sub(1) / chunk_size as u64) {
		let mut nonce = [0_u8; 12];
		reader.read_exact(&mut nonce).map_err(io_error)?;
		let ciphertext_len = read_u32(&mut reader)? as usize;
		if index < first_chunk || index > last_chunk {
			reader
				.seek(SeekFrom::Current(ciphertext_len as i64))
				.map_err(io_error)?;
			continue;
		}
		let mut ciphertext = vec![0_u8; ciphertext_len];
		reader.read_exact(&mut ciphertext).map_err(io_error)?;
		let plaintext = cipher
			.decrypt(
				Nonce::from_slice(&nonce),
				Payload {
					msg: &ciphertext,
					aad: &chunk_aad(aad, index),
				},
			)
			.map_err(|_| cache_error("cached media authentication failed"))?;
		let chunk_start = index * chunk_size as u64;
		let local_start = start.saturating_sub(chunk_start) as usize;
		let local_end = ((end - chunk_start + 1) as usize).min(plaintext.len());
		output.extend_from_slice(&plaintext[local_start..local_end]);
	}
	Ok(output)
}

fn read_header(reader: &mut impl Read) -> Result<(usize, u64), AppError> {
	let mut magic = [0_u8; 8];
	reader.read_exact(&mut magic).map_err(io_error)?;
	if &magic != MAGIC {
		return Err(cache_error("invalid album cache file"));
	}
	let chunk_size = read_u32(reader)? as usize;
	let mut total = [0_u8; 8];
	reader.read_exact(&mut total).map_err(io_error)?;
	let total = u64::from_le_bytes(total);
	if chunk_size == 0 || total == 0 {
		return Err(cache_error("invalid album cache header"));
	}
	Ok((chunk_size, total))
}

fn read_u32(reader: &mut impl Read) -> Result<u32, AppError> {
	let mut bytes = [0_u8; 4];
	reader.read_exact(&mut bytes).map_err(io_error)?;
	Ok(u32::from_le_bytes(bytes))
}

fn parse_range(
	value: Option<&http::HeaderValue>,
	total: u64,
) -> Result<Option<(u64, u64)>, http::StatusCode> {
	let Some(value) = value else {
		return Ok(None);
	};
	let value = value
		.to_str()
		.map_err(|_| http::StatusCode::RANGE_NOT_SATISFIABLE)?;
	let spec = value
		.strip_prefix("bytes=")
		.filter(|value| !value.contains(','))
		.ok_or(http::StatusCode::RANGE_NOT_SATISFIABLE)?;
	let (start, end) = spec
		.split_once('-')
		.ok_or(http::StatusCode::RANGE_NOT_SATISFIABLE)?;
	let (start, end) = if start.is_empty() {
		let suffix = end
			.parse::<u64>()
			.map_err(|_| http::StatusCode::RANGE_NOT_SATISFIABLE)?;
		if suffix == 0 {
			return Err(http::StatusCode::RANGE_NOT_SATISFIABLE);
		}
		(
			total.saturating_sub(suffix.min(total)),
			total.saturating_sub(1),
		)
	} else {
		let start = start
			.parse::<u64>()
			.map_err(|_| http::StatusCode::RANGE_NOT_SATISFIABLE)?;
		let end = if end.is_empty() {
			total.saturating_sub(1)
		} else {
			end.parse::<u64>()
				.map_err(|_| http::StatusCode::RANGE_NOT_SATISFIABLE)?
		};
		(start, end.min(total.saturating_sub(1)))
	};
	if total == 0
		|| start > end
		|| start >= total
		|| end - start + 1 > MAX_RANGE_BYTES
	{
		return Err(http::StatusCode::RANGE_NOT_SATISFIABLE);
	}
	Ok(Some((start, end)))
}

fn load_index(root: &Path) -> Result<CacheIndex, AppError> {
	let path = root.join(INDEX_FILE);
	match fs::read(path) {
		Ok(bytes) => serde_json::from_slice(&bytes)
			.map_err(|_| cache_error("album cache index is invalid")),
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
			Ok(CacheIndex::default())
		}
		Err(_) => Err(cache_error("could not read album cache index")),
	}
}

fn save_index(root: &Path, index: &CacheIndex) -> Result<(), AppError> {
	fs::create_dir_all(root)
		.map_err(|_| cache_error("could not create album cache directory"))?;
	let temp = root.join(format!(".{INDEX_FILE}.tmp"));
	let bytes = serde_json::to_vec(index)
		.map_err(|_| cache_error("could not encode album cache index"))?;
	fs::write(&temp, bytes)
		.map_err(|_| cache_error("could not write album cache index"))?;
	File::open(&temp)
		.and_then(|file| file.sync_all())
		.map_err(io_error)?;
	fs::rename(&temp, root.join(INDEX_FILE))
		.map_err(|_| cache_error("could not commit album cache index"))?;
	File::open(root)
		.and_then(|file| file.sync_all())
		.map_err(io_error)
}

fn trim_index(
	root: &Path,
	index: &mut CacheIndex,
	maximum_bytes: u64,
) -> Result<(), AppError> {
	let mut total: u64 =
		index.entries.iter().map(|entry| entry.byte_length).sum();
	let mut albums: HashMap<(String, String), (u64, u64)> = HashMap::new();
	for entry in &index.entries {
		let album = albums
			.entry((entry.account_hash.clone(), entry.album_hash.clone()))
			.or_insert((0, entry.last_accessed_ms));
		album.0 += entry.byte_length;
		album.1 = album.1.max(entry.last_accessed_ms);
	}
	let mut albums: Vec<_> = albums.into_iter().collect();
	albums.sort_by_key(|(_, (_, accessed))| *accessed);
	let mut evict = HashSet::new();
	for ((account, album), (bytes, _)) in albums {
		if total <= maximum_bytes {
			break;
		}
		total = total.saturating_sub(bytes);
		evict.insert((account, album));
	}
	for entry in &index.entries {
		if evict
			.contains(&(entry.account_hash.clone(), entry.album_hash.clone()))
		{
			let _ = fs::remove_file(entry_path(root, entry));
		}
	}
	index.entries.retain(|entry| {
		!evict.contains(&(entry.account_hash.clone(), entry.album_hash.clone()))
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
			.map(|entry| (&entry.account_hash, &entry.album_hash))
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
	if cfg!(any(target_os = "android", target_os = "windows")) {
		format!("http://{SCHEME}.localhost/{token}")
	} else {
		format!("{SCHEME}://localhost/{token}")
	}
}
fn random_token() -> String {
	let mut bytes = [0_u8; 24];
	OsRng.fill_bytes(&mut bytes);
	URL_SAFE_NO_PAD.encode(bytes)
}
fn now_ms() -> u64 {
	SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.unwrap_or_default()
		.as_millis() as u64
}
fn io_error(_: std::io::Error) -> AppError {
	cache_error("album cache I/O failed")
}
fn cache_error(message: &str) -> AppError {
	AppError::Api {
		code: 500,
		message: message.to_owned(),
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn temp_dir() -> PathBuf {
		let path = std::env::temp_dir()
			.join(format!("open-grind-album-cache-test-{}", random_token()));
		fs::create_dir_all(&path).unwrap();
		path
	}

	#[test]
	fn encrypted_file_round_trips_full_and_cross_chunk_ranges() {
		let root = temp_dir();
		let path = root.join("media.ogac");
		let key = [7_u8; 32];
		let bytes: Vec<u8> = (0..CHUNK_SIZE * 2 + 91)
			.map(|index| (index % 251) as u8)
			.collect();
		write_encrypted_atomic(&path, &bytes, &key, b"identity").unwrap();
		assert_ne!(fs::read(&path).unwrap(), bytes);
		assert_eq!(
			read_encrypted_range(&path, &key, b"identity", None).unwrap(),
			bytes
		);
		let range = (CHUNK_SIZE as u64 - 17, CHUNK_SIZE as u64 + 23);
		assert_eq!(
			read_encrypted_range(&path, &key, b"identity", Some(range))
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
		write_encrypted_atomic(&path, b"private media", &key, b"account-a")
			.unwrap();
		assert!(read_encrypted_range(&path, &key, b"account-b", None).is_err());
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
		assert!(read_encrypted_range(&path, &key, b"account-a", None).is_err());
		fs::remove_dir_all(root).unwrap();
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
