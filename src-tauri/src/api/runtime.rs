use std::collections::VecDeque;
use std::future::Future;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tokio::sync::{Semaphore, SemaphorePermit};
use tokio_util::sync::CancellationToken;

const MAX_CONCURRENT_REQUESTS: usize = 20;
static API_RUNTIME: OnceLock<ApiRuntime> = OnceLock::new();
static NEXT_RUNTIME_ID: AtomicU64 = AtomicU64::new(1);

use crate::error::AppError;

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiRuntimeConfig {
	api_circuit_failure_percent: usize,
	api_circuit_minimum_samples: usize,
	api_circuit_open_ms: u64,
	api_circuit_window_size: usize,
	api_protection_cooldown_ms: u64,
}

impl Default for ApiRuntimeConfig {
	fn default() -> Self {
		Self {
			api_circuit_failure_percent: 50,
			api_circuit_minimum_samples: 20,
			api_circuit_open_ms: 30_000,
			api_circuit_window_size: 50,
			api_protection_cooldown_ms: 30_000,
		}
	}
}

impl ApiRuntimeConfig {
	fn validate(self) -> Result<Self, &'static str> {
		if !(25..=50).contains(&self.api_circuit_failure_percent) {
			return Err("Circuit failure percentage must be between 25 and 50");
		}
		if !(5..=20).contains(&self.api_circuit_minimum_samples) {
			return Err("Circuit minimum samples must be between 5 and 20");
		}
		if !(20..=100).contains(&self.api_circuit_window_size) {
			return Err("Circuit window size must be between 20 and 100");
		}
		if self.api_circuit_minimum_samples > self.api_circuit_window_size {
			return Err(
				"Circuit minimum samples cannot exceed the window size",
			);
		}
		if !(30_000..=300_000).contains(&self.api_circuit_open_ms) {
			return Err(
				"Circuit pause must be between 30000 and 300000 milliseconds",
			);
		}
		if !(30_000..=300_000).contains(&self.api_protection_cooldown_ms) {
			return Err("Protection cooldown must be between 30000 and 300000 milliseconds");
		}
		Ok(self)
	}
}

