import { demoMeProfileId } from "./config";
import {
	demoAlbumContent,
	demoAlbumLimits,
	demoAlbumSharesFor,
	demoAlbumsSharedByProfile,
	demoConversationMessages,
	demoConversations,
	demoCreateAlbum,
	demoDeleteAlbum,
	demoDeleteAlbumContent,
	demoDeleteConversation,
	demoDrawerMedia,
	demoMyAlbums,
	demoRenameAlbum,
	demoReorderAlbumContent,
	demoSentMessage,
	demoSetConversationMuted,
	demoSetConversationPinned,
	demoShareAlbum,
	demoSingleMessage,
	demoUnshareAlbum,
} from "./mock/conversations";
import {
	buildFullProfile,
	buildShortProfile,
	demoCascadeV4,
	demoGetProfiles,
	demoMyUploadedPhotos,
	demoSearchProfiles,
	num,
} from "./mock/grid";
import { demoReceivedTaps, demoViews } from "./mock/interest";
import { meSeed, profileSeed } from "./mock/profiles";
import { demoGenders, demoPronouns, demoTags } from "./mock/reference";
import { demoRightNowFeed } from "./mock/right-now";

type DemoResponse = { status: number; body: unknown };

let demoAccountPreferences = {
	profileId: demoMeProfileId,
	locationSearchOptOut: false,
	incognito: false,
	hideViewedMe: false,
	approximateDistance: true,
	viewRightNowNsfw: false,
	showOnMap: true,
	mapLocationFuzzRadius: null,
};
let demoBlockedProfiles = [
	{ profileId: 1002, blockedTime: Date.now() - 86_400_000 },
];
let demoHiddenProfiles = [
	{ profileId: 1003, displayName: "Hidden profile", mediaHash: "demo" },
];

function ok(body: unknown): DemoResponse {
	return { status: 200, body };
}

export function demoCallMethod(method: string): unknown {
	switch (method) {
		case "auth_state":
			return demoMeProfileId;
		case "login":
		case "google_sign_in":
		case "refresh_token":
			return { profileId: demoMeProfileId };
		case "recaptcha_first_party_enabled":
			return false;
		case "notification_get_settings":
		case "notification_set_settings":
			return {
				supported: false,
				enabled: false,
				messages: true,
				taps: true,
				showPreviews: false,
				permission: "unsupported",
				lastSuccessfulCheck: null,
				lastError: null,
			};
		case "notification_test":
		case "notification_sync":
		case "notification_cancel":
			return undefined;
		case "validate_password_complexity":
		case "update_account_password":
		case "update_account_email":
		case "delete_account":
		case "notification_clear_account":
			return undefined;
		default:
			return undefined;
	}
}

