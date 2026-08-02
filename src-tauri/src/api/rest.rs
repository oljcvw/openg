use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use super::runtime::{request_class, retry_policy, RuntimeError};
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
	#[serde(rename = "requestId")]
	request_id: String,
	method: String,
	path: String,
	#[serde(with = "serde_bytes")]
	#[serde(default)]
	body: Option<Vec<u8>>,
}

static NEXT_REQUEST_ID: AtomicU64 = AtomicU64::new(1);
static ACTIVE_FOREGROUND_REQUESTS: AtomicUsize = AtomicUsize::new(0);
static REQUEST_CANCELLATIONS: OnceLock<RequestCancellations> = OnceLock::new();
const CANCELLATION_TOMBSTONE_TTL: Duration = Duration::from_secs(60);
const MAX_CANCELLATION_TOMBSTONES: usize = 256;

#[derive(Default)]
struct RequestCancellations {
	state: Mutex<RequestCancellationState>,
}

#[derive(Default)]
struct RequestCancellationState {
	active: HashMap<String, CancellationToken>,
	tombstones: HashMap<String, Instant>,
}

impl RequestCancellations {
	async fn register(
		&self,
		request_id: &str,
	) -> Result<CancellationToken, AppError> {
		if !valid_request_id(request_id) {
			return Err(AppError::Http(
				"Invalid request identifier".to_owned(),
			));
		}
		let token = CancellationToken::new();
		let mut state = self.state.lock().await;
		if state.active.contains_key(request_id) {
			return Err(AppError::Http(
				"Duplicate request identifier".to_owned(),
			));
		}
		let now = Instant::now();
		state.tombstones.retain(|_, created| {
			now.duration_since(*created) <= CANCELLATION_TOMBSTONE_TTL
		});
		if state.tombstones.remove(request_id).is_some() {
			token.cancel();
		}
		state.active.insert(request_id.to_owned(), token.clone());
		Ok(token)
	}

	async fn finish(&self, request_id: &str) {
		self.state.lock().await.active.remove(request_id);
	}

	async fn cancel(&self, request_id: &str) -> bool {
		if !valid_request_id(request_id) {
			return false;
		}
		let mut state = self.state.lock().await;
		if let Some(token) = state.active.get(request_id).cloned() {
			token.cancel();
			return true;
		}
		let now = Instant::now();
		state.tombstones.retain(|_, created| {
			now.duration_since(*created) <= CANCELLATION_TOMBSTONE_TTL
		});
		if state.tombstones.len() >= MAX_CANCELLATION_TOMBSTONES {
			if let Some(oldest) = state
				.tombstones
				.iter()
				.min_by_key(|(_, created)| **created)
				.map(|(request_id, _)| request_id.clone())
			{
				state.tombstones.remove(&oldest);
			}
		}
		state.tombstones.insert(request_id.to_owned(), now);
		true
	}
}

fn request_cancellations() -> &'static RequestCancellations {
	REQUEST_CANCELLATIONS.get_or_init(RequestCancellations::default)
}

fn valid_request_id(request_id: &str) -> bool {
	!request_id.is_empty()
		&& request_id.len() <= 64
		&& request_id
			.bytes()
			.all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
}

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
	if segment.is_empty()
		|| segment.strip_prefix('v').is_some_and(|version| {
			!version.is_empty()
				&& version.bytes().all(|byte| byte.is_ascii_digit())
		}) || matches!(
		segment,
		"albums"
			| "blocks"
			| "cascade"
			| "chat" | "content"
			| "conversation"
			| "delete"
			| "drawer"
			| "email" | "favorites"
			| "feed" | "hides"
			| "images"
			| "inbox" | "list"
			| "location"
			| "me" | "media"
			| "message"
			| "order" | "password-validation"
			| "places"
			| "prefs" | "profile"
			| "profiles"
			| "pronouns"
			| "reaction"
			| "read" | "received"
			| "rightnow"
			| "search"
			| "send" | "sessions"
			| "settings"
			| "shares"
			| "storage"
			| "tags" | "taps"
			| "unshares"
			| "unsend"
			| "update-password"
			| "users" | "views"
	) {
		segment
	} else {
		"<segment>"
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
			matches!(
				*key,
				"hosting"
					| "nearbyGeoHash"
					| "page" | "pageKey"
					| "pageNumber" | "profile"
					| "sexualPositions"
					| "sort"
			)
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
		AppError::RequestCancelled => "request_cancelled",
		AppError::NotInitialized => "not_initialized",
	}
}

