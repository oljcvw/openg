import type { ApiResponseMessage } from "$lib/model/messaging/messages";

export type VoiceNoteIndexStatus =
	| "unknown"
	| "checking"
	| "ready"
	| "empty"
	| "unavailable";

export class VoiceNoteNavigatorState {
	status: VoiceNoteIndexStatus = $state("unknown");
	keys: string[] = $state([]);
	active = $state(false);
	scanComplete = $state(false);
	selectedKey: string | null = $state(null);
	readonly #timestamps = new Map<string, number>();

	get selectedIndex(): number {
		return this.selectedKey === null ? -1 : this.keys.indexOf(this.selectedKey);
	}

	get ordinal(): string | null {
		const index = this.selectedIndex;
		return index < 0 || !this.scanComplete
			? null
			: `${index + 1} of ${this.keys.length}`;
	}

	beginScan(): void {
		if (this.status === "checking") return;
		this.scanComplete = false;
		this.status = this.keys.length > 0 ? "ready" : "checking";
	}

	merge(messages: readonly ApiResponseMessage[]): void {
		for (const message of messages) {
			if (message.type !== "Audio") continue;
			if (message.unsent) this.#timestamps.delete(message.messageId);
			else this.#timestamps.set(message.messageId, message.timestamp);
		}
		this.keys = [...this.#timestamps]
			.toSorted(
				([leftId, leftTimestamp], [rightId, rightTimestamp]) =>
					leftTimestamp - rightTimestamp || leftId.localeCompare(rightId),
			)
			.map(([messageId]) => messageId);
		if (this.keys.length > 0 && this.status !== "unavailable")
			this.status = "ready";
		if (this.selectedKey !== null && !this.keys.includes(this.selectedKey))
			this.selectedKey = this.keys.at(-1) ?? null;
		if (this.keys.length === 0) this.active = false;
	}

	completeScan(): void {
		this.scanComplete = true;
		this.status = this.keys.length > 0 ? "ready" : "empty";
	}

	failScan(): void {
		this.scanComplete = false;
		this.status = this.keys.length > 0 ? "ready" : "unavailable";
	}

	enter(): string | null {
		if (this.keys.length === 0) return null;
		this.active = true;
		this.selectedKey = this.keys.at(-1) ?? null;
		return this.selectedKey;
	}

	selectOlder(): string | null {
		return this.#selectOffset(-1);
	}

	selectNewer(): string | null {
		return this.#selectOffset(1);
	}

	exit(): void {
		this.active = false;
	}

	#selectOffset(delta: number): string | null {
		if (this.keys.length === 0) return null;
		const current = this.selectedIndex;
		const index = Math.max(
			0,
			Math.min(
				this.keys.length - 1,
				(current < 0 ? this.keys.length - 1 : current) + delta,
			),
		);
		this.active = true;
		this.selectedKey = this.keys[index] ?? null;
		return this.selectedKey;
	}
}
