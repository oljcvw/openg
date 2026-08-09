import { createContext } from "svelte";

import type { Message } from "$lib/model/messaging/messages";

export const [getMessageComposerContext, setMessageComposerContext] =
	createContext<
		() => {
			accountProfileId: number;
			disabled: boolean;
			sendMessage: (message: Message) => unknown | Promise<unknown>;
			setText: (text: string) => void;
		}
	>();
