use serde::Serialize;
use serde_json::Value;

use crate::error::AppError;
use crate::state::AppState;
use crate::storage::{
	account_storage_lock, AuthStorage, DeviceStorage, SigningKeyStorage,
};

const MAX_SECRET_LENGTH: usize = 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ValidatePasswordComplexityRequest<'a> {
	password: &'a str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChangePasswordRequest<'a> {
	current_password: &'a str,
	new_password: &'a str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateEmailRequest<'a> {
	email: &'a str,
	password: &'a str,
}

fn safe_account_error(error: grindr::GrindrError) -> AppError {
	match error {
		grindr::GrindrError::Unauthorized { code, .. } => {
			AppError::Unauthorized {
				code,
				message: "Your session expired. Sign in and try again."
					.to_owned(),
			}
		}
		grindr::GrindrError::Api { code, .. } => AppError::Api {
			code,
			message: "The account change was rejected.".to_owned(),
		},
		grindr::GrindrError::RateLimited => AppError::RateLimited,
		grindr::GrindrError::Blocked => AppError::RequestBlocked,
		_ => AppError::Http("The account service is unavailable.".to_owned()),
	}
}

fn validate_secret(value: &str, minimum: usize) -> Result<(), AppError> {
	if value.len() < minimum || value.len() > MAX_SECRET_LENGTH {
		return Err(AppError::Api {
			code: 400,
			message: "The password does not meet the length requirements."
				.to_owned(),
		});
	}
	Ok(())
}

fn validate_email(email: &str) -> Result<(), AppError> {
	let email = email.trim();
	if email.len() > 254
		|| !email.split_once('@').is_some_and(|(local, domain)| {
			!local.is_empty()
				&& domain.contains('.')
				&& !domain.starts_with('.')
				&& !domain.ends_with('.')
		}) {
		return Err(AppError::Api {
			code: 400,
			message: "Enter a valid email address.".to_owned(),
		});
	}
	Ok(())
}

async fn account_request(
	client: &grindr::GrindrClient,
	method: grindr::Method,
	path: &str,
	body: Option<Value>,
) -> Result<(), AppError> {
	let response = client
		.request_authenticated_raw(method, path, body)
		.await
		.map_err(safe_account_error)?;
	if (200..300).contains(&response.status) {
		return Ok(());
	}
	Err(safe_account_error(grindr::GrindrError::from_response(
		response.status,
		&response.body,
	)))
}

async fn purge_account_state(
	client: &grindr::GrindrClient,
) -> Result<(), AppError> {
	let _storage_guard = account_storage_lock().lock().await;
	AuthStorage::delete_session();
	SigningKeyStorage::delete();

	let new_device = grindr::DeviceInfo::generate();
	DeviceStorage::save(&new_device).map_err(|_| {
		AppError::Auth("Could not secure the next sign-in.".to_owned())
	})?;
	client
		.sign_out_rotating(new_device)
		.await
		.map_err(safe_account_error)?;
	Ok(())
}

#[tauri::command]
pub async fn validate_password_complexity(
	state: tauri::State<'_, AppState>,
	password: String,
) -> Result<(), AppError> {
	validate_secret(&password, 8)?;
	let body = serde_json::to_value(ValidatePasswordComplexityRequest {
		password: &password,
	})
	.map_err(|_| {
		AppError::Http("Could not prepare account request.".to_owned())
	})?;
	account_request(
		state.client()?,
		grindr::Method::POST,
		"/v3/users/password-validation",
		Some(body),
	)
	.await
}

#[tauri::command]
pub async fn update_account_password(
	state: tauri::State<'_, AppState>,
	current_password: String,
	new_password: String,
) -> Result<(), AppError> {
	validate_secret(&current_password, 1)?;
	validate_secret(&new_password, 8)?;
	if current_password == new_password {
		return Err(AppError::Api {
			code: 400,
			message: "Choose a password you are not already using.".to_owned(),
		});
	}
	let body = serde_json::to_value(ChangePasswordRequest {
		current_password: &current_password,
		new_password: &new_password,
	})
	.map_err(|_| {
		AppError::Http("Could not prepare account request.".to_owned())
	})?;
	let client = state.client()?;
	account_request(
		client,
		grindr::Method::POST,
		"/v3/users/update-password",
		Some(body),
	)
	.await?;
	purge_account_state(client).await
}

#[tauri::command]
pub async fn update_account_email(
	state: tauri::State<'_, AppState>,
	email: String,
	password: String,
) -> Result<(), AppError> {
	validate_email(&email)?;
	validate_secret(&password, 1)?;
	let normalized_email = email.trim().to_lowercase();
	let body = serde_json::to_value(UpdateEmailRequest {
		email: &normalized_email,
		password: &password,
	})
	.map_err(|_| {
		AppError::Http("Could not prepare account request.".to_owned())
	})?;
	let client = state.client()?;
	account_request(
		client,
		grindr::Method::POST,
		"/v3/users/email",
		Some(body),
	)
	.await?;
	purge_account_state(client).await
}

#[tauri::command]
pub async fn delete_account(
	state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
	let client = state.client()?;
	account_request(client, grindr::Method::DELETE, "/v3/me/profile", None)
		.await?;
	purge_account_state(client).await
}

#[cfg(test)]
mod tests {
	use super::*;
	use serde_json::json;

	#[test]
	fn credential_payloads_match_the_audited_contract() {
		let password = serde_json::to_value(ChangePasswordRequest {
			current_password: "old",
			new_password: "new",
		})
		.unwrap();
		assert_eq!(
			password,
			json!({"currentPassword": "old", "newPassword": "new"})
		);

		let email = serde_json::to_value(UpdateEmailRequest {
			email: "person@example.com",
			password: "secret",
		})
		.unwrap();
		assert_eq!(
			email,
			json!({"email": "person@example.com", "password": "secret"})
		);
	}

	#[test]
	fn validation_rejects_malformed_values_without_echoing_them() {
		assert!(validate_email("not-an-email").is_err());
		assert!(validate_secret("short", 8).is_err());
		let error = validate_secret("private", 8).unwrap_err().to_string();
		assert!(!error.contains("private"));
	}

	#[test]
	fn server_errors_are_redacted() {
		let error = safe_account_error(grindr::GrindrError::Api {
			code: 422,
			message: "echoed-password".to_owned(),
		});
		assert!(!error.to_string().contains("echoed-password"));
	}
}
