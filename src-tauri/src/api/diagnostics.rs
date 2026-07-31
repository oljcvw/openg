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

#[derive(Eq, Hash, PartialEq)]
struct MediaOriginKey {
	origin: String,
	element_kind: MediaElementKind,
	outcome: MediaLoadOutcome,
	surface: MediaSurface,
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
	if !reported.insert(key) {
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
}
