import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	existsAppDataFileMock,
	readAppDataFileMock,
	removeAppDataFileMock,
	writeAppDataFileAtomicMock,
} = vi.hoisted(() => ({
	existsAppDataFileMock: vi.fn(),
	readAppDataFileMock: vi.fn(),
	removeAppDataFileMock: vi.fn(),
	writeAppDataFileAtomicMock: vi.fn(),
}));

vi.mock(".", () => ({
	existsAppDataFile: existsAppDataFileMock,
	readAppDataFile: readAppDataFileMock,
	removeAppDataFile: removeAppDataFileMock,
	writeAppDataFileAtomic: writeAppDataFileAtomicMock,
}));

import {
	activateAccountSession,
	invalidateAccountSession,
} from "$lib/api/account-caches";
import {
	clearCacheManagerMemory,
	subscribeCacheUsage,
	writeCacheEntry,
} from "$lib/app-data/cache-manager";

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

beforeEach(() => {
	clearCacheManagerMemory();
	existsAppDataFileMock.mockReset().mockResolvedValue(false);
	readAppDataFileMock.mockReset();
	removeAppDataFileMock.mockReset().mockResolvedValue(undefined);
	writeAppDataFileAtomicMock.mockReset().mockResolvedValue(undefined);
	activateAccountSession(7001);
});

describe("cache write account fencing", () => {
	it("removes a file whose write finishes after account invalidation", async () => {
		const gate = deferred();
		writeAppDataFileAtomicMock.mockReturnValueOnce(gate.promise);
		const writing = writeCacheEntry(7001, "profile", "42", { value: true });
		await vi.waitFor(() =>
			expect(writeAppDataFileAtomicMock).toHaveBeenCalledOnce(),
		);
		const path = writeAppDataFileAtomicMock.mock.calls[0][0] as string;

		invalidateAccountSession();
		gate.resolve();
		await writing;

		expect(removeAppDataFileMock).toHaveBeenCalledWith(path);
		expect(writeAppDataFileAtomicMock).toHaveBeenCalledOnce();
	});

	it("does not start a write for an inactive account", async () => {
		invalidateAccountSession();

		await writeCacheEntry(7001, "inbox", "inbox", { value: true });

		expect(writeAppDataFileAtomicMock).not.toHaveBeenCalled();
	});
});

describe("cache usage subscription", () => {
	it("routes initial hydration failures to its error handler", async () => {
		const error = new Error("private filesystem failure");
		const listener = vi.fn();
		const onError = vi.fn();
		existsAppDataFileMock.mockRejectedValueOnce(error);

		const unsubscribe = subscribeCacheUsage(listener, onError);

		await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(error));
		expect(listener).not.toHaveBeenCalled();
		unsubscribe();
	});
});