#[derive(Clone)]
pub struct ApiRuntime {
	client: grindr::GrindrClient,
	recovery: Arc<RequestRecovery>,
	id: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetryPolicy {
	SafeRead,
	NeverReplay,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RequestClass {
	BrowseCascade,
	BrowseProfileBatch,
	ForegroundRead,
	Mutation,
	BackgroundPoll,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MitigationState {
	Recovering,
	Cooldown,
	Probing,
	Recovered,
	Healthy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MitigationReason {
	Circuit,
	Protection,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiMitigationEvent {
	pub sequence: u64,
	pub phase: MitigationState,
	pub reason: MitigationReason,
	pub request_class: RequestClass,
	pub route: String,
	pub attempt: usize,
	pub retry_at_ms: Option<u64>,
	pub cooldown_level: usize,
	pub active_requests: usize,
	pub queued_requests: usize,
}

pub trait MitigationEventSink: Send + Sync {
	fn emit(&self, event: &ApiMitigationEvent);
}

impl<F> MitigationEventSink for F
where
	F: Fn(&ApiMitigationEvent) + Send + Sync,
{
	fn emit(&self, event: &ApiMitigationEvent) {
		self(event);
	}
}

#[derive(Debug)]
pub enum RuntimeError {
	Grindr(grindr::GrindrError),
	Cooldown { retry_at_ms: u64 },
	Cancelled,
	LocationWifiSafetyBlocked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CircuitOutcome {
	Success,
	Failure,
	Ignored,
	ProtectionBlocked,
}

#[derive(Default)]
struct CircuitState {
	outcomes: VecDeque<bool>,
	open_until: Option<Instant>,
	half_open: bool,
	global_protection_until: Option<Instant>,
	global_protection_probe: bool,
	profile_protection_until: Option<Instant>,
	profile_protection_probe: bool,
}

#[derive(Default)]
struct PriorityState {
	foreground_active: usize,
	foreground_waiting: usize,
	background_active: bool,
}

struct RequestRecovery {
	config: std::sync::RwLock<ApiRuntimeConfig>,
	state: std::sync::Mutex<CircuitState>,
	requests: Semaphore,
	browse_cascade: Semaphore,
	browse_profile_batch: Semaphore,
	background_poll: Semaphore,
	priority: std::sync::Mutex<PriorityState>,
	priority_notify: tokio::sync::Notify,
	queued_requests: AtomicUsize,
	event_sink: std::sync::RwLock<Option<Arc<dyn MitigationEventSink>>>,
	event_sequence: AtomicU64,
}

#[derive(Clone)]
struct RequestContext {
	class: RequestClass,
	route: String,
}

#[derive(Clone, Copy)]
struct Admission {
	breaker_probe: bool,
	protection_probe: Option<ProtectionScope>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProtectionScope {
	Global,
	Profile,
}

struct RequestAdmission<'a> {
	_permit: SemaphorePermit<'a>,
	admission: Admission,
}

impl ApiRuntime {
	pub fn install(client: grindr::GrindrClient) -> &'static Self {
		API_RUNTIME.get_or_init(|| Self::new(client))
	}

	pub fn get() -> Option<&'static Self> {
		API_RUNTIME.get()
	}

	pub fn get_or_try_init(
		device: grindr::DeviceInfo,
		session: Option<grindr::Session>,
	) -> Result<&'static Self, grindr::GrindrError> {
		if let Some(runtime) = Self::get() {
			return Ok(runtime);
		}
		let client = grindr::GrindrClient::new(device, session)?;
		Ok(Self::install(client))
	}

	fn new(client: grindr::GrindrClient) -> Self {
		Self {
			client,
			recovery: Arc::new(RequestRecovery {
				config: std::sync::RwLock::new(ApiRuntimeConfig::default()),
				state: std::sync::Mutex::new(CircuitState::default()),
				requests: Semaphore::new(MAX_CONCURRENT_REQUESTS),
				browse_cascade: Semaphore::new(1),
				browse_profile_batch: Semaphore::new(1),
				background_poll: Semaphore::new(1),
				priority: std::sync::Mutex::new(PriorityState::default()),
				priority_notify: tokio::sync::Notify::new(),
				queued_requests: AtomicUsize::new(0),
				event_sink: std::sync::RwLock::new(None),
				event_sequence: AtomicU64::new(1),
			}),
			id: NEXT_RUNTIME_ID.fetch_add(1, Ordering::Relaxed),
		}
	}

	pub fn set_event_sink(&self, sink: Arc<dyn MitigationEventSink>) {
		*self
			.recovery
			.event_sink
			.write()
			.expect("event sink poisoned") = Some(sink);
	}

	pub fn client(&self) -> &grindr::GrindrClient {
		&self.client
	}

	pub fn id(&self) -> u64 {
		self.id
	}

	pub fn configure(&self, config: ApiRuntimeConfig) -> Result<(), AppError> {
		let config = config.validate().map_err(|message| AppError::Api {
			code: 400,
			message: message.to_owned(),
		})?;
		self.recovery.configure(config);
		tracing::info!(
			circuit_window_size = config.api_circuit_window_size,
			circuit_minimum_samples = config.api_circuit_minimum_samples,
			circuit_failure_percent = config.api_circuit_failure_percent,
			circuit_open_ms = config.api_circuit_open_ms,
			protection_cooldown_ms = config.api_protection_cooldown_ms,
			"[api-runtime] configuration updated"
		);
		Ok(())
	}

	pub async fn request<F, Fut, T>(
		&self,
		policy: RetryPolicy,
		operation: F,
	) -> Result<T, RuntimeError>
	where
		F: FnOnce() -> Fut,
		Fut: Future<Output = Result<T, grindr::GrindrError>>,
	{
		let class = if policy == RetryPolicy::NeverReplay {
			RequestClass::Mutation
		} else {
			RequestClass::ForegroundRead
		};
		self.request_classified(policy, class, "<internal>", operation)
			.await
	}

	pub async fn request_classified<F, Fut, T>(
		&self,
		policy: RetryPolicy,
		class: RequestClass,
		route: &str,
		operation: F,
	) -> Result<T, RuntimeError>
	where
		F: FnOnce() -> Fut,
		Fut: Future<Output = Result<T, grindr::GrindrError>>,
	{
		self.request_classified_inner(
			policy,
			class,
			route,
			CancellationToken::new(),
			operation,
			default_outcome,
		)
		.await
	}

	pub async fn request_raw_classified<F, Fut>(
		&self,
		policy: RetryPolicy,
		class: RequestClass,
		route: &str,
		operation: F,
	) -> Result<grindr::RawResponse, RuntimeError>
	where
		F: FnOnce() -> Fut,
		Fut: Future<Output = Result<grindr::RawResponse, grindr::GrindrError>>,
	{
		self.request_raw_classified_cancellable(
			policy,
			class,
			route,
			CancellationToken::new(),
			operation,
		)
		.await
	}

	pub async fn request_raw_classified_cancellable<F, Fut>(
		&self,
		policy: RetryPolicy,
		class: RequestClass,
		route: &str,
		cancellation: CancellationToken,
		operation: F,
	) -> Result<grindr::RawResponse, RuntimeError>
	where
		F: FnOnce() -> Fut,
		Fut: Future<Output = Result<grindr::RawResponse, grindr::GrindrError>>,
	{
		self.request_classified_inner(
			policy,
			class,
			route,
			cancellation,
			operation,
			raw_outcome,
		)
		.await
	}

	async fn request_classified_inner<F, Fut, T, C>(
		&self,
		policy: RetryPolicy,
		class: RequestClass,
		route: &str,
		cancellation: CancellationToken,
		operation: F,
		classify: C,
	) -> Result<T, RuntimeError>
	where
		F: FnOnce() -> Fut,
		Fut: Future<Output = Result<T, grindr::GrindrError>>,
		C: Fn(&Result<T, grindr::GrindrError>) -> CircuitOutcome,
	{
		if crate::api::location_wifi_safety::assert_grindr_traffic_allowed_for(
			route,
		)
		.is_err()
		{
			return Err(RuntimeError::LocationWifiSafetyBlocked);
		}
		let safety_cancellation =
			crate::api::location_wifi_safety::traffic_cancellation_token_for(
				route,
			);
		let context = RequestContext {
			class,
			route: route.to_owned(),
		};
		let _priority = tokio::select! {
			_ = cancellation.cancelled() => return Err(RuntimeError::Cancelled),
			_ = safety_cancellation.cancelled() => return Err(RuntimeError::LocationWifiSafetyBlocked),
			priority = self.recovery.enter_priority(class) => priority,
		};
		let _class_permit = tokio::select! {
			_ = cancellation.cancelled() => return Err(RuntimeError::Cancelled),
			_ = safety_cancellation.cancelled() => return Err(RuntimeError::LocationWifiSafetyBlocked),
			permit = self.recovery.class_permit(class) => permit,
		};
		let request_admission = tokio::select! {
			_ = cancellation.cancelled() => return Err(RuntimeError::Cancelled),
			_ = safety_cancellation.cancelled() => return Err(RuntimeError::LocationWifiSafetyBlocked),
			admission = self.recovery.enter(policy, class, &context) => admission?,
		};
		let admission = request_admission.admission;
		let result = tokio::select! {
			_ = cancellation.cancelled() => {
				self.recovery.finish(admission, CircuitOutcome::Ignored, &context);
				return Err(RuntimeError::Cancelled);
			}
			_ = safety_cancellation.cancelled() => {
				self.recovery.finish(admission, CircuitOutcome::Ignored, &context);
				return Err(RuntimeError::LocationWifiSafetyBlocked);
			}
			result = operation() => result,
		};
		let outcome = classify(&result);
		self.recovery.finish(admission, outcome, &context);
		result.map_err(RuntimeError::Grindr)
	}
}

impl RequestRecovery {
	fn configure(&self, config: ApiRuntimeConfig) {
		*self
			.config
			.write()
			.unwrap_or_else(|poisoned| poisoned.into_inner()) = config;
		let mut state = self
			.state
			.lock()
			.unwrap_or_else(|poisoned| poisoned.into_inner());
		while state.outcomes.len() > config.api_circuit_window_size {
			state.outcomes.pop_front();
		}
	}

	fn emit(
		&self,
		state: MitigationState,
		reason: MitigationReason,
		context: &RequestContext,
		retry_at_ms: Option<u64>,
		action: &'static str,
	) {
		let event = ApiMitigationEvent {
			sequence: self.event_sequence.fetch_add(1, Ordering::Relaxed),
			phase: state,
			reason,
			request_class: context.class,
			route: context.route.clone(),
			attempt: usize::from(matches!(state, MitigationState::Probing)),
			retry_at_ms,
			cooldown_level: 0,
			active_requests: MAX_CONCURRENT_REQUESTS
				.saturating_sub(self.requests.available_permits()),
			queued_requests: self.queued_requests.load(Ordering::Relaxed),
		};
		tracing::warn!(action, state = ?state, reason = ?reason, request_class = ?context.class, route = context.route, retry_at_ms, "[api-mitigation]");
		if let Some(sink) = self
			.event_sink
			.read()
			.expect("event sink poisoned")
			.as_ref()
		{
			sink.emit(&event);
		}
	}

	fn admit(
		&self,
		policy: RetryPolicy,
		class: RequestClass,
		context: &RequestContext,
	) -> Result<Admission, RuntimeError> {
		let now = Instant::now();
		let mut state = self
			.state
			.lock()
			.unwrap_or_else(|poisoned| poisoned.into_inner());
		let protection_probe =
			if let Some(until) = state.global_protection_until {
				if now < until {
					let retry_at_ms = retry_at_ms(until, now);
					drop(state);
					self.emit(
						MitigationState::Cooldown,
						MitigationReason::Protection,
						context,
						Some(retry_at_ms),
						"global_protection_deferred",
					);
					return Err(RuntimeError::Cooldown { retry_at_ms });
				}
				if policy == RetryPolicy::NeverReplay
					|| class == RequestClass::BrowseProfileBatch
					|| state.global_protection_probe
				{
					let retry_at_ms = system_time_ms() + 1_000;
					drop(state);
					self.emit(
						MitigationState::Cooldown,
						MitigationReason::Protection,
						context,
						Some(retry_at_ms),
						"global_protection_probe_required",
					);
					return Err(RuntimeError::Cooldown { retry_at_ms });
				}
				Some(ProtectionScope::Global)
			} else if class == RequestClass::BrowseProfileBatch {
				if let Some(until) = state.profile_protection_until {
					if now < until {
						let retry_at_ms = retry_at_ms(until, now);
						drop(state);
						self.emit(
							MitigationState::Cooldown,
							MitigationReason::Protection,
							context,
							Some(retry_at_ms),
							"optional_enrichment_deferred",
						);
						return Err(RuntimeError::Cooldown { retry_at_ms });
					}
					if state.profile_protection_probe {
						let retry_at_ms = system_time_ms() + 1_000;
						return Err(RuntimeError::Cooldown { retry_at_ms });
					}
					Some(ProtectionScope::Profile)
				} else {
					None
				}
			} else {
				None
			};

		let breaker_probe = if let Some(until) = state.open_until {
			if now < until {
				let retry_at_ms = retry_at_ms(until, now);
				drop(state);
				self.emit(
					MitigationState::Cooldown,
					MitigationReason::Circuit,
					context,
					Some(retry_at_ms),
					"circuit_open",
				);
				return Err(RuntimeError::Cooldown { retry_at_ms });
			}
			if policy == RetryPolicy::NeverReplay || state.half_open {
				return Err(RuntimeError::Cooldown {
					retry_at_ms: system_time_ms() + 1_000,
				});
			}
			true
		} else {
			false
		};
		match protection_probe {
			Some(ProtectionScope::Global) => {
				state.global_protection_probe = true;
			}
			Some(ProtectionScope::Profile) => {
				state.profile_protection_probe = true;
			}
			None => {}
		}
		if breaker_probe {
			state.half_open = true;
		}
		drop(state);
		if breaker_probe {
			self.emit(
				MitigationState::Probing,
				MitigationReason::Circuit,
				context,
				None,
				"circuit_probe_started",
			);
		}
		if let Some(scope) = protection_probe {
			self.emit(
				MitigationState::Probing,
				MitigationReason::Protection,
				context,
				None,
				match scope {
					ProtectionScope::Global => {
						"global_protection_probe_started"
					}
					ProtectionScope::Profile => {
						"profile_protection_probe_started"
					}
				},
			);
		}
		Ok(Admission {
			breaker_probe,
			protection_probe,
		})
	}

	fn finish(
		&self,
		admission: Admission,
		outcome: CircuitOutcome,
		context: &RequestContext,
	) {
		let now = Instant::now();
		let config = *self
			.config
			.read()
			.unwrap_or_else(|poisoned| poisoned.into_inner());
		let mut circuit_opened = None;
		let mut circuit_recovered = false;
		let mut protection_opened = None;
		let mut protection_recovered = None;
		{
			let mut state = self
				.state
				.lock()
				.unwrap_or_else(|poisoned| poisoned.into_inner());

			if outcome == CircuitOutcome::ProtectionBlocked {
				let until = now
					+ Duration::from_millis(config.api_protection_cooldown_ms);
				let scope = if context.class == RequestClass::BrowseProfileBatch
				{
					ProtectionScope::Profile
				} else {
					ProtectionScope::Global
				};
				match scope {
					ProtectionScope::Global => {
						state.global_protection_until = Some(until);
						state.global_protection_probe = false;
					}
					ProtectionScope::Profile => {
						state.profile_protection_until = Some(until);
						state.profile_protection_probe = false;
					}
				}
				protection_opened = Some((until, scope));
			} else if let Some(scope) = admission.protection_probe {
				match scope {
					ProtectionScope::Global => {
						state.global_protection_probe = false;
					}
					ProtectionScope::Profile => {
						state.profile_protection_probe = false;
					}
				}
				if matches!(
					outcome,
					CircuitOutcome::Success | CircuitOutcome::Failure
				) {
					match scope {
						ProtectionScope::Global => {
							state.global_protection_until = None;
						}
						ProtectionScope::Profile => {
							state.profile_protection_until = None;
						}
					}
					protection_recovered = Some(scope);
				}
			}

			if admission.breaker_probe {
				state.half_open = false;
				match outcome {
					CircuitOutcome::Failure => {
						let until = now
							+ Duration::from_millis(config.api_circuit_open_ms);
						state.open_until = Some(until);
						circuit_opened = Some(until);
					}
					CircuitOutcome::Success => {
						state.open_until = None;
						state.outcomes.clear();
						circuit_recovered = true;
					}
					CircuitOutcome::Ignored
					| CircuitOutcome::ProtectionBlocked => {}
				}
			} else if matches!(
				outcome,
				CircuitOutcome::Success | CircuitOutcome::Failure
			) {
				state.outcomes.push_back(outcome == CircuitOutcome::Failure);
				while state.outcomes.len() > config.api_circuit_window_size {
					state.outcomes.pop_front();
				}
				let failures =
					state.outcomes.iter().filter(|failed| **failed).count();
				if state.outcomes.len() >= config.api_circuit_minimum_samples
					&& failures * 100
						>= state.outcomes.len()
							* config.api_circuit_failure_percent
				{
					let until =
						now + Duration::from_millis(config.api_circuit_open_ms);
					state.open_until = Some(until);
					circuit_opened = Some(until);
				}
			}
		}

		if let Some((until, scope)) = protection_opened {
			self.emit(
				MitigationState::Cooldown,
				MitigationReason::Protection,
				context,
				Some(retry_at_ms(until, now)),
				match scope {
					ProtectionScope::Global => "global_protection_detected",
					ProtectionScope::Profile => "profile_protection_detected",
				},
			);
		}
		if let Some(scope) = protection_recovered {
			self.emit(
				MitigationState::Recovered,
				MitigationReason::Protection,
				context,
				None,
				match scope {
					ProtectionScope::Global => {
						"global_protection_probe_succeeded"
					}
					ProtectionScope::Profile => {
						"profile_protection_probe_succeeded"
					}
				},
			);
		}
		if let Some(until) = circuit_opened {
			self.emit(
				MitigationState::Cooldown,
				MitigationReason::Circuit,
				context,
				Some(retry_at_ms(until, now)),
				"circuit_opened",
			);
		}
		if circuit_recovered {
			self.emit(
				MitigationState::Recovered,
				MitigationReason::Circuit,
				context,
				None,
				"circuit_probe_succeeded",
			);
		}
	}

	async fn class_permit(
		&self,
		class: RequestClass,
	) -> Option<SemaphorePermit<'_>> {
		match class {
			RequestClass::BrowseCascade => Some(
				self.browse_cascade
					.acquire()
					.await
					.expect("browse cascade semaphore closed"),
			),
			RequestClass::BrowseProfileBatch => Some(
				self.browse_profile_batch
					.acquire()
					.await
					.expect("browse profile semaphore closed"),
			),
			RequestClass::BackgroundPoll => Some(
				self.background_poll
					.acquire()
					.await
					.expect("background poll semaphore closed"),
			),
			RequestClass::ForegroundRead | RequestClass::Mutation => None,
		}
	}

	async fn enter<'a>(
		&'a self,
		policy: RetryPolicy,
		class: RequestClass,
		context: &RequestContext,
	) -> Result<RequestAdmission<'a>, RuntimeError> {
		self.queued_requests.fetch_add(1, Ordering::Relaxed);
		let mut queued = QueuedRequest {
			counter: &self.queued_requests,
			waiting: true,
		};
		let permit = self
			.requests
			.acquire()
			.await
			.expect("request semaphore closed");
		queued.finish();
		let admission = self.admit(policy, class, context)?;
		Ok(RequestAdmission {
			_permit: permit,
			admission,
		})
	}

