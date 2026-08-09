import { untrack } from "svelte";
import { SvelteSet } from "svelte/reactivity";

import { backLayerManager } from "$lib/navigation/app-navigation";

type LegacyBackGestureHandler = () => boolean;

class LegacyBackGestureHandlers extends SvelteSet<LegacyBackGestureHandler> {
	#releaseAdapter: (() => void) | null = null;

	override add(handler: LegacyBackGestureHandler): this {
		untrack(() => {
			if (this.has(handler)) return;
			super.add(handler);
			this.#releaseAdapter ??= backLayerManager.register({
				priority: "localMode",
				handler: () => {
					const handlers = [...this];
					for (let index = handlers.length - 1; index >= 0; index--) {
						if (handlers[index]() === false) return "handled";
					}
					return "unhandled";
				},
			});
		});
		return this;
	}

	override delete(handler: LegacyBackGestureHandler): boolean {
		return untrack(() => {
			const existed = super.delete(handler);
			if (this.size === 0) this.#release();
			return existed;
		});
	}

	override clear(): void {
		untrack(() => {
			super.clear();
			this.#release();
		});
	}

	#release(): void {
		this.#releaseAdapter?.();
		this.#releaseAdapter = null;
	}
}

export const backGestureEventHandlers = new LegacyBackGestureHandlers();
