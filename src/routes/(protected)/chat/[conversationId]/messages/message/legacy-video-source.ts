import {
	getAccountSessionSnapshot,
	isAccountSessionCurrent,
} from "$lib/api/account-caches";
import { lookupDirectMedia } from "$lib/app-data/direct-media-cache";
import { importLegacyRetainedDirectMedia } from "$lib/app-data/direct-media-retention";
import {
	DEFAULT_DEVELOPER_SETTINGS,
	developerSettingsSchema,
	getDeveloperSettingsSnapshot,
} from "$lib/app-data/preferences.svelte";
import {
	cacheShortVideo,
	getCachedShortVideo,
	removeCachedShortVideo,
} from "$lib/app-data/short-video-cache";
import { toBase64 } from "$lib/util/base64";
import type { SharedMediaEntry } from "$lib/chat/shared-media";

const FIXED_MAXIMUM_BYTES = 128 * 1024 * 1024;

type Dependencies = {
	lookup: typeof lookupDirectMedia;
	readLegacy: typeof getCachedShortVideo;
	promote: typeof importLegacyRetainedDirectMedia;
	removeLegacy: typeof removeCachedShortVideo;
	getSession: typeof getAccountSessionSnapshot;
	isSessionCurrent: typeof isAccountSessionCurrent;
};

const defaultDependencies: Dependencies = {
	lookup: lookupDirectMedia,
	readLegacy: getCachedShortVideo,
	promote: importLegacyRetainedDirectMedia,
	removeLegacy: removeCachedShortVideo,
	getSession: getAccountSessionSnapshot,
	isSessionCurrent: isAccountSessionCurrent,
};

type RemoteFetchDependencies = {
	fetch: typeof fetch;
	cache: typeof cacheShortVideo;
	getSession: typeof getAccountSessionSnapshot;
	isSessionCurrent: typeof isAccountSessionCurrent;
	settings: () => {
		legacyShortVideoFetchMaxMb: number;
		legacyShortVideoFetchTimeoutMs: number;
	};
};

const defaultRemoteFetchDependencies: RemoteFetchDependencies = {
	fetch,
	cache: cacheShortVideo,
	getSession: getAccountSessionSnapshot,
	isSessionCurrent: isAccountSessionCurrent,
	settings: getDeveloperSettingsSnapshot,
};

function safeCdnUrl(value: string): string | null {
	try {
		const parsed = new URL(value);
		const host = parsed.hostname.toLowerCase();
		return parsed.protocol === "https:" &&
			(host === "cdns.grindr.com" || host.endsWith(".cloudfront.net"))
			? parsed.href
			: null;
	} catch {
		return null;
	}
}

/** Bounded legacy browser-cache fill. Any failure falls back to a validated URL. */
export async function resolveBoundedLegacyRemoteVideo(
	url: string,
	mediaId: number,
	dependencies: RemoteFetchDependencies = defaultRemoteFetchDependencies,
): Promise<string | null> {
	const fallback = safeCdnUrl(url);
	if (fallback === null || !Number.isSafeInteger(mediaId) || mediaId < 0)
		return null;
	const session = dependencies.getSession();
	if (session.accountId === null) return fallback;
	const parsedSettings = developerSettingsSchema.safeParse(
		dependencies.settings(),
	);
	const settings = parsedSettings.success
		? parsedSettings.data
		: DEFAULT_DEVELOPER_SETTINGS;
	const maximumBytes = Math.min(
		settings.legacyShortVideoFetchMaxMb * 1024 * 1024,
		FIXED_MAXIMUM_BYTES,
	);
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(),
		settings.legacyShortVideoFetchTimeoutMs,
	);
	try {
		const response = await dependencies.fetch(fallback, {
			signal: controller.signal,
			redirect: "error",
		});
		if (response.status !== 200) return fallback;
		const contentType = response.headers.get("content-type")?.split(";", 1)[0];
		if (contentType?.toLowerCase() !== "video/mp4") return fallback;
		const declaredHeader = response.headers.get("content-length");
		if (declaredHeader !== null) {
			const declaredLength = Number(declaredHeader);
			if (
				!Number.isSafeInteger(declaredLength) ||
				declaredLength < 0 ||
				declaredLength > maximumBytes
			)
				return fallback;
		}
		if (!response.body) return fallback;
		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let byteLength = 0;
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			byteLength += value.byteLength;
			if (byteLength > maximumBytes) {
				await reader.cancel();
				return fallback;
			}
			chunks.push(value);
		}
		const bytes = new Uint8Array(byteLength);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		const dataBase64 = toBase64(bytes);
		if (!dependencies.isSessionCurrent(session)) return null;
		await dependencies.cache(mediaId, dataBase64, session.accountId);
		return dependencies.isSessionCurrent(session)
			? `data:${contentType};base64,${dataBase64}`
			: null;
	} catch {
		return fallback;
	} finally {
		clearTimeout(timeout);
	}
}

function isValidatedVideoIdentity(
	entry: SharedMediaEntry,
	mediaId: number,
): boolean {
	return (
		Number.isSafeInteger(entry.accountProfileId) &&
		entry.accountProfileId >= 0 &&
		entry.conversationId.length > 0 &&
		Number.isSafeInteger(entry.peerProfileId) &&
		entry.peerProfileId >= 0 &&
		entry.messageId.length > 0 &&
		Number.isSafeInteger(mediaId) &&
		mediaId >= 0 &&
		entry.mediaId === String(mediaId) &&
		entry.kind === "video" &&
		(entry.messageType === "Video" ||
			entry.messageType === "PrivateVideo" ||
			entry.messageType === "NonExpiringVideo")
	);
}

/**
 * Resolves an old Android short-video entry only after its complete message
 * identity has been validated. Promotion uses that identity and the validated
 * remote URL; the legacy bytes remain the fallback unless promotion succeeds.
 */
export async function resolveLegacyShortVideo(
	entry: SharedMediaEntry,
	mediaId: number,
	dependencies: Dependencies = defaultDependencies,
): Promise<string | null> {
	if (!isValidatedVideoIdentity(entry, mediaId)) return null;
	const session = dependencies.getSession();
	if (session.accountId !== entry.accountProfileId) return null;

	const legacy = await dependencies
		.readLegacy(mediaId, entry.accountProfileId)
		.catch(() => null);
	if (!dependencies.isSessionCurrent(session)) return null;
	if (!legacy?.found) {
		const current = await dependencies.lookup(entry).catch(() => null);
		return dependencies.isSessionCurrent(session) && current?.found
			? current.protocolUrl
			: null;
	}
	const legacyUrl = `data:${legacy.contentType};base64,${legacy.dataBase64}`;

	const promoted = await dependencies
		.promote(entry, legacy.contentType, legacy.dataBase64, legacy.byteLength)
		.catch(() => null);
	if (!dependencies.isSessionCurrent(session)) return null;
	if (promoted === null) return legacyUrl;
	await dependencies
		.removeLegacy(mediaId, entry.accountProfileId)
		.catch(() => false);
	return dependencies.isSessionCurrent(session) ? promoted : null;
}
