import { runtimeOwnership } from "$lib/dev/runtime-ownership";

export type WidthObserver = { destroy(): void };

/** Observe rounded element width with at most one delivery per animation frame. */
export function observeElementWidth(
	node: HTMLElement,
	onWidth: (width: number) => void,
): WidthObserver {
	let lastWidth: number | undefined;
	let frame: number | null = null;
	let destroyed = false;

	const deliver = () => {
		frame = null;
		if (destroyed) return;
		const width = Math.round(
			node.getBoundingClientRect().width || node.clientWidth,
		);
		if (width === lastWidth) return;
		lastWidth = width;
		onWidth(width);
	};
	const schedule = () => {
		if (frame !== null || destroyed) return;
		frame = requestAnimationFrame(deliver);
	};

	deliver();
	if (typeof ResizeObserver === "undefined") return { destroy() {} };
	const releaseObserver = runtimeOwnership.acquire("observer");
	const observer = new ResizeObserver(schedule);
	observer.observe(node);
	return {
		destroy() {
			destroyed = true;
			observer.disconnect();
			if (frame !== null) cancelAnimationFrame(frame);
			frame = null;
			releaseObserver();
		},
	};
}