	async fn enter_priority(&self, class: RequestClass) -> PriorityRequest<'_> {
		if class == RequestClass::BackgroundPoll {
			loop {
				let notified = self.priority_notify.notified();
				{
					let mut state = self
						.priority
						.lock()
						.unwrap_or_else(|poisoned| poisoned.into_inner());
					if state.foreground_active == 0
						&& state.foreground_waiting == 0
						&& !state.background_active
					{
						state.background_active = true;
						return PriorityRequest {
							recovery: self,
							background: true,
						};
					}
				}
				tracing::info!("[api-runtime] background_deferred");
				notified.await;
			}
		}

		{
			let mut state = self
				.priority
				.lock()
				.unwrap_or_else(|poisoned| poisoned.into_inner());
			state.foreground_waiting += 1;
		}
		let mut waiter = ForegroundWaiter {
			recovery: self,
			waiting: true,
		};
		loop {
			let notified = self.priority_notify.notified();
			{
				let mut state = self
					.priority
					.lock()
					.unwrap_or_else(|poisoned| poisoned.into_inner());
				if !state.background_active {
					state.foreground_waiting -= 1;
					state.foreground_active += 1;
					waiter.waiting = false;
					return PriorityRequest {
						recovery: self,
						background: false,
					};
				}
			}
			notified.await;
		}
	}
}

