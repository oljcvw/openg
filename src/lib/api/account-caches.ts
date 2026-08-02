const resets = new Set<() => void>();

export type AccountSessionSnapshot = {
	accountId: number | null;
	generation: number;
};

let activeAccountId: number | null = null;
let accountGeneration = 0;

export function registerAccountCache(reset: () => void): void {
	resets.add(reset);
}

export function clearAccountCaches(): void {
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
	return getAccountSessionSnapshot();
}

export function invalidateAccountSession(): AccountSessionSnapshot {
	const previous = getAccountSessionSnapshot();
	accountGeneration += 1;
	activeAccountId = null;
	clearAccountCaches();
	return previous;
}
