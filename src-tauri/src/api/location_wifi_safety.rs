use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio_util::sync::CancellationToken;

use crate::error::AppError;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WifiSafetySnapshot {
	pub known: bool,
	pub connected: bool,
	pub generation: u64,
}

struct SafetyState {
	wifi: WifiSafetySnapshot,
	manual_location_active: bool,
	recovery_hold: bool,
	blocked: bool,
	cancellation: CancellationToken,
	network_change_cancellation: CancellationToken,
	app: Option<AppHandle>,
}

impl Default for SafetyState {
	fn default() -> Self {
		let known = !cfg!(mobile);
		Self {
			wifi: WifiSafetySnapshot {
				known,
				connected: false,
				generation: 0,
			},
			manual_location_active: false,
			recovery_hold: false,
			blocked: false,
			cancellation: CancellationToken::new(),
			network_change_cancellation: CancellationToken::new(),
			app: None,
		}
	}
}

static SAFETY_STATE: OnceLock<Mutex<SafetyState>> = OnceLock::new();

fn state() -> &'static Mutex<SafetyState> {
	SAFETY_STATE.get_or_init(|| Mutex::new(SafetyState::default()))
}

fn should_block(state: &SafetyState) -> bool {
	state.manual_location_active
		&& (!state.wifi.known || state.wifi.connected || state.recovery_hold)
}

fn apply_block_state(state: &mut SafetyState) -> (bool, bool) {
	let blocked = should_block(state);
	if state.blocked == blocked {
		return (false, blocked);
	}
	state.blocked = blocked;
	if blocked {
		state.cancellation.cancel();
	} else {
		state.cancellation = CancellationToken::new();
	}
	(true, blocked)
}

pub fn install(app: AppHandle) {
	let mut state = state()
		.lock()
		.unwrap_or_else(|poisoned| poisoned.into_inner());
	state.app = Some(app);
}

pub fn set_wifi_state(known: bool, connected: bool) {
	let (snapshot, app, block_changed, blocked) = {
		let mut state = state()
			.lock()
			.unwrap_or_else(|poisoned| poisoned.into_inner());
		let connected = known && connected;
		if state.wifi.known == known && state.wifi.connected == connected {
			return;
		}
		state.wifi = WifiSafetySnapshot {
			known,
			connected,
			generation: state.wifi.generation.saturating_add(1),
		};
		state.network_change_cancellation.cancel();
		state.network_change_cancellation = CancellationToken::new();
		if state.manual_location_active && (!known || connected) {
			state.recovery_hold = true;
		}
		let (block_changed, blocked) = apply_block_state(&mut state);
		(state.wifi, state.app.clone(), block_changed, blocked)
	};

	crate::api::ws::set_location_wifi_safety_allowed(!blocked);
	if let Some(app) = app {
		app.emit("wifi-state-changed", snapshot).ok();
		if block_changed {
			app.emit("location-wifi-safety-changed", blocked).ok();
		}
	}
}

pub fn set_manual_location_active(active: bool, recovery_pending: bool) {
	let (app, changed, blocked) = {
		let mut state = state()
			.lock()
			.unwrap_or_else(|poisoned| poisoned.into_inner());
		state.manual_location_active = active;
		if !active {
			state.recovery_hold = false;
		} else if recovery_pending || !state.wifi.known || state.wifi.connected
		{
			state.recovery_hold = true;
		}
		let (changed, blocked) = apply_block_state(&mut state);
		(state.app.clone(), changed, blocked)
	};
	crate::api::ws::set_location_wifi_safety_allowed(!blocked);
	if changed {
		if let Some(app) = app {
			app.emit("location-wifi-safety-changed", blocked).ok();
		}
	}
}

pub fn release_recovery_hold() -> Result<(), AppError> {
	let (app, changed, blocked) = {
		let mut state = state()
			.lock()
			.unwrap_or_else(|poisoned| poisoned.into_inner());
		if !state.wifi.known || state.wifi.connected {
			return Err(AppError::LocationWifiSafetyBlocked);
		}
		state.recovery_hold = false;
		let (changed, blocked) = apply_block_state(&mut state);
		(state.app.clone(), changed, blocked)
	};
	crate::api::ws::set_location_wifi_safety_allowed(!blocked);
	if changed {
		if let Some(app) = app {
			app.emit("location-wifi-safety-changed", blocked).ok();
		}
	}
	Ok(())
}

pub fn snapshot() -> WifiSafetySnapshot {
	state()
		.lock()
		.unwrap_or_else(|poisoned| poisoned.into_inner())
		.wifi
}

fn recovery_location_allowed(state: &SafetyState, route: &str) -> bool {
	route == "/v4/location" && state.wifi.known && !state.wifi.connected
}

pub fn assert_grindr_traffic_allowed_for(route: &str) -> Result<(), AppError> {
	let state = state()
		.lock()
		.unwrap_or_else(|poisoned| poisoned.into_inner());
	if state.blocked && !recovery_location_allowed(&state, route) {
		Err(AppError::LocationWifiSafetyBlocked)
	} else {
		Ok(())
	}
}

pub fn traffic_cancellation_token_for(route: &str) -> CancellationToken {
	let state = state()
		.lock()
		.unwrap_or_else(|poisoned| poisoned.into_inner());
	if recovery_location_allowed(&state, route) {
		state.network_change_cancellation.child_token()
	} else {
		state.cancellation.child_token()
	}
}

#[tauri::command]
pub fn wifi_connection_status() -> WifiSafetySnapshot {
	snapshot()
}

#[tauri::command]
pub fn location_wifi_safety_set_active(active: bool, recovery_pending: bool) {
	set_manual_location_active(active, recovery_pending);
}

#[tauri::command]
pub fn location_wifi_safety_release_recovery() -> Result<(), AppError> {
	release_recovery_hold()
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn active_manual_location_fails_closed_for_unknown_and_wifi() {
		let mut state = SafetyState {
			manual_location_active: true,
			..SafetyState::default()
		};
		state.wifi.known = false;
		assert!(should_block(&state));
		state.wifi = WifiSafetySnapshot {
			known: true,
			connected: true,
			generation: 1,
		};
		assert!(should_block(&state));
		state.wifi.connected = false;
		assert!(!should_block(&state));
		state.manual_location_active = false;
		state.wifi.known = false;
		assert!(!should_block(&state));
	}

	#[test]
	fn repeated_block_application_remains_blocked() {
		let mut state = SafetyState {
			wifi: WifiSafetySnapshot {
				known: false,
				connected: false,
				generation: 0,
			},
			manual_location_active: true,
			..SafetyState::default()
		};
		let (changed, blocked) = apply_block_state(&mut state);
		assert!(changed);
		assert!(blocked);
		let (changed, blocked) = apply_block_state(&mut state);
		assert!(!changed);
		assert!(blocked);
		assert!(state.cancellation.is_cancelled());
	}

	#[test]
	fn recovery_hold_only_admits_location_reconciliation_on_safe_network() {
		let mut state = SafetyState {
			manual_location_active: true,
			recovery_hold: true,
			wifi: WifiSafetySnapshot {
				known: true,
				connected: false,
				generation: 4,
			},
			..SafetyState::default()
		};
		let (_, blocked) = apply_block_state(&mut state);
		assert!(blocked);
		assert!(recovery_location_allowed(&state, "/v4/location"));
		assert!(!recovery_location_allowed(&state, "/v4/cascade"));
		state.wifi.connected = true;
		assert!(!recovery_location_allowed(&state, "/v4/location"));
	}
}