struct QueuedRequest<'a> {
	counter: &'a AtomicUsize,
	waiting: bool,
}

impl QueuedRequest<'_> {
	fn finish(&mut self) {
		if self.waiting {
			self.waiting = false;
			self.counter.fetch_sub(1, Ordering::Relaxed);
		}
	}
}

impl Drop for QueuedRequest<'_> {
	fn drop(&mut self) {
		self.finish();
	}
}

struct ForegroundWaiter<'a> {
	recovery: &'a RequestRecovery,
	waiting: bool,
}

impl Drop for ForegroundWaiter<'_> {
	fn drop(&mut self) {
		if !self.waiting {
			return;
		}
		let mut state = self
			.recovery
			.priority
			.lock()
			.unwrap_or_else(|poisoned| poisoned.into_inner());
		state.foreground_waiting -= 1;
		drop(state);
		self.recovery.priority_notify.notify_waiters();
	}
}

struct PriorityRequest<'a> {
	recovery: &'a RequestRecovery,
	background: bool,
}

impl Drop for PriorityRequest<'_> {
	fn drop(&mut self) {
		let mut state = self
			.recovery
			.priority
			.lock()
			.unwrap_or_else(|poisoned| poisoned.into_inner());
		if self.background {
			state.background_active = false;
		} else {
			state.foreground_active -= 1;
		}
		drop(state);
		self.recovery.priority_notify.notify_waiters();
	}
}

