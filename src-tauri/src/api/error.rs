use std::fmt;

#[derive(Debug)]
pub enum ApiError {
	Http(reqwest::Error),
	Auth(String),
	Api {
		code: i32,
		message: String,
	},
}

impl fmt::Display for ApiError {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		match self {
			ApiError::Http(e) => write!(f, "HTTP error: {e}"),
			ApiError::Auth(msg) => write!(f, "Auth error: {msg}"),
			ApiError::Api { code, message } => write!(f, "API error {code}: {message}"),
		}
	}
}

impl std::error::Error for ApiError {}

impl From<reqwest::Error> for ApiError {
	fn from(e: reqwest::Error) -> Self {
		ApiError::Http(e)
	}
}

impl From<ApiError> for String {
	fn from(e: ApiError) -> Self {
		e.to_string()
	}
}
