import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { dirname } from "path";

import { loadContext, SKIP_TAGS } from "./generator/context";
import { renderSharedPage, renderTagPage } from "./generator/pages";
import { renderSidebar } from "./generator/sidebar";
import { tagFilePath } from "./generator/slugs";

const OUT_DIR = "content/generated/grindr-api";
const SIDEBAR_PATH = ".generated/sidebar.ts";

function writeFile(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
}

const ctx = loadContext("lib/openapi.json");
rmSync(OUT_DIR, { force: true, recursive: true });
const realTagNames = new Set(ctx.doc.tags.map((t) => t.name));
let written = 0;

for (const t of ctx.doc.tags) {
	if (SKIP_TAGS.has(t.name)) continue;
	writeFile(tagFilePath(OUT_DIR, t.name), renderTagPage(ctx, t.name));
	written++;
}

for (const pageName of ctx.schemasByPage.keys()) {
	if (realTagNames.has(pageName)) continue;
	if ((ctx.schemasByPage.get(pageName) || []).length === 0) continue;
	writeFile(tagFilePath(OUT_DIR, pageName), renderSharedPage(ctx, pageName));
	written++;
}

writeFile(SIDEBAR_PATH, renderSidebar(ctx));
mkdirSync("content/public", { recursive: true });
copyFileSync("lib/openapi.json", "content/public/openapi.json");
for (const layout of ["1x6", "2x3", "3x2"]) {
	copyFileSync(
		`../contrib/app-screenshots-${layout}.avif`,
		`content/public/app-screenshots-${layout}.avif`,
	);
}
console.log(`Generated ${written} markdown files + sidebar.`);
