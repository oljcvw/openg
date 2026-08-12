#[path = "src/ios_build_support.rs"]
mod ios_build_support;

fn main() {
	tauri_build::try_build(
		tauri_build::Attributes::new().plugin(
			"open-grind-voice-recorder",
			tauri_build::InlinedPlugin::new()
				.commands(&["register_listener", "remove_listener"])
				.default_permission(
					tauri_build::DefaultPermissionRule::AllowAllCommands,
				),
		),
	)
	.expect("failed to build Tauri application metadata");
	tauri_plugin::Builder::new(&[])
		.ios_path("ios")
		.try_build()
		.expect("failed to build Open Grind native mobile support");
	globalize_swift_rs_ios_exports();
	link_agora_ios_frameworks();
}

fn globalize_swift_rs_ios_exports() {
	if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("ios") {
		return;
	}

	// Xcode 27 release optimization internalizes SwiftRs' @_cdecl bridge
	// functions inside the dependency member of this root static archive. The
	// swift-rs fork repairs package-owned exports, but intentionally does not
	// globalize dependency members because doing that in every package archive
	// creates duplicate global symbols. Rust links only this root archive, so
	// repair the four SwiftRs ABI symbols once here before rustc consumes it.
	let archive = swift_products_dir().join("libopen-grind.a");
	let symbols = [
		"_retain_object",
		"_release_object",
		"_data_from_bytes",
		"_string_from_bytes",
	];
	let before = symbol_bindings(&archive);
	let local = symbols
		.iter()
		.filter(|symbol| {
			before
				.iter()
				.any(|(kind, name)| kind == "t" && name == *symbol)
		})
		.copied()
		.collect::<Vec<_>>();
	if local.is_empty() {
		return;
	}

	let sysroot = std::process::Command::new("rustc")
		.args(["--print", "sysroot"])
		.output()
		.expect(
			"failed to locate Rust sysroot for Xcode 27 Swift export repair",
		);
	assert!(sysroot.status.success(), "rustc --print sysroot failed");
	let host = format!("{}-apple-darwin", std::env::consts::ARCH);
	let objcopy = std::path::Path::new(
		std::str::from_utf8(&sysroot.stdout)
			.expect("Rust sysroot is not UTF-8")
			.trim(),
	)
	.join("lib/rustlib")
	.join(host)
	.join("bin/llvm-objcopy");
	assert!(
		objcopy.is_file(),
		"missing {}; install the Rust llvm-tools component",
		objcopy.display()
	);

	let status = std::process::Command::new(&objcopy)
		.args(
			local
				.iter()
				.map(|symbol| format!("--globalize-symbol={symbol}")),
		)
		.arg(&archive)
		.status()
		.expect("failed to run llvm-objcopy for Xcode 27 Swift export repair");
	assert!(
		status.success(),
		"llvm-objcopy failed for {}",
		archive.display()
	);

	let after = symbol_bindings(&archive);
	for symbol in local {
		assert!(
			after
				.iter()
				.any(|(kind, name)| kind == "T" && name == symbol),
			"failed to globalize {symbol} in {}",
			archive.display()
		);
	}
}

fn symbol_bindings(archive: &std::path::Path) -> Vec<(String, String)> {
	let output = std::process::Command::new("nm")
		.arg(archive)
		.output()
		.unwrap_or_else(|error| {
			panic!("failed to inspect {}: {error}", archive.display())
		});
	assert!(
		output.status.success(),
		"nm failed for {}",
		archive.display()
	);
	String::from_utf8_lossy(&output.stdout)
		.lines()
		.filter_map(|line| {
			let fields = line.split_whitespace().collect::<Vec<_>>();
			let [.., kind, name] = fields.as_slice() else {
				return None;
			};
			matches!(*kind, "t" | "T")
				.then(|| ((*kind).to_string(), (*name).to_string()))
		})
		.collect()
}

fn swift_products_dir() -> std::path::PathBuf {
	let out_dir = std::path::PathBuf::from(
		std::env::var("OUT_DIR").expect("OUT_DIR missing for iOS native build"),
	);
	let configuration = if std::env::var("PROFILE").as_deref() == Ok("release")
	{
		"Release"
	} else {
		"Debug"
	};
	out_dir
		.join("swift-rs/open-grind/out/Products")
		.join(format!("{configuration}-{}", ios_platform()))
}

fn ios_configuration() -> &'static str {
	if std::env::var("PROFILE").as_deref() == Ok("release") {
		"Release"
	} else {
		"Debug"
	}
}

fn ios_platform() -> &'static str {
	if std::env::var("CARGO_CFG_TARGET_ABI").as_deref() == Ok("sim") {
		"iphonesimulator"
	} else {
		"iphoneos"
	}
}

fn link_agora_ios_frameworks() {
	if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("ios") {
		return;
	}
	let frameworks = swift_products_dir();
	println!("cargo:rustc-link-search=framework={}", frameworks.display());
	let framework_names = [
		"AgoraRtcKit",
		"AgoraSoundTouch",
		"Agorafdkaac",
		"Agoraffmpeg",
		"aosl",
		"video_dec",
	];
	for framework in framework_names {
		println!("cargo:rustc-link-lib=framework={framework}");
	}
	// Xcode links and embeds these dynamic frameworks after Cargo produces the
	// Rust static archive. A stable project-relative handoff is required because
	// Cargo does not propagate an OUT_DIR framework path through that archive.
	// Include configuration and platform so concurrent Xcode builds never share
	// a mutable destination.
	let staging_key = format!("{}-{}", ios_configuration(), ios_platform());
	ios_build_support::stage_frameworks(
		&frameworks,
		std::path::Path::new("gen/apple/Frameworks"),
		&staging_key,
		&framework_names,
	)
	.unwrap_or_else(|error| {
		panic!(
			"failed to stage Agora frameworks from {}: {error}",
			frameworks.display()
		)
	});
}