export function demoRoute(
	path: string,
	method: string,
	body: unknown,
): DemoResponse {
	const [rawPath, queryString = ""] = path.split("?");
	const params = new URLSearchParams(queryString);
	const segments = rawPath.split("/").filter(Boolean);

	if (method === "GET" && rawPath === "/v4/cascade") {
		return ok(demoCascadeV4(params));
	}
	if (method === "PUT" && rawPath === "/v4/location") {
		return ok({});
	}
	if (method === "GET" && rawPath === "/v7/search") {
		return ok({ profiles: demoSearchProfiles(params) });
	}
	if (method === "GET" && rawPath.startsWith("/v7/profiles/")) {
		const id = Number(segments.at(-1));
		return ok({ profiles: [buildFullProfile(profileSeed(id))] });
	}
	if (method === "POST" && rawPath === "/v3/profiles") {
		const ids =
			(body as { targetProfileIds?: number[] })?.targetProfileIds ?? [];
		return ok({ profiles: demoGetProfiles(ids) });
	}
	if (method === "GET" && rawPath === "/v4/me/profile") {
		return ok({ profiles: [buildShortProfile(meSeed)] });
	}
	if (rawPath === "/v3.1/me/profile/images" && method === "GET") {
		return ok(demoMyUploadedPhotos());
	}
	if (rawPath === "/public/v2/genders") return ok(demoGenders);
	if (rawPath === "/v1/pronouns") return ok(demoPronouns);
	if (rawPath === "/v1/tags") return ok(demoTags);
	if (rawPath === "/v2/taps/received")
		return ok({ profiles: demoReceivedTaps() });
	if (rawPath === "/v2/taps/add") return ok({ isMutual: false });
	if (rawPath === "/v7/views/list") return ok(demoViews());
	if (rawPath === "/v3/me/prefs/settings" && method === "GET") {
		return ok(demoAccountPreferences);
	}
	if (rawPath === "/v3/me/prefs/settings" && method === "PUT") {
		const settings =
			(body as { settings?: Partial<typeof demoAccountPreferences> })
				?.settings ?? {};
		demoAccountPreferences = { ...demoAccountPreferences, ...settings };
		return ok({});
	}
	if (rawPath === "/v3.1/me/blocks" && method === "GET") {
		return ok({ blocking: demoBlockedProfiles });
	}
	if (rawPath === "/v3/me/blocks" && method === "DELETE") {
		demoBlockedProfiles = [];
		return ok({});
	}
	if (
		method === "DELETE" &&
		segments[0] === "v3" &&
		segments[1] === "me" &&
		segments[2] === "blocks" &&
		segments.length === 4
	) {
		const profileId = Number(segments[3]);
		demoBlockedProfiles = demoBlockedProfiles.filter(
			(profile) => profile.profileId !== profileId,
		);
		return ok({});
	}
	if (rawPath === "/v1/hides" && method === "GET") {
		return ok({ hides: demoHiddenProfiles });
	}
	if (rawPath === "/v1/hides" && method === "DELETE") {
		demoHiddenProfiles = [];
		return ok({});
	}
	if (
		method === "DELETE" &&
		segments[0] === "v1" &&
		segments[1] === "hides" &&
		segments.length === 3
	) {
		const profileId = Number(segments[2]);
		demoHiddenProfiles = demoHiddenProfiles.filter(
			(profile) => profile.profileId !== profileId,
		);
		return ok({});
	}
	if (method === "POST" && rawPath === "/v4/inbox") {
		return ok(demoConversations(num(params.get("page")) ?? 1));
	}
	if (
		method === "GET" &&
		rawPath.startsWith("/v5/chat/conversation/") &&
		rawPath.endsWith("/message")
	) {
		const conversationId = segments[3];
		return ok(
			demoConversationMessages(
				conversationId,
				params.get("pageKey") ?? undefined,
			),
		);
	}
	if (
		method === "GET" &&
		segments[0] === "v4" &&
		segments[2] === "conversation" &&
		segments[4] === "message" &&
		segments.length === 6
	) {
		return ok(demoSingleMessage(segments[3], segments[5]));
	}
	// Must precede the `/v2/albums/{albumId}` rule below, which only matches on
	// the first two segments and would otherwise swallow this path.
	if (
		method === "GET" &&
		segments[0] === "v2" &&
		segments[1] === "albums" &&
		segments[2] === "shares" &&
		segments.length === 4
	) {
		return ok(demoAlbumsSharedByProfile(Number(segments[3])));
	}
	if (method === "GET" && segments[0] === "v2" && segments[1] === "albums") {
		return ok(demoAlbumContent(Number(segments[2])));
	}
	if (method === "POST" && rawPath === "/v2/albums") {
		return ok(demoCreateAlbum(body));
	}
	if (
		method === "PUT" &&
		segments[0] === "v2" &&
		segments[1] === "albums" &&
		segments.length === 3
	) {
		return ok(demoRenameAlbum(Number(segments[2]), body));
	}
	if (
		method === "DELETE" &&
		segments[0] === "v1" &&
		segments[1] === "albums" &&
		segments.length === 3
	) {
		demoDeleteAlbum(Number(segments[2]));
		return ok({});
	}
	if (
		method === "GET" &&
		segments[0] === "v1" &&
		segments[1] === "albums" &&
		segments[3] === "shares" &&
		segments.length === 4
	) {
		return ok(demoAlbumSharesFor(Number(segments[2])));
	}
	if (
		method === "PUT" &&
		segments[0] === "v1" &&
		segments[1] === "albums" &&
		segments[3] === "unshares" &&
		segments.length === 4
	) {
		demoUnshareAlbum(Number(segments[2]), body);
		return ok({});
	}
	if (
		method === "POST" &&
		segments[0] === "v1" &&
		segments[1] === "albums" &&
		segments[3] === "content" &&
		segments[4] === "order" &&
		segments.length === 5
	) {
		demoReorderAlbumContent(Number(segments[2]), body);
		return ok({});
	}
	if (
		method === "DELETE" &&
		segments[0] === "v1" &&
		segments[1] === "albums" &&
		segments[3] === "content" &&
		segments.length === 5
	) {
		demoDeleteAlbumContent(Number(segments[2]), Number(segments[4]));
		return ok({});
	}
	if (method === "GET" && rawPath === "/v1/albums/storage") {
		return ok(demoAlbumLimits());
	}
	if (method === "GET" && rawPath === "/v1/albums") {
		return ok(demoMyAlbums());
	}
	if (
		method === "POST" &&
		segments[0] === "v4" &&
		segments[1] === "albums" &&
		segments[3] === "shares" &&
		segments.length === 4
	) {
		demoShareAlbum(Number(segments[2]), body);
		return ok({});
	}
	if (method === "POST" && rawPath === "/v4/chat/message/send") {
		return ok(demoSentMessage(body));
	}
	if (
		method === "POST" &&
		segments[0] === "v4" &&
		segments[1] === "chat" &&
		segments[2] === "conversation" &&
		segments.length === 5 &&
		(segments[4] === "pin" || segments[4] === "unpin")
	) {
		demoSetConversationPinned(segments[3], segments[4] === "pin");
		return ok({});
	}
	if (
		method === "POST" &&
		segments[0] === "v1" &&
		segments[1] === "push" &&
		segments[2] === "conversation" &&
		segments.length === 5 &&
		(segments[4] === "mute" || segments[4] === "unmute")
	) {
		demoSetConversationMuted(segments[3], segments[4] === "mute");
		return ok({});
	}
	if (
		method === "DELETE" &&
		segments[0] === "v4" &&
		segments[1] === "chat" &&
		segments[2] === "conversation" &&
		segments.length === 4
	) {
		demoDeleteConversation(segments[3]);
		return ok({});
	}
	if (method === "GET" && rawPath.startsWith("/v4/chat/media/drawer/")) {
		return ok(demoDrawerMedia());
	}
	if (method === "GET" && rawPath === "/v3/places/search") {
		return ok({ places: [] });
	}
	if (method === "GET" && rawPath === "/v4/rightnow/feed") {
		return ok(demoRightNowFeed(params));
	}

	return ok({});
}
