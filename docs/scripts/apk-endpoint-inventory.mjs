#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");
const defaultSourceDir = resolve(
	repoRoot,
	"grindrapp/decompiled/jadx-src-nores/sources",
);

const args = process.argv.slice(2);
let sourceDir = defaultSourceDir;
let format = "markdown";

for (let index = 0; index < args.length; index += 1) {
	const arg = args[index];

	if (arg === "--source-dir") {
		sourceDir = resolve(process.cwd(), args[index + 1] ?? "");
		index += 1;
		continue;
	}

	if (arg === "--format") {
		format = args[index + 1] ?? format;
		index += 1;
		continue;
	}

	if (arg === "--help" || arg === "-h") {
		console.log(`Usage: bun scripts/apk-endpoint-inventory.mjs [options]

Options:
  --source-dir <path>   JADX source directory to scan
  --format <format>     markdown or json
  --help                Show this help
`);
		process.exit(0);
	}

	console.error(`Unknown argument: ${arg}`);
	process.exit(2);
}

if (!["json", "markdown"].includes(format)) {
	console.error(`Unsupported format: ${format}`);
	process.exit(2);
}

if (!existsSync(sourceDir)) {
	console.error(`Source directory not found: ${sourceDir}`);
	process.exit(1);
}

const annotationPattern = /@(GET|POST|PUT|PATCH|DELETE)\("([^"]+)"\)/g;
const genericHttpPattern = /@HTTP\(([^)]*)\)/g;

const endpointRows = [];

for (const filePath of walkJavaFiles(sourceDir)) {
	const content = readFileSync(filePath, "utf8");
	const lines = content.split(/\r?\n/);

	for (const [lineIndex, line] of lines.entries()) {
		annotationPattern.lastIndex = 0;
		genericHttpPattern.lastIndex = 0;

		for (const match of line.matchAll(annotationPattern)) {
			endpointRows.push({
				method: match[1],
				path: normalizeEndpointPath(match[2]),
				source: `${relative(sourceDir, filePath)}:${lineIndex + 1}`,
			});
		}

		for (const match of line.matchAll(genericHttpPattern)) {
			const method = match[1].match(/method\s*=\s*"([^"]+)"/)?.[1];
			const path = match[1].match(/path\s*=\s*"([^"]+)"/)?.[1];

			if (!method || !path) {
				continue;
			}

			endpointRows.push({
				method: method.toUpperCase(),
				path: normalizeEndpointPath(path),
				source: `${relative(sourceDir, filePath)}:${lineIndex + 1}`,
			});
		}
	}
}

endpointRows.sort((left, right) => {
	const pathOrder = left.path.localeCompare(right.path);
	if (pathOrder !== 0) {
		return pathOrder;
	}

	const methodOrder = left.method.localeCompare(right.method);
	if (methodOrder !== 0) {
		return methodOrder;
	}

	return left.source.localeCompare(right.source);
});

if (format === "json") {
	console.log(JSON.stringify({ sourceDir, endpoints: endpointRows }, null, 2));
	process.exit(0);
}

const methodCounts = endpointRows.reduce((counts, endpoint) => {
	counts[endpoint.method] = (counts[endpoint.method] ?? 0) + 1;
	return counts;
}, {});

console.log("# APK Retrofit Endpoint Inventory\n");
console.log(`Source: \`${relative(repoRoot, sourceDir) || sourceDir}\``);
console.log(`Total endpoint annotations: ${endpointRows.length}\n`);
console.log("Method counts:\n");

for (const method of Object.keys(methodCounts).sort()) {
	console.log(`- ${method}: ${methodCounts[method]}`);
}

console.log("\n| Method | Path | Source |");
console.log("| --- | --- | --- |");

for (const endpoint of endpointRows) {
	console.log(
		`| ${endpoint.method} | \`${endpoint.path}\` | \`${endpoint.source}\` |`,
	);
}

function normalizeEndpointPath(path) {
	if (
		path.startsWith("/") ||
		path.startsWith("http://") ||
		path.startsWith("https://")
	) {
		return path;
	}

	return `/${path}`;
}

function walkJavaFiles(root) {
	const entries = readdirSync(root, { withFileTypes: true })
		.sort((left, right) => left.name.localeCompare(right.name));
	const files = [];

	for (const entry of entries) {
		const entryPath = resolve(root, entry.name);

		if (entry.isDirectory()) {
			files.push(...walkJavaFiles(entryPath));
			continue;
		}

		if (entry.isFile() && entry.name.endsWith(".java")) {
			files.push(entryPath);
			continue;
		}

		if (!entry.isSymbolicLink()) {
			continue;
		}

		const stats = statSync(entryPath);
		if (stats.isDirectory()) {
			files.push(...walkJavaFiles(entryPath));
		} else if (stats.isFile() && entry.name.endsWith(".java")) {
			files.push(entryPath);
		}
	}

	return files;
}