#[tauri::command]
pub async fn cancel_request(request_id: String) -> bool {
	let cancelled = request_cancellations().cancel(&request_id).await;
	tracing::info!(cancelled, "[api-request] cancel_requested");
	cancelled
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
	let cancellation = request_cancellations()
		.register(&payload.request_id)
		.await?;
	let request_id = payload.request_id.clone();
	let result = request_registered(state, payload, cancellation).await;
	request_cancellations().finish(&request_id).await;
	result
}

async fn request_registered(
	state: tauri::State<'_, AppState>,
	payload: RequestPayload,
	cancellation: CancellationToken,
) -> Result<String, AppError> {
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
	let class = request_class(&method, &payload.path);
	let runtime = state.runtime()?;
	let client = runtime.client().clone();
	let request_method = method.clone();
	let request_path = payload.path.clone();
	let request_body = json_body.clone();
	let raw = match runtime
		.request_raw_classified_cancellable(
			policy,
			class,
			&route,
			cancellation,
			move || {
				let client = client.clone();
				let method = request_method.clone();
				let path = request_path.clone();
				let body = request_body.clone();
				async move {
					client.request_authenticated_raw(method, &path, body).await
				}
			},
		)
		.await
	{
		Ok(raw) => raw,
		Err(error) => {
			let error = match error {
				RuntimeError::Grindr(error) => AppError::from(error),
				RuntimeError::Cooldown { retry_at_ms } => {
					AppError::RequestCooldown { retry_at_ms }
				}
				RuntimeError::Cancelled => AppError::RequestCancelled,
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
			"/v5/chat/conversation/<segment>/message?pageKey&profile"
		);
		assert_eq!(
			diagnostic_route("/v7/profiles/123456?nearbyGeoHash=gc7x"),
			"/v7/profiles/<segment>?nearbyGeoHash"
		);
		assert_eq!(diagnostic_route("/v4/inbox?secretKey=value"), "/v4/inbox");
	}

	#[test]
	fn diagnostic_routes_preserve_only_safe_structure() {
		assert_eq!(diagnostic_route("/v4/inbox?page=1"), "/v4/inbox?page");
		assert_eq!(
			diagnostic_route("/v4/chat/message/send"),
			"/v4/chat/message/send"
		);
		assert_eq!(
			diagnostic_route("/v1/profile/privateTokenABC"),
			"/v1/profile/<segment>"
		);
		assert_eq!(
			diagnostic_route("/lookup/andrewcox"),
			"/<segment>/<segment>"
		);
		assert_eq!(
			diagnostic_route("/redirect/sessionSecret"),
			"/<segment>/<segment>"
		);
		assert_eq!(
			diagnostic_route("/users/name%40example.com"),
			"/users/<segment>"
		);
	}

	#[test]
	fn request_identifiers_are_opaque_and_bounded() {
		assert!(valid_request_id("4cc8e8e3-3f67-4aa2-838c-d853aed499ef"));
		assert!(valid_request_id("0123456789abcdef"));
		assert!(!valid_request_id(""));
		assert!(!valid_request_id("not_an_id"));
		assert!(!valid_request_id(&"a".repeat(65)));
	}

	#[tokio::test]
	async fn cancellation_before_registration_is_retained_once() {
		let cancellations = RequestCancellations::default();
		let request_id = "4cc8e8e3-3f67-4aa2-838c-d853aed499ef";
		assert!(cancellations.cancel(request_id).await);
		let token = cancellations.register(request_id).await.expect("register");
		assert!(token.is_cancelled());
		cancellations.finish(request_id).await;
		let next = cancellations
			.register(request_id)
			.await
			.expect("register again");
		assert!(!next.is_cancelled());
	}

	#[tokio::test]
	async fn concurrent_cancellation_and_registration_never_loses_cancellation()
	{
		let cancellations =
			std::sync::Arc::new(RequestCancellations::default());
		let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(3));
		let request_id = "65aaf746-c7e8-4b5a-8b85-e2d4434f3fef";

		let register = {
			let cancellations = cancellations.clone();
			let barrier = barrier.clone();
			tokio::spawn(async move {
				barrier.wait().await;
				cancellations.register(request_id).await.expect("register")
			})
		};
		let cancel = {
			let cancellations = cancellations.clone();
			let barrier = barrier.clone();
			tokio::spawn(async move {
				barrier.wait().await;
				cancellations.cancel(request_id).await
			})
		};

		barrier.wait().await;
		let token = register.await.expect("register task");
		assert!(cancel.await.expect("cancel task"));
		assert!(token.is_cancelled());
	}
}
