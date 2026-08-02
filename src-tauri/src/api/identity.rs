use serde::Deserialize;

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AndroidApiIdentitySnapshot {
	pub os: String,
	pub device_model: String,
	pub manufacturer: String,
	pub screen_resolution: String,
	pub total_ram: String,
	pub timezone: String,
	pub locale: String,
	pub accept_language: String,
}

pub fn reconcile_device(
	device: &mut grindr::DeviceInfo,
	snapshot: &AndroidApiIdentitySnapshot,
) {
	device.device_type = 2;
	device.os.clone_from(&snapshot.os);
	device.device_model.clone_from(&snapshot.device_model);
	device.manufacturer.clone_from(&snapshot.manufacturer);
	device
		.screen_resolution
		.clone_from(&snapshot.screen_resolution);
	device.total_ram.clone_from(&snapshot.total_ram);
	device.timezone.clone_from(&snapshot.timezone);
	device.locale.clone_from(&snapshot.locale);
	device.accept_language.clone_from(&snapshot.accept_language);
}

#[cfg(target_os = "android")]
pub fn align_device(device: &mut grindr::DeviceInfo) -> Result<(), String> {
	use jni::objects::{JClass, JObject, JValue};
	use jni::JavaVM;

	let android = ndk_context::android_context();
	let vm = unsafe { JavaVM::from_raw(android.vm().cast()) }
		.map_err(|error| format!("Android VM unavailable: {error}"))?;
	let mut env = vm
		.attach_current_thread()
		.map_err(|error| format!("Android JNI attach failed: {error}"))?;
	let context = unsafe { JObject::from_raw(android.context().cast()) };
	let result = (|| {
		let class_loader = env
			.call_method(
				&context,
				"getClassLoader",
				"()Ljava/lang/ClassLoader;",
				&[],
			)
			.map_err(|error| format!("Android class loader failed: {error}"))?
			.l()
			.map_err(|error| {
				format!("Android class loader result failed: {error}")
			})?;
		let class_name = JObject::from(
			env.new_string("org.opengrind.AndroidApiIdentity").map_err(
				|error| format!("Android identity class name failed: {error}"),
			)?,
		);
		let identity_class = env
			.call_method(
				class_loader,
				"loadClass",
				"(Ljava/lang/String;)Ljava/lang/Class;",
				&[JValue::Object(&class_name)],
			)
			.map_err(|error| {
				format!("Android identity class load failed: {error}")
			})?
			.l()
			.map_err(|error| {
				format!("Android identity class result failed: {error}")
			})?;
		let identity_class = JClass::from(identity_class);
		let identity = env
			.get_static_field(
				identity_class,
				"INSTANCE",
				"Lorg/opengrind/AndroidApiIdentity;",
			)
			.map_err(|error| {
				format!("Android identity instance failed: {error}")
			})?
			.l()
			.map_err(|error| {
				format!("Android identity instance result failed: {error}")
			})?;
		let value = env
			.call_method(
				identity,
				"snapshot",
				"(Landroid/content/Context;)Ljava/lang/String;",
				&[JValue::Object(&context)],
			)
			.map_err(|error| format!("Android identity call failed: {error}"))?
			.l()
			.map_err(|error| {
				format!("Android identity result failed: {error}")
			})?;
		let raw = env.get_string((&value).into()).map_err(|error| {
			format!("Android identity string failed: {error}")
		})?;
		let snapshot: AndroidApiIdentitySnapshot =
			serde_json::from_str(&String::from(raw)).map_err(|error| {
				format!("Android identity decode failed: {error}")
			})?;
		reconcile_device(device, &snapshot);
		Ok(())
	})();
	if env.exception_check().unwrap_or(false) {
		let _ = env.exception_clear();
	}
	std::mem::forget(context);
	result
}

#[cfg(not(target_os = "android"))]
pub fn align_device(_device: &mut grindr::DeviceInfo) -> Result<(), String> {
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn reconciliation_preserves_pseudonymous_identifiers() {
		let mut device = grindr::DeviceInfo::generate();
		let device_id = device.device_id.clone();
		let advertising_id = device.advertising_id.clone();
		let snapshot = AndroidApiIdentitySnapshot {
			os: "Android 13".to_owned(),
			device_model: "T20S".to_owned(),
			manufacturer: "DOOGEE".to_owned(),
			screen_resolution: "2000x1200".to_owned(),
			total_ram: "8026152960".to_owned(),
			timezone: "Europe/Dublin".to_owned(),
			locale: "en_IE".to_owned(),
			accept_language: "en-IE".to_owned(),
		};

		reconcile_device(&mut device, &snapshot);

		assert_eq!(device.device_id, device_id);
		assert_eq!(device.advertising_id, advertising_id);
		assert_eq!(device.os, "Android 13");
		assert_eq!(device.device_model, "T20S");
		assert_eq!(device.manufacturer, "DOOGEE");
		assert_eq!(device.screen_resolution, "2000x1200");
	}
}