fn raw_outcome(
	result: &Result<grindr::RawResponse, grindr::GrindrError>,
) -> CircuitOutcome {
	match result {
		Ok(response) => status_outcome(response.status),
		Err(error) => error_outcome(error),
	}
}

fn default_outcome<T>(
	result: &Result<T, grindr::GrindrError>,
) -> CircuitOutcome {
	match result {
		Ok(_) => CircuitOutcome::Success,
		Err(error) => error_outcome(error),
	}
}

fn status_outcome(status: u16) -> CircuitOutcome {
	if status == 400 || status == 429 || status >= 500 {
		CircuitOutcome::Failure
	} else {
		CircuitOutcome::Success
	}
}

fn error_outcome(error: &grindr::GrindrError) -> CircuitOutcome {
	match error {
		grindr::GrindrError::Blocked => CircuitOutcome::ProtectionBlocked,
		grindr::GrindrError::RateLimited => CircuitOutcome::Failure,
		grindr::GrindrError::Api { code, .. }
			if *code == 400 || *code == 429 || *code >= 500 =>
		{
			CircuitOutcome::Failure
		}
		grindr::GrindrError::Unauthorized { .. }
		| grindr::GrindrError::Banned(_)
		| grindr::GrindrError::Api { .. } => CircuitOutcome::Success,
		grindr::GrindrError::Http(_)
		| grindr::GrindrError::Auth(_)
		| grindr::GrindrError::InvalidRequest(_) => CircuitOutcome::Ignored,
		_ => CircuitOutcome::Ignored,
	}
}

