const resets = new Set<() => void>();
const generationSubscribers = new Set<(generation: number) => void>();

export type AccountSessionSnapshot = {
	accountId: number | null;
	generation: number;
};

let activeAccountId: number | null = null;
let accountGeneration = 0;

let epoch = 0;

export function registerAccountCache(
	cache: { reset: () => void } | (() => void),
): void {
	const reset = typeof cache === "function" ? cache : cache.reset;
	resets.add(reset);
}

export function accountEpoch(): number {
	return epoch;
}

export function isAccountEpochCurrent(captured: number): boolean {
	return captured === epoch;
}

export function clearAccountCaches(): void {
	epoch += 1;
	for (const reset of resets) {
		try {
			reset();
		} catch (error) {
			console.error("Account cache reset failed", error);
		}
	}
}

export function getAccountSessionSnapshot(): AccountSessionSnapshot {
	return { accountId: activeAccountId, generation: accountGeneration };
}

export function subscribeAccountGeneration(
	subscriber: (generation: number) => void,
): () => void {
	generationSubscribers.add(subscriber);
	subscriber(accountGeneration);
	return () => {
		generationSubscribers.delete(subscriber);
	};
}

function notifyAccountGeneration(): void {
	for (const subscriber of generationSubscribers) {
		try {
			subscriber(accountGeneration);
		} catch {
			// One subscriber cannot prevent remaining account-scoped resets.
		}
	}
}

export function isAccountSessionCurrent(
	snapshot: AccountSessionSnapshot,
): boolean {
	return (
		snapshot.accountId === activeAccountId &&
		snapshot.generation === accountGeneration
	);
}

export function activateAccountSession(
	accountId: number,
): AccountSessionSnapshot {
	if (activeAccountId === accountId) return getAccountSessionSnapshot();
	accountGeneration += 1;
	activeAccountId = accountId;
	clearAccountCaches();
	notifyAccountGeneration();
	return getAccountSessionSnapshot();
}

export function invalidateAccountSession(): AccountSessionSnapshot {
	const previous = getAccountSessionSnapshot();
	accountGeneration += 1;
	activeAccountId = null;
	clearAccountCaches();
	notifyAccountGeneration();
	return previous;
}
