use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::state::AppState;

/// Response of the signed chat-media upload, re-serialized camelCase so the same
/// struct deserializes from Grindr and serializes back to the frontend.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaUploadResponse {
	pub media_id: i64,
	pub url: String,
	pub media_hash: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumMediaUploadResponse {
	pub content_id: i64,
	pub content_url: Option<String>,
}

const MAX_ALBUM_UPLOAD_BYTES: usize = 128 * 1024 * 1024;
const ALBUM_MEDIA_TYPES: &[&str] =
	&["image/jpeg", "image/png", "video/mp4", "video/webm"];

fn multipart_boundary(album_id: i64, data: &[u8]) -> String {
	for suffix in 0_u32.. {
		let candidate = format!("open-grind-album-{album_id}-{suffix}");
		if !data
			.windows(candidate.len())
			.any(|window| window == candidate.as_bytes())
		{
			return candidate;
		}
	}
	unreachable!("u32 boundary space exhausted")
}

fn album_multipart_body(
	album_id: i64,
	content_type: &str,
	data: &[u8],
) -> (String, Vec<u8>) {
	let boundary = multipart_boundary(album_id, data);
	let header = format!(
		"--{boundary}\r\nContent-Disposition: form-data; name=\"content\"; \
		 filename=\"upload\"\r\nContent-Type: {content_type}\r\n\r\n"
	);
	let footer = format!("\r\n--{boundary}--\r\n");
	let mut body = Vec::with_capacity(header.len() + data.len() + footer.len());
	body.extend_from_slice(header.as_bytes());
	body.extend_from_slice(data);
	body.extend_from_slice(footer.as_bytes());
	(boundary, body)
}

/// Uploads raw media bytes via the device-key-signed chat-media endpoint
/// (`POST /v6/chat/media/upload`) and returns the new `mediaId`. grindr.rs
/// registers the session signing key and adds the `X-Key-Id`/`X-Sig`/
/// `X-Timestamp`/`X-Nonce` headers on first use.
#[tauri::command]
pub async fn upload_chat_media(
	state: tauri::State<'_, AppState>,
	content_type: String,
	taken_on_grindr: bool,
	length: Option<i64>,
	looping: Option<bool>,
	// Base64, because raw byte arrays over the Tauri IPC are unreliable.
	// https://github.com/tauri-apps/tauri/issues/10573
	data: String,
) -> Result<MediaUploadResponse, AppError> {
	let bytes = STANDARD.decode(&data).map_err(|e| {
		AppError::Http(format!("Failed to decode base64 media: {e}"))
	})?;
	if length.is_some_and(|value| value < 0) {
		return Err(AppError::Api {
			code: 400,
			message: "Invalid media length".to_owned(),
		});
	}

	let response = state
		.client()?
		.upload_chat_media(
			bytes,
			&content_type,
			length,
			looping,
			taken_on_grindr,
		)
		.await?;

	Ok(MediaUploadResponse {
		media_id: response.media_id,
		url: response.url,
		media_hash: response.media_hash,
	})
}

/// Uploads an image or video to an owned album. This endpoint expects a
/// multipart body but ordinary session authentication, unlike signed chat
/// uploads. Media bytes stay behind Tauri IPC and never enter the REST debug
/// request representation.
#[tauri::command]
pub async fn upload_album_media(
	state: tauri::State<'_, AppState>,
	album_id: i64,
	content_type: String,
	data: String,
) -> Result<AlbumMediaUploadResponse, AppError> {
	if album_id < 0 {
		return Err(AppError::Api {
			code: 400,
			message: "Invalid album id".to_owned(),
		});
	}
	if !ALBUM_MEDIA_TYPES.contains(&content_type.as_str()) {
		return Err(AppError::Api {
			code: 415,
			message: "Unsupported album media type".to_owned(),
		});
	}
	let bytes = STANDARD.decode(&data).map_err(|e| {
		AppError::Http(format!("Failed to decode base64 media: {e}"))
	})?;
	if bytes.is_empty() || bytes.len() > MAX_ALBUM_UPLOAD_BYTES {
		return Err(AppError::Api {
			code: 413,
			message: "Album media size is outside the supported range"
				.to_owned(),
		});
	}

	let (boundary, body) =
		album_multipart_body(album_id, &content_type, &bytes);
	let multipart_content_type =
		format!("multipart/form-data; boundary={boundary}");
	let path = format!("/v1/albums/{album_id}/content");
	let response = state
		.client()?
		.request_authenticated_bytes(
			grindr::Method::POST,
			&path,
			&multipart_content_type,
			body,
		)
		.await?;
	if !(200..300).contains(&response.status) {
		return Err(grindr::GrindrError::from_response(
			response.status,
			&response.body,
		)
		.into());
	}
	serde_json::from_slice(&response.body).map_err(|e| {
		AppError::Http(format!("Failed to decode album upload response: {e}"))
	})
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn album_multipart_contains_one_content_part_and_exact_bytes() {
		let bytes = [0, 1, b'\r', b'\n', 255];
		let (boundary, body) = album_multipart_body(42, "image/jpeg", &bytes);
		let prefix = format!(
			"--{boundary}\r\nContent-Disposition: form-data; name=\"content\"; \
			 filename=\"upload\"\r\nContent-Type: image/jpeg\r\n\r\n"
		);
		let suffix = format!("\r\n--{boundary}--\r\n");

		assert!(body.starts_with(prefix.as_bytes()));
		assert!(body.ends_with(suffix.as_bytes()));
		assert_eq!(
			&body[prefix.len()..body.len() - suffix.len()],
			bytes.as_slice()
		);
	}

	#[test]
	fn album_multipart_boundary_never_occurs_in_file_bytes() {
		let bytes = b"open-grind-album-7-0";
		let (boundary, _) = album_multipart_body(7, "image/png", bytes);
		assert_eq!(boundary, "open-grind-album-7-1");
	}
}
