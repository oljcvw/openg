let enabled = false;
let wakeLock: WakeLockSentinel | null = null;

async function releaseWebWakeLock() {
	const current = wakeLock;
	wakeLock = null;
	if (current !== null && !current.released) await current.release();
}

async function applyWebWakeLock() {
	if (
		!enabled ||
		document.visibilityState !== "visible" ||
		wakeLock !== null ||
		!("wakeLock" in navigator)
	)
		return;

	const sentinel = await navigator.wakeLock.request("screen");
	if (!enabled) {
		await sentinel.release();
		return;
	}
	wakeLock = sentinel;
	sentinel.addEventListener(
		"release",
		() => {
			if (wakeLock === sentinel) wakeLock = null;
		},
		{ once: true },
	);
}

export async function applyStayAwake(value: boolean) {
	enabled = value;
	if (window.__AndroidScreen !== undefined) {
		await releaseWebWakeLock();
		window.__AndroidScreen.setStayAwake(value);
		return;
	}

	if (value) await applyWebWakeLock();
	else await releaseWebWakeLock();
}

export function registerStayAwakeVisibilityListener() {
	const onVisibilityChange = () => {
		if (document.visibilityState === "visible" && enabled) {
			void applyWebWakeLock().catch((error) => {
				console.error("Failed to restore screen wake lock", error);
			});
		}
	};
	document.addEventListener("visibilitychange", onVisibilityChange);

	return () => {
		document.removeEventListener("visibilitychange", onVisibilityChange);
		void applyStayAwake(false).catch((error) => {
			console.error("Failed to release screen wake lock", error);
		});
	};
}
