#!/usr/bin/env bun
import { $ } from "bun";
import path from "path";

const TOOLING = {
	aab: {
		binaries: ["jarsigner", "keytool", "unzip"],
		shell: "nix develop .#play",
		rewrites: true,
	},
	apk: {
		binaries: ["apksigner", "minisign"],
		shell: "nix develop .#android",
		rewrites: true,
	},
	deb: { binaries: ["minisign"], shell: "nix develop", rewrites: false },
	AppImage: { binaries: ["minisign"], shell: "nix develop", rewrites: false },
	exe: { binaries: ["minisign"], shell: "nix develop", rewrites: false },
	zip: { binaries: ["minisign"], shell: "nix develop", rewrites: false },
};
type Artifact = keyof typeof TOOLING;

const input = process.argv[2];
const artifact = Object.keys(TOOLING).find((kind) =>
	input?.endsWith(`.${kind}`),
) as Artifact | undefined;
if (!input || !artifact) {
	console.error(
		`usage: sign.ts <${Object.keys(TOOLING)
			.map((kind) => `release.${kind}`)
			.join(" | ")}> [out]`,
	);
	console.error(
		"  OPEN_GRIND_MINISIGN_KEY overrides ~/.minisign/minisign.key",
	);
	process.exit(2);
}

const output =
	process.argv[3] ??
	path.join(
		path.dirname(input),
		path.basename(input).replace(/-unsigned(\.[^.]+)$/, "$1"),
	);

const tooling = TOOLING[artifact];
if (tooling.rewrites && output === input) {
	console.error(
		`signing rewrites ${path.basename(input)} in place, pass [out]`,
	);
	process.exit(2);
}
for (const binary of tooling.binaries) {
	if (!Bun.which(binary)) {
		console.error(`${binary} not found, run inside '${tooling.shell}'`);
		process.exit(1);
	}
}

const home = process.env.HOME ?? "~";
const untilde = (p: string) => p.replace(/^~/, home);

const releaseKey = (
	await Bun.file(path.join(import.meta.dir, "..", "KEYS.md")).text()
)
	.split("\n")
	.map((line) => line.trim())
	.find((line) => line.startsWith("RW") && line.length === 56);
if (!releaseKey) {
	throw new Error("KEYS.md publishes no minisign release key");
}

async function keystore(variable: string) {
	const propertiesPath = process.env[variable];
	if (!propertiesPath) {
		throw new Error(`${variable} is not set`);
	}
	const properties = new Map(
		await Bun.file(propertiesPath)
			.text()
			.then((s) =>
				s
					.split("\n")
					.filter((line) => line.includes("="))
					.map((line) => {
						const separator = line.indexOf("=");
						return [
							line.slice(0, separator).trim(),
							line.slice(separator + 1).trim(),
						];
					}),
			),
	);
	const store = properties.get("storeFile");
	const alias = properties.get("keyAlias");
	const password = properties.get("password");
	if (!store || !alias || !password) {
		throw new Error(
			"keystore properties must include storeFile, keyAlias and password",
		);
	}
	return { store: untilde(store), alias, password };
}

async function signApk(input: string, output: string) {
	const { store, alias, password } = await keystore(
		"OPEN_GRIND_KEYSTORE_PROPERTIES",
	);
	const signed = Bun.spawnSync(
		[
			"apksigner",
			"sign",
			"--alignment-preserved",
			"--ks",
			store,
			"--ks-key-alias",
			alias,
			"--ks-pass",
			`pass:${password}`,
			"--key-pass",
			`pass:${password}`,
			"--out",
			output,
			input,
		],
		{ stdio: ["inherit", "inherit", "inherit"] },
	);
	if (signed.exitCode !== 0) {
		throw new Error(`apksigner exited ${signed.exitCode}`);
	}
	const verify = await $`apksigner verify --print-certs ${output}`.text();
	const fingerprint = verify
		.split("\n")
		.find((line) => line.includes("SHA-256"));
	if (!fingerprint) {
		throw new Error("no certificate fingerprint in verify output");
	}
	console.log(fingerprint);
	console.log(`signed: ${output}`);
}

async function bundleEntries(bundle: string) {
	const listing = await $`unzip -v ${bundle}`.text();
	return listing
		.split("\n")
		.map((line) =>
			line.match(
				/^\s*(\d+)\s+\S+\s+\d+\s+\S+\s+\S+\s+\S+\s+([0-9a-f]{8})\s+(.+)$/,
			),
		)
		.filter((match) => match !== null)
		.map(([, length, crc, name]) => `${name} ${length} ${crc}`)
		.filter((entry) => !/^META-INF\/[^/]+\.(MF|SF|RSA|DSA|EC) /.test(entry))
		.sort();
}

async function signAab(input: string, output: string) {
	const { store, alias, password } = await keystore(
		"OPEN_GRIND_PLAY_KEYSTORE_PROPERTIES",
	);
	const signed = Bun.spawnSync(
		[
			"jarsigner",
			"-keystore",
			store,
			"-storepass:env",
			"KEYSTORE_PASSWORD",
			"-keypass:env",
			"KEYSTORE_PASSWORD",
			"-sigalg",
			"SHA256withRSA",
			"-digestalg",
			"SHA-256",
			"-signedjar",
			output,
			input,
			alias,
		],
		{
			env: { ...process.env, KEYSTORE_PASSWORD: password },
			stdio: ["inherit", "inherit", "inherit"],
		},
	);
	if (signed.exitCode !== 0) {
		throw new Error(`jarsigner exited ${signed.exitCode}`);
	}
	const [unsigned, withSignature] = await Promise.all([
		bundleEntries(input),
		bundleEntries(output),
	]);
	if (
		unsigned.length === 0 ||
		unsigned.join("\n") !== withSignature.join("\n")
	) {
		throw new Error("signing changed the bundle beyond its signature");
	}
	const certificate = await $`keytool -printcert -jarfile ${output}`.text();
	const fingerprint = certificate
		.split("\n")
		.find((line) => line.trim().startsWith("SHA256:"));
	if (!fingerprint) {
		throw new Error("no certificate fingerprint in keytool output");
	}
	console.log(fingerprint.trim());
	console.log(`${unsigned.length} entries unchanged, signed: ${output}`);
}

async function minisign(file: string) {
	const secret = process.env.OPEN_GRIND_MINISIGN_KEY;
	const signature = Bun.spawnSync(
		[
			"minisign",
			"-S",
			...(secret ? ["-s", untilde(secret)] : []),
			"-m",
			file,
		],
		{ stdio: ["inherit", "inherit", "inherit"] },
	);
	if (signature.exitCode !== 0) {
		throw new Error(`minisign exited ${signature.exitCode}`);
	}

	const verified = await $`minisign -Vm ${file} -P ${releaseKey}`.text();
	console.log(verified.trim());
	console.log(`signed: ${file}.minisig`);
}

if (artifact === "aab") {
	await signAab(input, output);
} else {
	if (artifact === "apk") {
		await signApk(input, output);
	}
	await minisign(output);
}
