// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
	interface Window {
		__reapplyInsets: () => unknown;
		__AndroidInsets?: {
			top(): number;
			bottom(): number;
			imeBottom?(): number;
			left(): number;
			right(): number;
			imeVisible?(): boolean;
			setImeLayoutMode?(mode: "resize" | "overlay-chat-navigation"): void;
		};
		__AndroidOnBackGesture?: () => boolean;
		__AndroidBack?: {
			moveTaskToBack(): void;
		};
		__AndroidScreen?: {
			setStayAwake(enabled: boolean): void;
		};
	}
}

export {};
