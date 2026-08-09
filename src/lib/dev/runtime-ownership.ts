export const RUNTIME_OWNERSHIP_TYPES = [
	"navigation-runtime",
	"back-layer-registration",
	"virtual-collection",
	"virtual-row",
	"conversation-state",
	"websocket-listener",
	"media-viewer",
	"observer",
	"media-element",
] as const;

export type RuntimeOwnershipType = (typeof RUNTIME_OWNERSHIP_TYPES)[number];
export type RuntimeOwnershipSnapshot = Record<RuntimeOwnershipType, number>;

function emptySnapshot(): RuntimeOwnershipSnapshot {
	return Object.fromEntries(
		RUNTIME_OWNERSHIP_TYPES.map((type) => [type, 0]),
	) as RuntimeOwnershipSnapshot;
}

export function createRuntimeOwnershipRegistry(enabled: boolean) {
	const counts = emptySnapshot();
	return {
		acquire(type: RuntimeOwnershipType): () => void {
			if (!enabled) return () => {};
			counts[type] += 1;
			let active = true;
			return () => {
				if (!active) return;
				active = false;
				counts[type] -= 1;
			};
		},
		snapshot(): RuntimeOwnershipSnapshot {
			return Object.freeze({ ...counts });
		},
	};
}

const enabled = import.meta.env.DEV || import.meta.env.MODE === "test";
export const runtimeOwnership = createRuntimeOwnershipRegistry(enabled);

/** Development-only numeric snapshot for manual heap/PSS correlation. */
export function getRuntimeOwnershipSnapshot(): RuntimeOwnershipSnapshot {
	return runtimeOwnership.snapshot();
}
