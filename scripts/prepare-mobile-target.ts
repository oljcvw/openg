import { createHash } from "node:crypto";
import {
	cpSync,
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	rmSync,
	statSync,
	unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const generatedRoot = join(root, "src-tauri", "gen");
mkdirSync(generatedRoot, { recursive: true });

function run(command: string, args: string[]): void {
	const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(
			`${command} ${args.join(" ")} exited with ${result.status}`,
		);
	}
}

function prepareAndroid(): void {
	const source = join(root, "src-tauri", "android");
	const target = join(generatedRoot, "android");
	rmSync(target, { recursive: true, force: true });
	run("bun", [
		"run",
		"tauri",
		"android",
		"init",
		"--ci",
		"--skip-targets-install",
	]);
	cpSync(source, target, {
		force: true,
		preserveTimestamps: true,
		recursive: true,
	});

	const wrapper = join(target, "gradle", "wrapper", "gradle-wrapper.jar");
	const digest = createHash("sha256")
		.update(readFileSync(wrapper))
		.digest("hex");
	const expected =
		"7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172";
	if (digest !== expected) {
		throw new Error(`Unexpected Gradle wrapper digest: ${digest}`);
	}
	if ((statSync(join(target, "gradlew")).mode & 0o111) === 0) {
		throw new Error("Canonical Android Gradle wrapper is not executable");
	}
	run("bash", ["scripts/gen-icons.sh"]);
}

function prepareIos(): void {
	const target = join(generatedRoot, "apple");
	rmSync(target, { recursive: true, force: true });
	run("bash", ["scripts/gen-icons.sh"]);
	run("bun", ["run", "tauri", "ios", "init", "--ci", "--skip-targets-install"]);
	if (!existsSync(join(target, "open-grind.xcodeproj", "project.pbxproj"))) {
		throw new Error(
			"Tauri iOS initialization did not create the Xcode project",
		);
	}
}

const platform = process.argv[2];
if (!platform || !["android", "ios", "all"].includes(platform)) {
	console.error(
		"Usage: bun scripts/prepare-mobile-target.ts <android|ios|all>",
	);
	process.exit(2);
}

const lockPath = join(generatedRoot, ".prepare.lock");
let lock: number;
try {
	lock = openSync(lockPath, "wx");
} catch {
	throw new Error(`Mobile target preparation already active: ${lockPath}`);
}

try {
	run("bun", ["run", "vendor:tauri-codegen"]);
	if (platform === "android" || platform === "all") prepareAndroid();
	if (platform === "ios" || platform === "all") prepareIos();
} finally {
	closeSync(lock);
	unlinkSync(lockPath);
}
