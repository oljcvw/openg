use reqwest::Client;
use tokio::sync::RwLock;

use super::auth::Session;
use super::error::ApiError;
use super::headers::{ build_default_headers, DeviceInfo };

pub const BASE_URL: &str = "https://grindr.mobi";

pub struct GrindrClient {
	pub(super) http: Client,
	pub(super) session: RwLock<Option<Session>>,
}

impl GrindrClient {
	pub fn new() -> Result<Self, ApiError> {
		let device = DeviceInfo::default();
		let headers = build_default_headers(&device, "Free");

		let http = Client::builder().default_headers(headers).build()?;

		Ok(Self {
			http,
			session: RwLock::new(None),
		})
	}
}
