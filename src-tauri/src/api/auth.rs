use serde::{Deserialize, Serialize};

use super::client::GrindrClient;
use super::client::BASE_URL;
use super::error::ApiError;

#[derive(Debug, Clone)]
pub struct Session {
    pub email: String,
    pub expires_at: u64,
    pub profile_id: String,
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionResponse {
    pub profile_id: String,
    pub session_id: String,
    pub auth_token: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
    pub token: Option<String>,
    pub geohash: Option<String>,
}

trait AuthRequest: Serialize {
    fn email(&self) -> &str;
}

impl AuthRequest for LoginRequest {
    fn email(&self) -> &str {
        &self.email
    }
}

impl AuthRequest for RefreshRequest {
    fn email(&self) -> &str {
        &self.email
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshRequest {
    pub email: String,
    pub auth_token: String,
    pub token: Option<String>,
    pub geohash: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LoginResult {
    pub profile_id: String,
}

#[derive(Debug, Deserialize)]
struct JwtClaims {
    exp: u64,
}

impl LoginRequest {
    pub fn new(email: String, password: String) -> Self {
        Self {
            email,
            password,
            token: None,
            geohash: None,
        }
    }
}

impl RefreshRequest {
    pub fn new(email: String, auth_token: String) -> Self {
        Self {
            email,
            auth_token,
            token: None,
            geohash: None,
        }
    }
}

fn decode_session_jwt(token: &str) -> Result<JwtClaims, ApiError> {
    let data = jsonwebtoken::dangerous::insecure_decode::<JwtClaims>(token)
        .map_err(|e| ApiError::Auth(format!("JWT decode failed: {e}")))?;

    Ok(data.claims)
}

impl GrindrClient {
    async fn create_session(&self, body: &impl AuthRequest) -> Result<Session, ApiError> {
        let resp = self
            .http
            .post(format!("{BASE_URL}/v8/sessions"))
            .json(body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(ApiError::Auth(text));
        }

        let session_resp: SessionResponse = resp.json().await?;
        let claims = decode_session_jwt(&session_resp.session_id)?;

        let session = Session {
            email: body.email().to_owned(),
            profile_id: session_resp.profile_id.clone(),
            session_id: session_resp.session_id,
            expires_at: claims.exp,
        };

        Ok(session)
    }

    pub async fn login(&self, email: &str, password: &str) -> Result<LoginResult, ApiError> {
        let body = LoginRequest::new(email.to_owned(), password.to_owned());
        let session = self.create_session(&body).await?;
        let profile_id = session.profile_id.clone();

        *self.session.write().await = Some(session);

        Ok(LoginResult { profile_id })
    }

    pub async fn refresh_token(&self) -> Result<LoginResult, ApiError> {
        let current = self.session.read().await;
        let session = current
            .as_ref()
            .ok_or_else(|| ApiError::Auth("Not logged in".to_owned()))?;

        let body = RefreshRequest::new(session.email.clone(), session.session_id.clone());

        drop(current);

        let session = self.create_session(&body).await?;
        let profile_id = session.profile_id.clone();
        *self.session.write().await = Some(session);

        Ok(LoginResult { profile_id })
    }

    pub async fn authorization_header(&self) -> Option<String> {
        self.session
            .read()
            .await
            .as_ref()
            .map(|s| format!("Grindr3 {}", s.session_id))
    }
}

#[tauri::command]
pub async fn login(
    client: tauri::State<'_, GrindrClient>,
    email: String,
    password: String,
) -> Result<LoginResult, String> {
    client
        .login(&email, &password)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn refresh_token(client: tauri::State<'_, GrindrClient>) -> Result<LoginResult, String> {
    client.refresh_token().await.map_err(|e| e.to_string())
}
