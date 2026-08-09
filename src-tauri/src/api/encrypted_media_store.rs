use std::{
	fs::{self, File},
	io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write},
	path::Path,
	time::{SystemTime, UNIX_EPOCH},
};

use aes_gcm::{
	aead::{Aead, KeyInit, Payload},
	Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::{rngs::OsRng, RngCore};
use serde::{de::DeserializeOwned, Serialize};
use sha2::{Digest, Sha256};
use tauri::http;

use crate::error::AppError;

pub(super) const CHUNK_SIZE: usize = 256 * 1024;
pub(super) const MAX_RANGE_BYTES: u64 = 8 * 1024 * 1024;

pub(super) fn media_error(message: &str) -> AppError {
	AppError::Api {
		code: 500,
		message: message.to_owned(),
	}
}

pub(super) fn io_error(_: std::io::Error) -> AppError {
	media_error("album cache I/O failed")
}

pub(super) fn validate_identifier(value: &str) -> Result<(), AppError> {
	if value.is_empty()
		|| value.len() > 256
		|| value.chars().any(char::is_control)
	{
		Err(media_error("invalid album cache identifier"))
	} else {
		Ok(())
	}
}

pub(super) fn validate_content_type(value: &str) -> Result<(), AppError> {
	if matches!(value.split(';').next(), Some(kind) if kind.starts_with("image/") || kind.starts_with("video/"))
	{
		Ok(())
	} else {
		Err(media_error("contentType must be image or video media"))
	}
}

pub(super) fn validate_cdn_url(value: &str) -> Result<reqwest::Url, AppError> {
	let url = reqwest::Url::parse(value)
		.map_err(|_| media_error("invalid media URL"))?;
	if cdn_host_allowed(&url) {
		Ok(url)
	} else {
		Err(media_error("media URL host is not allowed"))
	}
}

pub(super) fn cdn_host_allowed(url: &reqwest::Url) -> bool {
	url.scheme() == "https"
		&& url.host_str().is_some_and(|host| {
			host.eq_ignore_ascii_case("cdns.grindr.com")
				|| host.to_ascii_lowercase().ends_with(".cloudfront.net")
		})
}

pub(super) fn same_media_category(expected: &str, actual: &str) -> bool {
	expected.split('/').next() == actual.split('/').next()
}

pub(super) fn identifier_hash(identifier: &str) -> String {
	URL_SAFE_NO_PAD.encode(Sha256::digest(identifier.as_bytes()))
}

fn key_entry(
	service: &str,
	account_hash: &str,
) -> Result<keyring_core::Entry, AppError> {
	keyring_core::Entry::new(service, account_hash)
		.map_err(|_| media_error("could not access album cache key"))
}

pub(super) fn load_or_create_key(
	service: &str,
	account_hash: &str,
) -> Result<[u8; 32], AppError> {
	match key_entry(service, account_hash)?.get_secret() {
		Ok(bytes) => key_from_bytes(&bytes),
		Err(keyring_core::Error::NoEntry) => {
			let mut key = [0_u8; 32];
			OsRng.fill_bytes(&mut key);
			key_entry(service, account_hash)?.set_secret(&key).map_err(
				|_| media_error("could not persist album cache key"),
			)?;
			Ok(key)
		}
		Err(_) => Err(media_error("could not read album cache key")),
	}
}

pub(super) fn load_key(
	service: &str,
	account_hash: &str,
) -> Result<[u8; 32], AppError> {
	let bytes = key_entry(service, account_hash)?
		.get_secret()
		.map_err(|_| media_error("album cache key is unavailable"))?;
	key_from_bytes(&bytes)
}

fn key_from_bytes(bytes: &[u8]) -> Result<[u8; 32], AppError> {
	bytes
		.try_into()
		.map_err(|_| media_error("album cache key is invalid"))
}

pub(super) fn delete_key(
	service: &str,
	account_hash: &str,
) -> Result<(), AppError> {
	match key_entry(service, account_hash)?.delete_credential() {
		Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
		Err(_) => Err(media_error("could not delete album cache key")),
	}
}

pub(super) fn aad_prefix(version: &str, parts: &[&str]) -> Vec<u8> {
	let mut prefix = version.as_bytes().to_vec();
	for part in parts {
		prefix.push(0);
		prefix.extend_from_slice(part.as_bytes());
	}
	prefix
}

fn chunk_aad(prefix: &[u8], index: u64) -> Vec<u8> {
	let mut aad = Vec::with_capacity(prefix.len() + 8);
	aad.extend_from_slice(prefix);
	aad.extend_from_slice(&index.to_le_bytes());
	aad
}

pub(super) fn write_encrypted_atomic(
	path: &Path,
	bytes: &[u8],
	key: &[u8; 32],
	aad: &[u8],
	magic: &[u8; 8],
) -> Result<(), AppError> {
	let parent = path
		.parent()
		.ok_or_else(|| media_error("invalid cache path"))?;
	let temp = parent.join(format!(".{}.tmp", random_token()));
	let result = (|| {
		let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| {
			media_error("could not initialize album encryption")
		})?;
		let mut writer = BufWriter::new(
			File::create(&temp)
				.map_err(|_| media_error("could not create cache file"))?,
		);
		writer.write_all(magic).map_err(io_error)?;
		writer
			.write_all(&(CHUNK_SIZE as u32).to_le_bytes())
			.map_err(io_error)?;
		writer
			.write_all(&(bytes.len() as u64).to_le_bytes())
			.map_err(io_error)?;
		for (index, chunk) in bytes.chunks(CHUNK_SIZE).enumerate() {
			write_encrypted_chunk(
				&mut writer,
				&cipher,
				chunk,
				aad,
				index as u64,
			)?;
		}
		writer.flush().map_err(io_error)?;
		writer.get_ref().sync_all().map_err(io_error)?;
		fs::rename(&temp, path)
			.map_err(|_| media_error("could not commit cache file"))?;
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

pub(super) async fn stream_encrypted_atomic(
	mut response: reqwest::Response,
	path: &Path,
	key: &[u8; 32],
	aad: &[u8],
	maximum_bytes: u64,
	magic: &[u8; 8],
) -> Result<u64, AppError> {
	let parent = path
		.parent()
		.ok_or_else(|| media_error("invalid cache path"))?;
	let temp = parent.join(format!(".{}.tmp", random_token()));
	let result = async {
		let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| {
			media_error("could not initialize album encryption")
		})?;
		let mut writer = BufWriter::new(
			File::create(&temp)
				.map_err(|_| media_error("could not create cache file"))?,
		);
		writer.write_all(magic).map_err(io_error)?;
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
			.map_err(|_| media_error("media download failed"))?
		{
			byte_length = byte_length
				.checked_add(chunk.len() as u64)
				.ok_or_else(|| media_error("media size overflow"))?;
			if byte_length > maximum_bytes {
				return Err(media_error("media exceeds maximumBytes"));
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
			return Err(media_error("media response was empty"));
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
			.map_err(|_| media_error("could not commit cache file"))?;
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
		.map_err(|_| media_error("album encryption failed"))?;
	writer.write_all(&nonce).map_err(io_error)?;
	writer
		.write_all(&(ciphertext.len() as u32).to_le_bytes())
		.map_err(io_error)?;
	writer.write_all(&ciphertext).map_err(io_error)
}

pub(super) fn read_encrypted_range(
	path: &Path,
	key: &[u8; 32],
	aad: &[u8],
	range: Option<(u64, u64)>,
	magic: &[u8; 8],
) -> Result<Vec<u8>, AppError> {
	let cipher = Aes256Gcm::new_from_slice(key)
		.map_err(|_| media_error("could not initialize album encryption"))?;
	let mut reader = BufReader::new(
		File::open(path)
			.map_err(|_| media_error("cache file is unavailable"))?,
	);
	let (chunk_size, total) = read_header(&mut reader, magic)?;
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
			.map_err(|_| media_error("cached media authentication failed"))?;
		let chunk_start = index * chunk_size as u64;
		let local_start = start.saturating_sub(chunk_start) as usize;
		let local_end = ((end - chunk_start + 1) as usize).min(plaintext.len());
		output.extend_from_slice(&plaintext[local_start..local_end]);
	}
	Ok(output)
}

pub(super) fn encrypted_plaintext_length(
	path: &Path,
	magic: &[u8; 8],
) -> Result<u64, AppError> {
	let mut reader = BufReader::new(
		File::open(path)
			.map_err(|_| media_error("cache file is unavailable"))?,
	);
	read_header(&mut reader, magic).map(|(_, total)| total)
}

fn read_header(
	reader: &mut impl Read,
	magic: &[u8; 8],
) -> Result<(usize, u64), AppError> {
	let mut stored_magic = [0_u8; 8];
	reader.read_exact(&mut stored_magic).map_err(io_error)?;
	if &stored_magic != magic {
		return Err(media_error("invalid album cache file"));
	}
	let chunk_size = read_u32(reader)? as usize;
	let mut total = [0_u8; 8];
	reader.read_exact(&mut total).map_err(io_error)?;
	let total = u64::from_le_bytes(total);
	if chunk_size == 0 || total == 0 {
		return Err(media_error("invalid album cache header"));
	}
	Ok((chunk_size, total))
}

fn read_u32(reader: &mut impl Read) -> Result<u32, AppError> {
	let mut bytes = [0_u8; 4];
	reader.read_exact(&mut bytes).map_err(io_error)?;
	Ok(u32::from_le_bytes(bytes))
}

pub(super) fn parse_range(
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

pub(super) fn load_json_index<T: DeserializeOwned + Default>(
	root: &Path,
	index_file: &str,
) -> Result<T, AppError> {
	match fs::read(root.join(index_file)) {
		Ok(bytes) => serde_json::from_slice(&bytes)
			.map_err(|_| media_error("album cache index is invalid")),
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
			Ok(T::default())
		}
		Err(_) => Err(media_error("could not read album cache index")),
	}
}

pub(super) fn save_json_index<T: Serialize>(
	root: &Path,
	index_file: &str,
	index: &T,
) -> Result<(), AppError> {
	fs::create_dir_all(root)
		.map_err(|_| media_error("could not create album cache directory"))?;
	let temp = root.join(format!(".{index_file}.tmp"));
	let bytes = serde_json::to_vec(index)
		.map_err(|_| media_error("could not encode album cache index"))?;
	fs::write(&temp, bytes)
		.map_err(|_| media_error("could not write album cache index"))?;
	File::open(&temp)
		.and_then(|file| file.sync_all())
		.map_err(io_error)?;
	fs::rename(&temp, root.join(index_file))
		.map_err(|_| media_error("could not commit album cache index"))?;
	File::open(root)
		.and_then(|file| file.sync_all())
		.map_err(io_error)
}

pub(super) fn protocol_url(scheme: &str, token: &str) -> String {
	if cfg!(any(target_os = "android", target_os = "windows")) {
		format!("http://{scheme}.localhost/{token}")
	} else {
		format!("{scheme}://localhost/{token}")
	}
}

pub(super) fn random_token() -> String {
	let mut bytes = [0_u8; 24];
	OsRng.fill_bytes(&mut bytes);
	URL_SAFE_NO_PAD.encode(bytes)
}

pub(super) fn now_ms() -> u64 {
	SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.unwrap_or_default()
		.as_millis() as u64
}
