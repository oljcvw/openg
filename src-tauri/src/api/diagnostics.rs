use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

use serde::Deserialize;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MediaElementKind {
	Image,
	Video,
	Audio,
}

impl MediaElementKind {
	fn as_str(self) -> &'static str {
		match self {
			Self::Image => "image",
			Self::Video => "video",
			Self::Audio => "audio",
		}
	}
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MediaLoadOutcome {
	Loaded,
	Failed,
}

impl MediaLoadOutcome {
	fn as_str(self) -> &'static str {
		match self {
			Self::Loaded => "loaded",
			Self::Failed => "failed",
		}
	}
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MediaSurface {
	Albums,
	Browse,
	Chat,
	Profile,
	RightNow,
	Other,
}

impl MediaSurface {
	fn as_str(self) -> &'static str {
		match self {
			Self::Albums => "albums",
			Self::Browse => "browse",
			Self::Chat => "chat",
			Self::Profile => "profile",
			Self::RightNow => "right_now",
			Self::Other => "other",
		}
	}
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaOriginObservation {
	origin: String,
	element_kind: MediaElementKind,
	outcome: MediaLoadOutcome,
	surface: MediaSurface,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClientDiagnosticLevel {
	Info,
	Warning,
	Error,
}

impl ClientDiagnosticLevel {
	fn as_str(self) -> &'static str {
		match self {
			Self::Info => "info",
			Self::Warning => "warning",
			Self::Error => "error",
		}
	}
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientDiagnostic {
	category: String,
	component: String,
	code: String,
	level: ClientDiagnosticLevel,
}

#[derive(Eq, Hash, PartialEq)]
struct MediaOriginKey {
	origin: String,
	element_kind: MediaElementKind,
	outcome: MediaLoadOutcome,
	surface: MediaSurface,
}

fn record_media_origin(
	reported: &mut HashSet<MediaOriginKey>,
	key: MediaOriginKey,
) -> bool {
	reported.insert(key)
}

static REPORTED_MEDIA_ORIGINS: OnceLock<Mutex<HashSet<MediaOriginKey>>> =
	OnceLock::new();

fn canonical_https_origin(value: &str) -> Option<String> {
	let url = tauri::Url::parse(value).ok()?;
	if url.scheme() != "https"
		|| !url.username().is_empty()
		|| url.password().is_some()
		|| url.path() != "/"
		|| url.query().is_some()
		|| url.fragment().is_some()
	{
		return None;
	}
	let origin = url.origin().ascii_serialization();
	(value == origin).then_some(origin)
}

/// Logs one privacy-safe record per unique remote-media origin, surface,
/// element kind, and result for the current process.
///
/// Callers can send an origin only. Paths, signed query parameters, fragments,
/// credentials, application IDs, and media content are rejected.
#[tauri::command]
pub fn report_media_origin(observation: MediaOriginObservation) {
	let Some(origin) = canonical_https_origin(&observation.origin) else {
		tracing::warn!("[media-origin] rejected_non_origin_value");
		return;
	};
	let key = MediaOriginKey {
		origin: origin.clone(),
		element_kind: observation.element_kind,
		outcome: observation.outcome,
		surface: observation.surface,
	};
	let mut reported = REPORTED_MEDIA_ORIGINS
		.get_or_init(|| Mutex::new(HashSet::new()))
		.lock()
		.unwrap_or_else(|poisoned| poisoned.into_inner());
	if !record_media_origin(&mut reported, key) {
		return;
	}
	tracing::info!(
		origin,
		element_kind = observation.element_kind.as_str(),
		outcome = observation.outcome.as_str(),
		surface = observation.surface.as_str(),
		"[media-origin] observed"
	);
}

fn sanitized_label(value: &str) -> Option<&str> {
	(!value.is_empty()
		&& value.len() <= 48
		&& value.bytes().all(|byte| {
			byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-')
		}))
	.then_some(value)
}

/// Writes an allowlisted frontend diagnostic taxonomy to tracing/logcat.
#[tauri::command]
pub fn report_client_diagnostic(diagnostic: ClientDiagnostic) {
	let Some(category) = sanitized_label(&diagnostic.category) else {
		tracing::warn!("[client-error] rejected_invalid_category");
		return;
	};
	let Some(component) = sanitized_label(&diagnostic.component) else {
		tracing::warn!("[client-error] rejected_invalid_component");
		return;
	};
	let Some(code) = sanitized_label(&diagnostic.code) else {
		tracing::warn!("[client-error] rejected_invalid_code");
		return;
	};
	match diagnostic.level {
		ClientDiagnosticLevel::Info => tracing::info!(
			target: "open_grind_lib::api::diagnostics",
			category,
			component,
			level = diagnostic.level.as_str(),
			code,
			"[client-error] reported"
		),
		ClientDiagnosticLevel::Warning => tracing::warn!(
			target: "open_grind_lib::api::diagnostics",
			category,
			component,
			level = diagnostic.level.as_str(),
			code,
			"[client-error] reported"
		),
		ClientDiagnosticLevel::Error => tracing::error!(
			target: "open_grind_lib::api::diagnostics",
			category,
			component,
			level = diagnostic.level.as_str(),
			code,
			"[client-error] reported"
		),
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn accepts_canonical_https_origins() {
		assert_eq!(
			canonical_https_origin("https://d123.cloudfront.net").as_deref(),
			Some("https://d123.cloudfront.net")
		);
		assert_eq!(
			canonical_https_origin("https://example.com:8443").as_deref(),
			Some("https://example.com:8443")
		);
	}

	#[test]
	fn rejects_values_that_could_expose_private_url_data() {
		for value in [
			"https://user:secret@example.com",
			"https://example.com/private/id",
			"https://example.com?token=secret",
			"https://example.com#fragment",
			"http://example.com",
			"blob:https://example.com/id",
			"not a URL",
		] {
			assert_eq!(canonical_https_origin(value), None, "{value}");
		}
	}

	#[test]
	fn accepts_only_bounded_diagnostic_labels() {
		assert_eq!(sanitized_label("api_error"), Some("api_error"));
		assert_eq!(sanitized_label(""), None);
		assert_eq!(sanitized_label("api/error"), None);
		assert_eq!(sanitized_label(&"x".repeat(49)), None);
	}

	#[test]
	fn rejects_free_form_diagnostic_values() {
		for value in [
			"person@example.com",
			"/private/path",
			"token=secret",
			"a value with spaces",
			"https://example.com",
		] {
			assert_eq!(sanitized_label(value), None, "{value}");
		}
	}

	#[test]
	fn deduplicates_successful_and_failed_media_origin_observations() {
		let mut reported = HashSet::new();
		for outcome in [MediaLoadOutcome::Loaded, MediaLoadOutcome::Failed] {
			let key = || MediaOriginKey {
				origin: "https://media.example.com".to_owned(),
				element_kind: MediaElementKind::Image,
				outcome,
				surface: MediaSurface::Chat,
			};

			assert!(record_media_origin(&mut reported, key()));
			assert!(!record_media_origin(&mut reported, key()));
		}
	}
}
