import { describe, expect, it, vi } from "vitest";

import {
	demoDrawerMedia,
	demoUploadChatMedia,
	resetDemoObjectUrls,
} from "$lib/demo/mock/conversations";
import { ObjectUrlRegistry } from "$lib/demo/object-url-registry";

describe("ObjectUrlRegistry", () => {
	it("revokes each owned URL exactly once across deletion, consumption, and reset", () => {
		const revoke = vi.fn();
		const registry = new ObjectUrlRegistry(revoke);
		registry.add("blob:a");
		registry.add("blob:b");
		registry.release("blob:a");
		registry.release("blob:a");
		registry.clear();
		registry.clear();
		expect(revoke.mock.calls).toEqual([["blob:a"], ["blob:b"]]);
	});

	it("reset removes uploaded drawer records and revokes their URL exactly once", () => {
		const create = vi
			.spyOn(URL, "createObjectURL")
			.mockReturnValue("blob:drawer-reset");
		const revoke = vi
			.spyOn(URL, "revokeObjectURL")
			.mockImplementation(() => {});
		const uploaded = demoUploadChatMedia(new Uint8Array([1]), "image/jpeg");
		expect(demoDrawerMedia().some((item) => item.id === uploaded.mediaId)).toBe(
			true,
		);
		resetDemoObjectUrls();
		resetDemoObjectUrls();
		expect(demoDrawerMedia().some((item) => item.id === uploaded.mediaId)).toBe(
			false,
		);
		expect(revoke).toHaveBeenCalledOnce();
		expect(revoke).toHaveBeenCalledWith("blob:drawer-reset");
		create.mockRestore();
		revoke.mockRestore();
	});
});
