import type { ClientInit, HandleClientError } from "@sveltejs/kit";
import { platform } from "@tauri-apps/plugin-os";
import {
	applyPlatformAttributes,
	getPlatformFlags,
} from "$lib/platform/mobile";

export const init: ClientInit = async () => {
	// TODO: authorize user?
	applyPlatformAttributes(document.documentElement, getPlatformFlags(platform()));
};

export const handleError: HandleClientError = ({ error, event }) => {
	console.error("Error during request to", event.url.pathname, ":", error);
	console.log(JSON.stringify(error, Object.getOwnPropertyNames(error)));
};
