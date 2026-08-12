pub fn stage_frameworks(
	products: &std::path::Path,
	destination_root: &std::path::Path,
	platform: &str,
	names: &[&str],
) -> std::io::Result<()> {
	let destination = destination_root.join(platform);
	std::fs::create_dir_all(&destination)?;
	for name in names {
		let source = products.join(format!("{name}.framework"));
		let target = destination.join(format!("{name}.framework"));
		if target.exists() {
			std::fs::remove_dir_all(&target)?;
		}
		copy_directory(&source, &target)?;
	}
	Ok(())
}

fn copy_directory(
	source: &std::path::Path,
	target: &std::path::Path,
) -> std::io::Result<()> {
	std::fs::create_dir_all(target)?;
	for entry in std::fs::read_dir(source)? {
		let entry = entry?;
		let destination = target.join(entry.file_name());
		if entry.file_type()?.is_dir() {
			copy_directory(&entry.path(), &destination)?;
		} else {
			std::fs::copy(entry.path(), destination)?;
		}
	}
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::stage_frameworks;
	use std::path::PathBuf;

	fn temporary_directory() -> PathBuf {
		let nonce = std::time::SystemTime::now()
			.duration_since(std::time::UNIX_EPOCH)
			.expect("system clock before epoch")
			.as_nanos();
		std::env::temp_dir().join(format!(
			"open-grind-ios-framework-test-{}-{nonce}",
			std::process::id()
		))
	}

	fn write_framework(products: &std::path::Path, contents: &str) {
		let framework = products.join("AgoraRtcKit.framework");
		std::fs::create_dir_all(&framework).expect("create source framework");
		std::fs::write(framework.join("AgoraRtcKit"), contents)
			.expect("write source framework binary");
	}

	#[test]
	fn stages_device_and_simulator_frameworks_without_overwriting_each_other() {
		let root = temporary_directory();
		let device_products = root.join("device-products");
		let simulator_products = root.join("simulator-products");
		let staged = root.join("staged");
		write_framework(&device_products, "device");
		write_framework(&simulator_products, "simulator");

		stage_frameworks(
			&device_products,
			&staged,
			"iphoneos",
			&["AgoraRtcKit"],
		)
		.expect("stage device framework");
		stage_frameworks(
			&simulator_products,
			&staged,
			"iphonesimulator",
			&["AgoraRtcKit"],
		)
		.expect("stage simulator framework");

		assert_eq!(
			std::fs::read_to_string(
				staged.join("iphoneos/AgoraRtcKit.framework/AgoraRtcKit")
			)
			.expect("read staged device framework"),
			"device"
		);
		assert_eq!(
			std::fs::read_to_string(
				staged
					.join("iphonesimulator/AgoraRtcKit.framework/AgoraRtcKit")
			)
			.expect("read staged simulator framework"),
			"simulator"
		);

		std::fs::remove_dir_all(root).expect("remove owned test directory");
	}
}
