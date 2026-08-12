import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchRestMock, jsonParsedMock } = vi.hoisted(() => ({
	fetchRestMock: vi.fn(),
	jsonParsedMock: vi.fn(),
}));

vi.mock("$lib/api", () => ({ fetchRest: fetchRestMock }));

import { getExpiringVideoStatus } from "$lib/api/messaging/expiring-videos";

describe("expiring video availability", () => {
	beforeEach(() => {
		fetchRestMock.mockReset();
		jsonParsedMock.mockReset();
		fetchRestMock.mockResolvedValue({ jsonParsed: jsonParsedMock });
	});

	it("uses the official availability endpoint and validates its count", async () => {
		jsonParsedMock.mockImplementation((schema) =>
			schema.parse({ available: 2 }),
		);

		await expect(getExpiringVideoStatus()).resolves.toEqual({ available: 2 });
		expect(fetchRestMock).toHaveBeenCalledWith("/v4/videos/expiring/status", {
			method: "GET",
		});
	});

	it("rejects negative availability", async () => {
		jsonParsedMock.mockImplementation((schema) =>
			schema.parse({ available: -1 }),
		);

		await expect(getExpiringVideoStatus()).rejects.toThrow();
	});
});
