use crate::error::AppError;

pub struct AppState;

impl AppState {
	pub fn client(&self) -> Result<&grindr::GrindrClient, AppError> {
		Ok(self.runtime()?.client())
	}

	pub fn runtime(
		&self,
	) -> Result<&'static crate::api::runtime::ApiRuntime, AppError> {
		crate::api::runtime::ApiRuntime::get().ok_or(AppError::NotInitialized)
	}
}
