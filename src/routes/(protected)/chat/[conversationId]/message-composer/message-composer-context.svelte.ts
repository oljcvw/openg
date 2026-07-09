import { createContext } from "svelte";

import type { Message } from "$lib/model/messaging/messages";

export type MessageComposerContext = {
	disabled: boolean;
	sendMessage: (message: Message) => void | Promise<void>;
	/** Clear the composer's text input. */
	clear: () => void;
	/** Focus the composer's text input. */
	focus: () => void;
};

export const [getMessageComposerContext, setMessageComposerContext] =
	createContext<() => MessageComposerContext>();