fn retry_at_ms(until: Instant, now: Instant) -> u64 {
	system_time_ms() + until.saturating_duration_since(now).as_millis() as u64
}

fn system_time_ms() -> u64 {
	SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.unwrap_or_default()
		.as_millis() as u64
}

pub fn retry_policy(method: &grindr::Method, path: &str) -> RetryPolicy {
	let route = path.split_once('?').map_or(path, |(route, _)| route);
	if method == grindr::Method::GET
		|| method == grindr::Method::HEAD
		|| (method == grindr::Method::POST
			&& matches!(route, "/v4/inbox" | "/v3/profiles"))
	{
		RetryPolicy::SafeRead
	} else {
		RetryPolicy::NeverReplay
	}
}

pub fn request_class(method: &grindr::Method, path: &str) -> RequestClass {
	let route = path.split_once('?').map_or(path, |(route, _)| route);
	if method == grindr::Method::GET && route == "/v4/cascade" {
		RequestClass::BrowseCascade
	} else if method == grindr::Method::POST && route == "/v3/profiles" {
		RequestClass::BrowseProfileBatch
	} else if retry_policy(method, path) == RetryPolicy::NeverReplay {
		RequestClass::Mutation
	} else {
		RequestClass::ForegroundRead
	}
}

#[tauri::command]
pub fn api_runtime_configure(
	api_circuit_failure_percent: usize,
	api_circuit_minimum_samples: usize,
	api_circuit_open_ms: u64,
	api_circuit_window_size: usize,
	api_protection_cooldown_ms: u64,
) -> Result<(), AppError> {
	let runtime = ApiRuntime::get().ok_or(AppError::NotInitialized)?;
	runtime.configure(ApiRuntimeConfig {
		api_circuit_failure_percent,
		api_circuit_minimum_samples,
		api_circuit_open_ms,
		api_circuit_window_size,
		api_protection_cooldown_ms,
	})
}

#[cfg(test)]
mod tests {
	use super::*;

	fn test_recovery() -> RequestRecovery {
		RequestRecovery {
			config: std::sync::RwLock::new(ApiRuntimeConfig::default()),
			state: std::sync::Mutex::new(CircuitState::default()),
			requests: Semaphore::new(MAX_CONCURRENT_REQUESTS),
			browse_cascade: Semaphore::new(1),
			browse_profile_batch: Semaphore::new(1),
			background_poll: Semaphore::new(1),
			priority: std::sync::Mutex::new(PriorityState::default()),
			priority_notify: tokio::sync::Notify::new(),
			queued_requests: AtomicUsize::new(0),
			event_sink: std::sync::RwLock::new(None),
			event_sequence: AtomicU64::new(1),
		}
	}

	fn context(class: RequestClass) -> RequestContext {
		RequestContext {
			class,
			route: "/v4/test".to_owned(),
		}
	}

	#[test]
	fn circuit_status_contract_matches_reference_client() {
		assert_eq!(status_outcome(200), CircuitOutcome::Success);
		assert_eq!(status_outcome(401), CircuitOutcome::Success);
		assert_eq!(status_outcome(403), CircuitOutcome::Success);
		assert_eq!(status_outcome(404), CircuitOutcome::Success);
		assert_eq!(status_outcome(400), CircuitOutcome::Failure);
		assert_eq!(status_outcome(429), CircuitOutcome::Failure);
		assert_eq!(status_outcome(500), CircuitOutcome::Failure);
	}

