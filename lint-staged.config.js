const isVendoredWry = (file) => file.includes("/src-tauri/patches/wry/");
const quoted = (files) => files.map((file) => JSON.stringify(file)).join(" ");
const firstPartyFiles = (files) => files.filter((file) => !isVendoredWry(file));

const formatFirstParty = (command) => (files) => {
	const targets = firstPartyFiles(files);
	return targets.length === 0 ? [] : `${command} ${quoted(targets)}`;
};

// Functions keep exact vendored Wry source outside first-party formatters while
// retaining crate-wide Clippy coverage for the patched dependency integration.
export default {
	"*.{js,mjs,ts,svelte}": [
		formatFirstParty("prettier --write"),
		formatFirstParty("eslint --fix --no-warn-ignored"),
	],
	"*.{json,jsonc,md,yml,yaml,css,html}": formatFirstParty("prettier --write"),
	"docs/**/*.md": "bun run --cwd docs lint:markdown:staged --",
	"*.sh": "shellcheck",
	"*.rs": (files) => {
		const targets = firstPartyFiles(files);
		return [
			// Not in rustfmt.toml: `cargo fmt` needs mod-following to reach the whole crate
			...(targets.length === 0
				? []
				: [`rustfmt --config skip_children=true ${quoted(targets)}`]),
			// Errors only, like eslint: tasks see staged content, so -D warnings would
			// block a partial commit over warnings a later commit fixes
			"cargo clippy --manifest-path src-tauri/Cargo.toml --lib --all-targets",
		];
	},
};
