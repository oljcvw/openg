import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchRestMock } = vi.hoisted(() => ({ fetchRestMock: vi.fn() }));

vi.mock("$lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/api")>()),
	fetchRest: fetchRestMock,
}));

import { getRightNowFeedV4 } from "./right-now";

beforeEach(() => fetchRestMock.mockReset());

describe("Right Now API", () => {
	it("encodes all supported feed filters, including hosting=false", async () => {
		const body = { items: [], viewerCount: 3 };
		fetchRestMock.mockResolvedValue({
			jsonParsed: vi.fn((schema: { parse(value: unknown): unknown }) =>
				Promise.resolve(schema.parse(body)),
			),
		});

		await expect(
			getRightNowFeedV4({
				sort: "NEWEST",
				hosting: false,
				sexualPositions: [1, -1],
				ageMin: 25,
				ageMax: 40,
			}),
		).resolves.toEqual(body);

		expect(fetchRestMock).toHaveBeenCalledWith(
			"/v4/rightnow/feed?sort=NEWEST&hosting=false&sexualPositions=1%2C-1&ageMin=25&ageMax=40",
		);
	});
});