	#[test]
	fn circuit_opens_at_twenty_samples_and_fifty_percent_failures() {
		let recovery = test_recovery();
		let context = context(RequestClass::ForegroundRead);
		for index in 0..19 {
			let outcome = if index < 10 {
				CircuitOutcome::Failure
			} else {
				CircuitOutcome::Success
			};
			recovery.finish(
				Admission {
					breaker_probe: false,
					protection_probe: None,
				},
				outcome,
				&context,
			);
		}
		assert!(recovery.state.lock().expect("state").open_until.is_none());
		recovery.finish(
			Admission {
				breaker_probe: false,
				protection_probe: None,
			},
			CircuitOutcome::Success,
			&context,
		);
		assert!(recovery.state.lock().expect("state").open_until.is_some());
	}

	#[test]
	fn runtime_configuration_validates_bounds_and_prunes_history() {
		let recovery = test_recovery();
		{
			let mut state = recovery.state.lock().expect("state");
			state.outcomes.extend(std::iter::repeat_n(false, 50));
		}
		let config = ApiRuntimeConfig {
			api_circuit_window_size: 20,
			api_circuit_minimum_samples: 10,
			api_circuit_failure_percent: 25,
			api_circuit_open_ms: 60_000,
			api_protection_cooldown_ms: 90_000,
		}
		.validate()
		.expect("valid configuration");
		recovery.configure(config);
		assert_eq!(recovery.state.lock().expect("state").outcomes.len(), 20);

		assert!(ApiRuntimeConfig {
			api_circuit_minimum_samples: 21,
			..ApiRuntimeConfig::default()
		}
		.validate()
		.is_err());
		assert!(ApiRuntimeConfig {
			api_circuit_failure_percent: 51,
			..ApiRuntimeConfig::default()
		}
		.validate()
		.is_err());
	}

	#[test]
	fn protection_block_does_not_enter_circuit_window() {
		let recovery = test_recovery();
		let profile_context = context(RequestClass::BrowseProfileBatch);
		recovery.finish(
			Admission {
				breaker_probe: false,
				protection_probe: None,
			},
			CircuitOutcome::ProtectionBlocked,
			&profile_context,
		);
		{
			let state = recovery.state.lock().expect("state");
			assert!(state.outcomes.is_empty());
			assert!(state.open_until.is_none());
			assert!(state.profile_protection_until.is_some());
			assert!(state.global_protection_until.is_none());
		}
		recovery
			.admit(
				RetryPolicy::SafeRead,
				RequestClass::ForegroundRead,
				&context(RequestClass::ForegroundRead),
			)
			.expect("profile protection remains endpoint-scoped");
	}

	#[test]
	fn non_profile_protection_block_starts_global_cooldown() {
		let recovery = test_recovery();
		let blocked_context = context(RequestClass::ForegroundRead);
		recovery.finish(
			Admission {
				breaker_probe: false,
				protection_probe: None,
			},
			CircuitOutcome::ProtectionBlocked,
			&blocked_context,
		);

		assert!(matches!(
			recovery.admit(
				RetryPolicy::SafeRead,
				RequestClass::ForegroundRead,
				&blocked_context,
			),
			Err(RuntimeError::Cooldown { .. })
		));
		assert!(matches!(
			recovery.admit(
				RetryPolicy::SafeRead,
				RequestClass::BrowseProfileBatch,
				&context(RequestClass::BrowseProfileBatch),
			),
			Err(RuntimeError::Cooldown { .. })
		));
	}

	#[test]
	fn mutation_waits_for_safe_read_after_global_protection_cooldown() {
		let recovery = test_recovery();
		let foreground_context = context(RequestClass::ForegroundRead);
		recovery.finish(
			Admission {
				breaker_probe: false,
				protection_probe: None,
			},
			CircuitOutcome::ProtectionBlocked,
			&foreground_context,
		);
		recovery
			.state
			.lock()
			.expect("state")
			.global_protection_until = Some(Instant::now() - Duration::from_secs(1));

		assert!(matches!(
			recovery.admit(
				RetryPolicy::NeverReplay,
				RequestClass::Mutation,
				&context(RequestClass::Mutation),
			),
			Err(RuntimeError::Cooldown { .. })
		));

		let probe = recovery
			.admit(
				RetryPolicy::SafeRead,
				RequestClass::ForegroundRead,
				&foreground_context,
			)
			.expect("safe read starts the recovery probe");
		assert_eq!(probe.protection_probe, Some(ProtectionScope::Global));
		recovery.finish(probe, CircuitOutcome::Success, &foreground_context);

		recovery
			.admit(
				RetryPolicy::NeverReplay,
				RequestClass::Mutation,
				&context(RequestClass::Mutation),
			)
			.expect("mutation allowed only after safe-read recovery");
	}

