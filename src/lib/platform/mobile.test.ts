import { describe, expect, it } from "vitest";
import { getPlatformFlags } from "$lib/platform/mobile";

describe("getPlatformFlags", () => {
	it("marks Android as the first-class mobile platform", () => {
		expect(getPlatformFlags("android")).toEqual({
			current: "android",
			isAndroid: true,
			isIos: false,
			isMobile: true,
		});
	});

	it("keeps iOS mobile without treating it as Android", () => {
		expect(getPlatformFlags("ios")).toEqual({
			current: "ios",
			isAndroid: false,
			isIos: true,
			isMobile: true,
		});
	});

	it("does not classify desktop platforms as mobile", () => {
		expect(getPlatformFlags("macos")).toEqual({
			current: "macos",
			isAndroid: false,
			isIos: false,
			isMobile: false,
		});
	});
});
