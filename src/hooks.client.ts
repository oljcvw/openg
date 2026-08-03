import type { ClientInit, HandleClientError } from "@sveltejs/kit";

import { ws } from "$lib/ws.svelte";

export const init: ClientInit = () => {
	ws.connect();
};

export const handleError: HandleClientError = ({ error, event }) => {
	console.error("Error during request to", event.url.pathname, ":", error);
	console.log(JSON.stringify(error, Object.getOwnPropertyNames(error)));
};
import { initializeLogcatSetting } from "$lib/platform/logcat-settings";

initializeLogcatSetting();
