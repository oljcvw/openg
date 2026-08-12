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
	.expect("failed to build Tauri application metadata")
}