	#[tokio::test]
	async fn dropped_queue_waiter_restores_queue_count() {
		let recovery = test_recovery();
		let permits = recovery
			.requests
			.acquire_many(MAX_CONCURRENT_REQUESTS as u32)
			.await
			.expect("all permits");
		let context = context(RequestClass::ForegroundRead);
		let future = recovery.enter(
			RetryPolicy::SafeRead,
			RequestClass::ForegroundRead,
			&context,
		);
		assert!(tokio::time::timeout(Duration::from_millis(10), future)
			.await
			.is_err());
		assert_eq!(recovery.queued_requests.load(Ordering::Relaxed), 0);
		drop(permits);
	}

	#[tokio::test]
	async fn queued_request_rechecks_circuit_after_global_permit() {
		let recovery = test_recovery();
		let context = context(RequestClass::ForegroundRead);
		let operation_executed = std::sync::atomic::AtomicBool::new(false);
		let permits = recovery
			.requests
			.acquire_many(MAX_CONCURRENT_REQUESTS as u32)
			.await
			.expect("all permits");
		let request = async {
			let _entry = recovery
				.enter(
					RetryPolicy::SafeRead,
					RequestClass::ForegroundRead,
					&context,
				)
				.await?;
			operation_executed.store(true, Ordering::Relaxed);
			Ok::<(), RuntimeError>(())
		};
		tokio::pin!(request);

		assert!(
			tokio::time::timeout(Duration::from_millis(10), &mut request)
				.await
				.is_err()
		);
		assert_eq!(recovery.queued_requests.load(Ordering::Relaxed), 1);
		recovery.state.lock().expect("state").open_until =
			Some(Instant::now() + Duration::from_secs(60));
		drop(permits);

		assert!(matches!(
			tokio::time::timeout(Duration::from_millis(50), request)
				.await
				.expect("queued request released"),
			Err(RuntimeError::Cooldown { .. })
		));
		assert!(!operation_executed.load(Ordering::Relaxed));
		assert_eq!(
			recovery.requests.available_permits(),
			MAX_CONCURRENT_REQUESTS
		);
	}

	#[test]
	fn circuit_rejection_does_not_latch_protection_probe() {
		let recovery = test_recovery();
		let context = context(RequestClass::BrowseProfileBatch);
		{
			let mut state = recovery.state.lock().expect("state");
			state.profile_protection_until =
				Some(Instant::now() - Duration::from_secs(1));
			state.open_until = Some(Instant::now() + Duration::from_secs(60));
		}

		assert!(matches!(
			recovery.admit(
				RetryPolicy::SafeRead,
				RequestClass::BrowseProfileBatch,
				&context,
			),
			Err(RuntimeError::Cooldown { .. })
		));
		{
			let mut state = recovery.state.lock().expect("state");
			assert!(!state.profile_protection_probe);
			state.open_until = None;
		}

		let admission = recovery
			.admit(
				RetryPolicy::SafeRead,
				RequestClass::BrowseProfileBatch,
				&context,
			)
			.expect("protection probe remains available");
		assert_eq!(admission.protection_probe, Some(ProtectionScope::Profile));
		recovery.finish(admission, CircuitOutcome::Ignored, &context);
	}

	#[tokio::test]
	async fn background_waits_until_foreground_finishes() {
		let recovery = test_recovery();
		let foreground =
			recovery.enter_priority(RequestClass::ForegroundRead).await;
		assert!(tokio::time::timeout(
			Duration::from_millis(10),
			recovery.enter_priority(RequestClass::BackgroundPoll),
		)
		.await
		.is_err());
		drop(foreground);
		let background = tokio::time::timeout(
			Duration::from_millis(50),
			recovery.enter_priority(RequestClass::BackgroundPoll),
		)
		.await
		.expect("background released");
		drop(background);
	}

	#[test]
	fn request_classes_use_method_and_route_without_query_values() {
		assert_eq!(
			request_class(
				&grindr::Method::GET,
				"/v4/cascade?nearbyGeoHash=secret"
			),
			RequestClass::BrowseCascade
		);
		assert_eq!(
			request_class(&grindr::Method::POST, "/v3/profiles"),
			RequestClass::BrowseProfileBatch
		);
		assert_eq!(
			request_class(&grindr::Method::POST, "/v4/chat/message/send"),
			RequestClass::Mutation
		);
	}

	#[test]
	fn mitigation_event_has_stable_schema() {
		let event = ApiMitigationEvent {
			sequence: 7,
			phase: MitigationState::Cooldown,
			reason: MitigationReason::Protection,
			request_class: RequestClass::BrowseProfileBatch,
			route: "/v3/profiles".to_owned(),
			attempt: 0,
			retry_at_ms: Some(123),
			cooldown_level: 0,
			active_requests: 1,
			queued_requests: 0,
		};
		let value = serde_json::to_value(event).expect("event serializes");
		assert_eq!(value["phase"], "cooldown");
		assert_eq!(value["reason"], "protection");
		assert_eq!(value["requestClass"], "browseProfileBatch");
	}
}
