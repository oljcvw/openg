use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::time::Instant;

use super::runtime::{retry_policy, RuntimeError};
use crate::error::AppError;
use crate::state::AppState;

#[derive(Serialize, Deserialize)]
pub struct RawResponse {
	pub status: u16,
	#[serde(with = "serde_bytes")]
	pub body: Vec<u8>,
}

#[derive(Deserialize)]
struct RequestPayload {
	method: String,
	path: String,
	#[serde(with = "serde_bytes")]
	#[serde(default)]
	body: Option<Vec<u8>>,
}

static NEXT_REQUEST_ID: AtomicU64 = AtomicU64::new(1);
static ACTIVE_FOREGROUND_REQUESTS: AtomicUsize = AtomicUsize::new(0);

struct ActiveRequest;

impl ActiveRequest {
	fn begin() -> (Self, usize) {
		let active =
			ACTIVE_FOREGROUND_REQUESTS.fetch_add(1, Ordering::Relaxed) + 1;
		(Self, active)
	}
}

impl Drop for ActiveRequest {
	fn drop(&mut self) {
		ACTIVE_FOREGROUND_REQUESTS.fetch_sub(1, Ordering::Relaxed);
	}
}

pub fn active_foreground_requests() -> usize {
	ACTIVE_FOREGROUND_REQUESTS.load(Ordering::Relaxed)
}

fn diagnostic_segment(segment: &str) -> &str {
	let looks_like_uuid = segment.len() == 36
		&& segment.bytes().enumerate().all(|(index, byte)| {
			matches!(index, 8 | 13 | 18 | 23) && byte == b'-'
				|| !matches!(index, 8 | 13 | 18 | 23)
					&& byte.is_ascii_hexdigit()
		});
	let safe_name = segment.len() <= 32
		&& segment.bytes().all(|byte| {
			byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-')
		});
	if segment.is_empty()
		|| safe_name && !segment.bytes().all(|byte| byte.is_ascii_digit())
	{
		if looks_like_uuid {
			"<id>"
		} else {
			segment
		}
	} else {
		"<id>"
	}
}

fn diagnostic_route(path: &str) -> String {
	let (raw_path, raw_query) = path.split_once('?').unwrap_or((path, ""));
	let mut route = raw_path
		.split('/')
		.map(diagnostic_segment)
		.collect::<Vec<_>>()
		.join("/");
	let mut query_keys = raw_query
		.split('&')
		.map(|part| part.split_once('=').map_or(part, |(key, _)| key))
		.filter(|key| {
			!key.is_empty()
				&& key.len() <= 32
				&& key.bytes().all(|byte| {
					byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-')
				})
		})
		.collect::<Vec<_>>();
	query_keys.sort_unstable();
	query_keys.dedup();
	if !query_keys.is_empty() {
		route.push('?');
		route.push_str(&query_keys.join("&"));
	}
	route
}

fn error_kind(error: &AppError) -> &'static str {
	match error {
		AppError::Http(_) => "http",
		AppError::Auth(_) => "auth",
		AppError::Api { .. } => "api",
		AppError::Unauthorized { .. } => "unauthorized",
		AppError::Banned(_) => "banned",
		AppError::RateLimited => "rate_limited",
		AppError::RequestBlocked => "request_blocked",
		AppError::RequestCooldown { .. } => "request_cooldown",
		AppError::NotInitialized => "not_initialized",
	}
}

#[tauri::command]
pub async fn request(
	state: tauri::State<'_, AppState>,
	payload: String,
) -> Result<String, AppError> {
	let bytes = STANDARD.decode(&payload).map_err(|e| {
		AppError::Http(format!("Failed to decode base64 payload: {e}"))
	})?;

	let payload: RequestPayload =
		rmp_serde::from_slice(&bytes).map_err(|e| {
			AppError::Http(format!("Failed to decode request payload: {e}"))
		})?;
	let request_id = NEXT_REQUEST_ID.fetch_add(1, Ordering::Relaxed);
	let route = diagnostic_route(&payload.path);
	let body_bytes = payload.body.as_ref().map_or(0, Vec::len);
	let (_active_request, active_requests) = ActiveRequest::begin();
	let started = Instant::now();
	tracing::info!(
		request_id,
		method = payload.method,
		route,
		body_bytes,
		active_requests,
		"[api-request] start"
	);

	let method = grindr::Method::from_str(&payload.method).map_err(|_| {
		AppError::Api {
			code: 400,
			message: format!("Invalid method: {}", payload.method),
		}
	})?;

	let json_body: Option<serde_json::Value> = match payload.body {
		Some(b) => Some(
			rmp_serde::from_slice::<serde_json::Value>(&b).map_err(|e| {
				AppError::Http(format!("Failed to decode msgpack body: {e}"))
			})?,
		),
		None => None,
	};

	let policy = retry_policy(&method, &payload.path);
	let runtime = state.runtime()?;
	let client = runtime.client().clone();
	let request_method = method.clone();
	let request_path = payload.path.clone();
	let request_body = json_body.clone();
	let raw = match runtime
		.request(policy, move || {
			let client = client.clone();
			let method = request_method.clone();
			let path = request_path.clone();
			let body = request_body.clone();
			async move {
				client.request_authenticated_raw(method, &path, body).await
			}
		})
		.await
	{
		Ok(raw) => raw,
		Err(error) => {
			let error = match error {
				RuntimeError::Grindr(error) => AppError::from(error),
				RuntimeError::Cooldown { retry_at_ms } => {
					AppError::RequestCooldown { retry_at_ms }
				}
			};
			tracing::warn!(
				request_id,
				method = payload.method,
				route,
				elapsed_ms = started.elapsed().as_millis() as u64,
				active_requests,
				error_kind = error_kind(&error),
				"[api-request] failed"
			);
			return Err(error);
		}
	};
	let elapsed_ms = started.elapsed().as_millis() as u64;
	if raw.status >= 400 {
		tracing::warn!(
			request_id,
			method = payload.method,
			route,
			status = raw.status,
			response_bytes = raw.body.len(),
			elapsed_ms,
			active_requests,
			"[api-request] response_error"
		);
	} else {
		tracing::info!(
			request_id,
			method = payload.method,
			route,
			status = raw.status,
			response_bytes = raw.body.len(),
			elapsed_ms,
			active_requests,
			"[api-request] complete"
		);
	}

	let response = RawResponse {
		status: raw.status,
		body: raw.body,
	};
	let response_bytes = rmp_serde::encode::to_vec_named(&response)
		.map_err(|e| AppError::Http(e.to_string()))?;

	Ok(STANDARD.encode(&response_bytes))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn diagnostic_routes_remove_identifiers_and_query_values() {
		assert_eq!(
			diagnostic_route(
				"/v5/chat/conversation/4cc8e8e3-3f67-4aa2-838c-d853aed499ef/message?pageKey=secret&profile=true"
			),
			"/v5/chat/conversation/<id>/message?pageKey&profile"
		);
		assert_eq!(
			diagnostic_route("/v7/profiles/123456?nearbyGeoHash=gc7x"),
			"/v7/profiles/<id>?nearbyGeoHash"
		);
	}

	#[test]
	fn diagnostic_routes_preserve_only_safe_structure() {
		assert_eq!(diagnostic_route("/v4/inbox?page=1"), "/v4/inbox?page");
		assert_eq!(
			diagnostic_route("/v4/chat/message/send"),
			"/v4/chat/message/send"
		);
	}
}
