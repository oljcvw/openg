import { readFileSync, writeFileSync } from "node:fs";

const inventoryPath = "lib/apk-endpoints-26.13.0-170510.tsv";
const outputPath = "content/grindr-api/endpoint-source-index.md";

function decode(value: string): string {
	if (value.startsWith('"') && value.endsWith('"')) {
		return value.slice(1, -1).replaceAll('""', '"');
	}
	return value;
}

const rows = readFileSync(inventoryPath, "utf8")
	.trimEnd()
	.split("\n")
	.slice(1)
	.map((line) => {
		const [
			method,
			rawPath,
			service,
			source,
			start,
			end,
			classification,
			confidence,
		] = line.split("\t").map(decode);
		const path =
			rawPath.startsWith("/") ||
			rawPath.startsWith("<") ||
			/^https?:/i.test(rawPath)
				? rawPath
				: `/${rawPath}`;
		return {
			method,
			path,
			service,
			source,
			start,
			end,
			classification,
			confidence,
		};
	});

const firstParty = rows.filter(
	(row) => row.classification === "first-party/Grindr",
);
const thirdParty = rows.filter(
	(row) => row.classification !== "first-party/Grindr",
);
const methodCounts = new Map<string, number>();
for (const row of rows)
	methodCounts.set(row.method, (methodCounts.get(row.method) ?? 0) + 1);

function table(title: string, entries: typeof rows): string[] {
	const lines = [
		`## ${title}`,
		"",
		"| Method | Declared path | Retrofit service | APK source confirmation | Confidence |",
		"| --- | --- | --- | --- | --- |",
	];
	for (const row of entries) {
		const sourceLines =
			row.start === row.end ? row.start : `${row.start}-${row.end}`;
		lines.push(
			`| \`${row.method}\` | \`${row.path}\` | \`${row.service}\` | \`${row.source}:${sourceLines}\` | ${row.confidence} |`,
		);
	}
	return [...lines, ""];
}

const counts = [...methodCounts.entries()]
	.sort(([a], [b]) => a.localeCompare(b))
	.map(([method, count]) => `\`${method}\` ${count}`)
	.join(", ");

const output = [
	"# APK endpoint source index",
	"",
	"Complete static Retrofit declaration inventory for Grindr Android `26.13.0`",
	"(`170510`), extracted from the pinned JADX output. Every row cites the",
	"annotation and method-signature lines that confirm it in the original APK's",
	"decompiled source. Paths are normalized with a leading slash for comparison;",
	"the source citation preserves where the literal declaration can be inspected.",
	"",
	`Inventory: **${rows.length} declarations** in **78 service files** — ${counts}.`,
	`Of these, **${firstParty.length}** use Grindr/first-party service configuration and`,
	`**${thirdParty.length}** use separately configured third-party services. Duplicate`,
	"method/path rows are retained when more than one service declaration confirms the",
	"same route. This makes later APK diffs sensitive to service moves and aliases.",
	"",
	"> [!IMPORTANT]",
	"> Static declaration proves that this APK can construct the request. It does not",
	"> prove that the server currently enables the route, that an account is eligible,",
	"> or that the decompiled request/response model is complete.",
	"",
	"Seven declarations use Retrofit `@Url`, so their final URL is supplied at runtime:",
	"two ad-block detection `HEAD` probes, three login `POST` declarations, and two",
	"session-refresh `POST` declarations. They are listed as `<dynamic @Url or empty>`",
	"and require call-site tracing for any concrete target.",
	"",
	...table("Grindr and first-party endpoints", firstParty),
	...table("Third-party endpoints", thirdParty),
	"## WebSocket and configured bases",
	"",
	"Retrofit annotations do not cover WebSocket construction. The app contains",
	"`wss://grindr.mobi/v1/ws` at `sources/p000/ggc.java:52`; construction and the",
	"`Grindr3` authorization header are visible at `sources/p000/dgc.java:22-25`.",
	"Network configuration also defines `wss://presence.grindr.com:443` and the REST,",
	"CDN, Spotify, Giphy, and Jira bases at `sources/p000/gh0.java:184-189`.",
	"",
	"## Reproduction and limits",
	"",
	"The inventory is derived only from Retrofit method annotations in",
	"`jadx-src-nores/sources`. It includes ordinary `GET`, `POST`, `PUT`, `DELETE`,",
	"`PATCH`, and `HEAD` annotations plus six body-bearing deletes expressed with",
	'`@HTTP(method = "DELETE")`. Literal URLs constructed through OkHttp, WebView,',
	"native code, reflection, or remote configuration are outside this table unless",
	"called out above.",
	"",
	"JADX completed `40488/40491` classes with 972 reported decompilation errors.",
	"Therefore absence from this index is not proof that no request path exists.",
	"No APK was run and no endpoint was called during this audit.",
	"",
].join("\n");

writeFileSync(outputPath, output);
console.log(
	`Generated ${outputPath} with ${rows.length} source-confirmed declarations.`,
);
