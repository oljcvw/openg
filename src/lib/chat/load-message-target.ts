const waitForMessageWork = () =>
	new Promise<void>((resolve) => setTimeout(resolve, 16));

export async function loadMessageTarget({
	messageId,
	hasMessage,
	pageKey,
	loading,
	loadMore,
	isCurrent = () => true,
	waitForWork = waitForMessageWork,
}: {
	messageId: string;
	hasMessage: (messageId: string) => boolean;
	pageKey: () => string | null;
	loading: () => boolean;
	loadMore: () => Promise<void>;
	isCurrent?: () => boolean;
	waitForWork?: () => Promise<void>;
}): Promise<boolean> {
	while (isCurrent()) {
		if (hasMessage(messageId)) return true;
		const before = pageKey();
		if (before === null) return false;

		await loadMore();
		while (loading() && isCurrent()) await waitForWork();
		if (!isCurrent()) return false;
		if (hasMessage(messageId)) return true;
		if (pageKey() === before) return false;
	}
	return false;
}
