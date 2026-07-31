import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
	invokeMock: vi.fn<() => Promise<void>>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
	invoke: invokeMock,
}));

import {
	mediaSurface,
	networkMediaOrigin,
	registerMediaOriginLogging,
	reportMediaOrigin,
} from "./media-origin-logging";

beforeEach(() => {
	invokeMock.mockReset();
	invokeMock.mockResolvedValue();
	window.history.replaceState({}, "", "/chat/private-conversation-id");
});

afterEach(() => {
	document.body.replaceChildren();
});

describe("media origin logging privacy boundary", () => {
	it("keeps only the canonical HTTPS origin", () => {
		expect(
			networkMediaOrigin(
				"https://user:secret@example.com:8443/private/id?token=secret#fragment",
			),
		).toBe("https://example.com:8443");
	});

	it("rejects non-network and insecure media sources", () => {
		expect(networkMediaOrigin("blob:https://example.com/id")).toBeNull();
		expect(networkMediaOrigin("data:image/png;base64,AAAA")).toBeNull();
		expect(networkMediaOrigin("http://example.com/image.jpg")).toBeNull();
	});

	it("categorizes routes without retaining path parameters", () => {
		expect(mediaSurface("/albums/123")).toBe("albums");
		expect(mediaSurface("/chat/456")).toBe("chat");
		expect(mediaSurface("/profile/789")).toBe("profile");
		expect(mediaSurface("/right-now")).toBe("right_now");
		expect(mediaSurface("/")).toBe("browse");
		expect(mediaSurface("/settings/app")).toBe("other");
	});

	it("reports a connected media event with only its canonical origin and fixed categories", () => {
		const release = registerMediaOriginLogging();
		const image = document.createElement("img");
		image.src =
			"https://d-connected.cloudfront.net/private/media-id?Policy=signed#fragment";
		document.body.append(image);

		image.dispatchEvent(new Event("load"));

		expect(invokeMock).toHaveBeenCalledWith("report_media_origin", {
			observation: {
				origin: "https://d-connected.cloudfront.net",
				elementKind: "image",
				outcome: "loaded",
				surface: "chat",
			},
		});
		expect(JSON.stringify(invokeMock.mock.calls)).not.toContain("media-id");
		expect(JSON.stringify(invokeMock.mock.calls)).not.toContain("Policy");
		release();
	});

	it("deduplicates exact tuples while retaining outcome and surface distinctions", () => {
		const release = registerMediaOriginLogging();
		const image = document.createElement("img");
		image.src = "https://d-dedupe.cloudfront.net/media?signature=private";
		document.body.append(image);

		image.dispatchEvent(new Event("load"));
		image.dispatchEvent(new Event("load"));
		image.dispatchEvent(new Event("error"));
		window.history.replaceState({}, "", "/albums/private-album-id");
		image.dispatchEvent(new Event("error"));

		expect(invokeMock).toHaveBeenCalledTimes(3);
		release();
	});

	it("removes global listeners during cleanup", () => {
		const release = registerMediaOriginLogging();
		release();
		const image = document.createElement("img");
		image.src = "https://d-cleanup.cloudfront.net/private";
		document.body.append(image);

		image.dispatchEvent(new Event("load"));

		expect(invokeMock).not.toHaveBeenCalled();
	});

	it("swallows diagnostics IPC failures and permits a later retry", async () => {
		invokeMock.mockRejectedValue(new Error("diagnostics unavailable"));

		reportMediaOrigin(
			"https://d-ipc-failure.cloudfront.net/private?token=secret",
			"image",
			"failed",
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		reportMediaOrigin(
			"https://d-ipc-failure.cloudfront.net/private?token=secret",
			"image",
			"failed",
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(invokeMock).toHaveBeenCalledTimes(2);
	});

	it("lets detached media use the same sanitized reporter and dedupe path", () => {
		const privateUrl =
			"https://d-detached.cloudfront.net/private/media-id?Signature=secret";

		reportMediaOrigin(privateUrl, "video", "failed");
		reportMediaOrigin(privateUrl, "video", "failed");

		expect(invokeMock).toHaveBeenCalledTimes(1);
		expect(invokeMock).toHaveBeenCalledWith("report_media_origin", {
			observation: {
				origin: "https://d-detached.cloudfront.net",
				elementKind: "video",
				outcome: "failed",
				surface: "chat",
			},
		});
		expect(JSON.stringify(invokeMock.mock.calls)).not.toContain("media-id");
		expect(JSON.stringify(invokeMock.mock.calls)).not.toContain("Signature");
	});
});
