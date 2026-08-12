import type { CDPSession, Page } from "@playwright/test";

export const DEMO_CONVERSATION = "/chat/100001:123456000";
export const DEMO_GEOHASH = "u33dc0cpgp00";

export async function ensureGridLocation(page: Page): Promise<void> {
	const allFilters = page.locator('[aria-label="All filters"]');
	if ((await allFilters.count()) === 0) {
		await page.keyboard.press("Meta+k");
		const palette = page.getByRole("combobox");
		await palette.waitFor();
		await palette.fill(`@${DEMO_GEOHASH}`);
		await page
			.locator(`[role="option"][data-value="@${DEMO_GEOHASH}"]`)
			.waitFor();
		await page.keyboard.press("Enter");
	}
	await allFilters.waitFor({ timeout: 60_000 });
}

export async function installTauriShim(
	page: Page,
	initialFiles: Record<string, number[]> = {},
): Promise<void> {
	await page.addInitScript((seedFiles) => {
		interface FsArgs {
			path?: string;
			oldPath?: string;
			newPath?: string;
		}
		interface InvokeOptions {
			headers?: Record<string, string>;
		}
		interface EventListenArgs {
			event: string;
			handler: number;
		}
		interface WsSendArgs {
			command?: { type?: string; ref_id?: string };
		}

		const files = new Map<string, Uint8Array>(
			Object.entries(seedFiles).map(([path, bytes]) => [
				path,
				new Uint8Array(bytes),
			]),
		);
		const callbacks = new Map<number, (value: unknown) => unknown>();
		const listeners = new Map<string, Set<number>>();
		let callbackId = 0;
		const emit = (event: string, payload: unknown) => {
			for (const handler of listeners.get(event) ?? [])
				callbacks.get(handler)?.({ event, id: handler, payload });
		};

		const invoke = (cmd: string, args?: unknown, opts?: unknown): unknown => {
			const fs = (args ?? {}) as FsArgs;
			const headers = ((opts ?? {}) as InvokeOptions).headers ?? {};

			if (cmd === "plugin:path|resolve_directory") return "/appdata";
			if (cmd === "plugin:event|listen") {
				const { event, handler } = args as EventListenArgs;
				const eventListeners = listeners.get(event) ?? new Set<number>();
				eventListeners.add(handler);
				listeners.set(event, eventListeners);
				return handler;
			}
			if (cmd === "plugin:event|unlisten") {
				const { event, eventId } = args as {
					event: string;
					eventId: number;
				};
				listeners.get(event)?.delete(eventId);
				callbacks.delete(eventId);
				return null;
			}
			if (cmd === "ws_send") {
				const { command } = args as WsSendArgs;
				if (command?.type && command.ref_id) {
					const event = `grindr:${command.type.replaceAll(".", "_")}_response`;
					queueMicrotask(() =>
						emit(event, {
							type: `${command.type}.response`,
							ref: command.ref_id,
							status: 200,
							payload: null,
						}),
					);
				}
				return null;
			}
			if (cmd === "plugin:fs|exists") return files.has(fs.path ?? "");
			if (cmd === "plugin:fs|read_file") {
				const data = files.get(fs.path ?? "");
				if (!data) throw new Error("ENOENT");
				return data;
			}
			if (cmd === "plugin:fs|mkdir") return null;
			if (cmd === "plugin:fs|rename") {
				const data = files.get(fs.oldPath ?? "");
				if (data) files.set(fs.newPath ?? "", data);
				files.delete(fs.oldPath ?? "");
				return null;
			}
			if (cmd === "plugin:fs|write_file") {
				const path = decodeURIComponent(headers.path ?? fs.path ?? "");
				files.set(path, args instanceof Uint8Array ? args : new Uint8Array());
				return null;
			}
			return null;
		};

		Object.assign(window, {
			__TAURI_OS_PLUGIN_INTERNALS__: {
				eol: "\n",
				platform: "macos",
				version: "15.0",
				family: "unix",
				os_type: "macos",
				arch: "aarch64",
				exe_extension: "",
			},
			__TAURI_INTERNALS__: {
				transformCallback: (callback: (value: unknown) => unknown) => {
					const id = ++callbackId;
					callbacks.set(id, callback);
					return id;
				},
				metadata: {
					currentWindow: { label: "main" },
					currentWebview: { label: "main" },
				},
				invoke: (cmd: string, args?: unknown, opts?: unknown) =>
					Promise.resolve(invoke(cmd, args, opts)),
			},
		});
	}, initialFiles);
}

export class TrustedTouch {
	constructor(private readonly cdp: CDPSession) {}

	static async attach(page: Page): Promise<TrustedTouch> {
		return new TrustedTouch(await page.context().newCDPSession(page));
	}

	private send(type: string, points: { x: number; y: number }[]) {
		return this.cdp.send("Input.dispatchTouchEvent", {
			type,
			touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: 1 })),
		} as never);
	}

	start(x: number, y: number) {
		return this.send("touchStart", [{ x, y }]);
	}

	move(x: number, y: number) {
		return this.send("touchMove", [{ x, y }]);
	}

	end() {
		return this.send("touchEnd", []);
	}

	async drag(
		page: Page,
		from: { x: number; y: number },
		to: { x: number; y: number },
		{ steps = 20, holdMs = 16, release = true } = {},
	) {
		await this.start(from.x, from.y);
		for (let i = 1; i <= steps; i++) {
			await this.move(
				from.x + ((to.x - from.x) * i) / steps,
				from.y + ((to.y - from.y) * i) / steps,
			);
			await page.waitForTimeout(holdMs);
		}
		if (release) await this.end();
	}
}

export async function wheel(
	page: Page,
	at: { x: number; y: number },
	deltaY: number,
	{ steps = 1, gapMs = 16 } = {},
) {
	await page.mouse.move(at.x, at.y);
	for (let i = 0; i < steps; i++) {
		await page.mouse.wheel(0, deltaY);
		await page.waitForTimeout(gapMs);
	}
}
