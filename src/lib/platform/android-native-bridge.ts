import { addPluginListener } from "@tauri-apps/api/core";

import { dispatchApplicationBack } from "$lib/navigation/app-navigation";

function readEnvInset(prop: string): number {
	const el = document.createElement("div");
	el.style.cssText = `position:fixed;height:env(${prop},0px);visibility:hidden;pointer-events:none`;
	document.documentElement.appendChild(el);
	const value = parseFloat(getComputedStyle(el).height) || 0;
	document.documentElement.removeChild(el);
	return value;
}

export function applyAndroidInsets() {
	for (const side of ["top", "bottom", "left", "right"] as const) {
		const cssInset = readEnvInset(`safe-area-inset-${side}`);
		const nativeInset = window.__AndroidInsets?.[side]();
		let value: string;
		if (cssInset !== 0) value = `env(safe-area-inset-${side}, 0px)`;
		else if (nativeInset !== undefined) value = `${nativeInset}px`;
		else value = "0px";
		document.documentElement.style.setProperty(`--safe-area-${side}`, value);
	}
	const imeBottom = window.__AndroidInsets?.imeBottom?.() ?? 0;
	document.documentElement.style.setProperty(
		"--ime-bottom",
		`${Math.max(0, imeBottom)}px`,
	);

	window.__reapplyInsets = applyAndroidInsets;
}

export function setChatImeOverlayEnabled(enabled: boolean): void {
	const mode = enabled ? "overlay-chat-navigation" : "resize";
	window.__AndroidInsets?.setImeLayoutMode?.(mode);
	document.documentElement.toggleAttribute("data-chat-ime-overlay", enabled);
	document.documentElement.style.setProperty(
		"--chat-ime-offset",
		enabled ? "var(--ime-bottom)" : "0px",
	);
	applyAndroidInsets();
}

export function isSoftKeyboardVisible(): boolean | undefined {
	return window.__AndroidInsets?.imeVisible?.();
}

let androidBackFlight: Promise<void> | null = null;

export function handleAndroidBackEvent(): Promise<void> {
	if (androidBackFlight) return androidBackFlight;
	const operation = (async () => {
		const outcome = await dispatchApplicationBack();
		if (!outcome.selected && outcome.result === "unhandled")
			window.__AndroidBack?.moveTaskToBack();
	})().finally(() => {
		if (androidBackFlight === operation) androidBackFlight = null;
	});
	androidBackFlight = operation;
	return operation;
}

export function applyBackGestureHandler() {
	window.__AndroidOnBackGesture = () => {
		void handleAndroidBackEvent();
		return false;
	};
}

export async function registerAndroidBackButtonListener() {
	await addPluginListener("app", "back-button", () => {
		void handleAndroidBackEvent();
	});
}
