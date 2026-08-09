export type MessagePinReason =
	| "optimistic"
	| "reply-target"
	| "selected"
	| "viewer";

export type MessageSegmentMetadata = {
	segmentId: string;
	cursor: string | null;
	nextCursor: string | null;
	messageIds: string[];
};

export type MessageLocation =
	| { kind: "active"; index: number }
	| { kind: "evicted"; segmentId: string }
	| { kind: "missing" };

type MessageRecord = { messageId: string; timestamp: number };

type ActiveSegment<T extends MessageRecord> = {
	segmentId: string;
	messages: T[];
};

type Pin<T extends MessageRecord> = {
	message: T;
	reasons: Set<MessagePinReason>;
	order: number;
};

export class ActiveMessageWindow<T extends MessageRecord> {
	readonly maxFetchedPages: number;

	#metadata: MessageSegmentMetadata[] = [];
	#activeSegments = new Map<string, ActiveSegment<T>>();
	#pins = new Map<string, Pin<T>>();
	#pinOrder = 0;

	constructor({ maxFetchedPages = 8 }: { maxFetchedPages?: number } = {}) {
		if (!Number.isInteger(maxFetchedPages) || maxFetchedPages < 1) {
			throw new RangeError("maxFetchedPages must be a positive integer");
		}
		this.maxFetchedPages = maxFetchedPages;
	}

	get activeFetchedPageCount(): number {
		return this.#activeSegments.size;
	}

	get segmentMetadata(): MessageSegmentMetadata[] {
		return this.#metadata.map((segment) => ({
			...segment,
			messageIds: [...segment.messageIds],
		}));
	}

	get messages(): T[] {
		const byId = new Map<string, T>();
		for (const metadata of this.#metadata) {
			const segment = this.#activeSegments.get(metadata.segmentId);
			if (!segment) continue;
			for (const message of segment.messages) {
				if (!byId.has(message.messageId)) byId.set(message.messageId, message);
			}
		}
		for (const { message } of this.#pins.values()) {
			byId.set(message.messageId, message);
		}
		return [...byId.values()].toSorted((left, right) => {
			const timestampOrder = right.timestamp - left.timestamp;
			if (timestampOrder !== 0) return timestampOrder;
			const leftPin = this.#pins.get(left.messageId);
			const rightPin = this.#pins.get(right.messageId);
			if (leftPin && rightPin) return rightPin.order - leftPin.order;
			return 0;
		});
	}

	addOlderPage({
		cursor,
		nextCursor,
		messages,
	}: {
		cursor: string | null;
		nextCursor: string | null;
		messages: readonly T[];
	}): string {
		const segmentId = this.#segmentId(cursor, messages);
		const existingIndex = this.#metadata.findIndex(
			(segment) => segment.segmentId === segmentId,
		);
		const metadata = {
			segmentId,
			cursor,
			nextCursor,
			messageIds: messages.map((message) => message.messageId),
		};
		if (existingIndex === -1) this.#metadata.push(metadata);
		else this.#metadata[existingIndex] = metadata;
		this.#activeSegments.set(segmentId, {
			segmentId,
			messages: this.#dedupe(messages),
		});
		this.#trimFromNewest();
		return segmentId;
	}

	replaceNewestPage({
		cursor,
		nextCursor,
		messages,
	}: {
		cursor: string | null;
		nextCursor: string | null;
		messages: readonly T[];
	}): string {
		const previous = this.#metadata.at(0);
		if (previous) {
			this.#activeSegments.delete(previous.segmentId);
			this.#metadata.shift();
		}
		const segmentId = this.#segmentId(cursor, messages);
		this.#metadata.unshift({
			segmentId,
			cursor,
			nextCursor,
			messageIds: messages.map((message) => message.messageId),
		});
		this.#activeSegments.set(segmentId, {
			segmentId,
			messages: this.#dedupe(messages),
		});
		this.#trimFromNewest();
		return segmentId;
	}

	restoreSegment(segmentId: string, messages: readonly T[]): boolean {
		const targetIndex = this.#metadata.findIndex(
			(segment) => segment.segmentId === segmentId,
		);
		if (targetIndex === -1) return false;
		const allowedIds = new Set(this.#metadata[targetIndex].messageIds);
		const restored = this.#dedupe(
			messages.filter((message) => allowedIds.has(message.messageId)),
		);
		if (restored.length === 0 && allowedIds.size > 0) return false;
		this.#activeSegments.set(segmentId, { segmentId, messages: restored });
		this.#trimAround(targetIndex);
		return true;
	}

	locateMessage(messageId: string): MessageLocation {
		const activeIndex = this.messages.findIndex(
			(message) => message.messageId === messageId,
		);
		if (activeIndex !== -1) return { kind: "active", index: activeIndex };
		const metadata = this.#metadata.find((segment) =>
			segment.messageIds.includes(messageId),
		);
		return metadata
			? { kind: "evicted", segmentId: metadata.segmentId }
			: { kind: "missing" };
	}

	getMessage(messageId: string): T | undefined {
		return this.messages.find((message) => message.messageId === messageId);
	}

	getSegmentMessageIds(segmentId: string): string[] | null {
		return this.getSegmentMetadata(segmentId)?.messageIds ?? null;
	}

	getSegmentMetadata(segmentId: string): MessageSegmentMetadata | null {
		const segment = this.#metadata.find(
			(candidate) => candidate.segmentId === segmentId,
		);
		return segment ? { ...segment, messageIds: [...segment.messageIds] } : null;
	}

	getAdjacentNewerSegment(): MessageSegmentMetadata | null {
		const firstActiveIndex = this.#metadata.findIndex((segment) =>
			this.#activeSegments.has(segment.segmentId),
		);
		if (firstActiveIndex <= 0) return null;
		const segment = this.#metadata[firstActiveIndex - 1];
		return { ...segment, messageIds: [...segment.messageIds] };
	}

	hydrateSegment(
		metadata: MessageSegmentMetadata,
		messages: readonly T[],
	): void {
		const existingIndex = this.#metadata.findIndex(
			(segment) => segment.segmentId === metadata.segmentId,
		);
		const preserved = {
			...metadata,
			messageIds: [...metadata.messageIds],
		};
		if (existingIndex === -1) this.#metadata.push(preserved);
		else this.#metadata[existingIndex] = preserved;

		const allowedIds = new Set(metadata.messageIds);
		const restored = this.#dedupe(
			messages.filter((message) => allowedIds.has(message.messageId)),
		);
		if (restored.length === 0 && metadata.messageIds.length > 0) {
			this.#activeSegments.delete(metadata.segmentId);
			return;
		}
		this.#activeSegments.set(metadata.segmentId, {
			segmentId: metadata.segmentId,
			messages: restored,
		});
		this.#trimFromNewest();
	}

	reconcileActive(messages: readonly T[]): void {
		const incomingById = new Map(
			messages.map((message) => [message.messageId, message] as const),
		);
		const assigned = new Set<string>();
		for (const metadata of this.#metadata) {
			const segment = this.#activeSegments.get(metadata.segmentId);
			if (!segment) continue;
			segment.messages = segment.messages.flatMap((message) => {
				const incoming = incomingById.get(message.messageId);
				if (!incoming) return [];
				assigned.add(incoming.messageId);
				return [incoming];
			});
			metadata.messageIds = segment.messages.map(
				(message) => message.messageId,
			);
		}

		const nextPins = new Map<string, Pin<T>>();
		for (const pin of this.#pins.values()) {
			const incoming =
				incomingById.get(pin.message.messageId) ??
				messages.find((message) => message === pin.message);
			if (!incoming) continue;
			nextPins.set(incoming.messageId, {
				message: incoming,
				reasons: pin.reasons,
				order: pin.order,
			});
			assigned.add(incoming.messageId);
		}
		this.#pins = nextPins;

		const additions = messages.filter(
			(message) => !assigned.has(message.messageId),
		);
		if (additions.length > 0) {
			this.#ensureNewestSegment();
			const newest = this.#activeSegments.get(this.#metadata[0].segmentId)!;
			newest.messages = this.#dedupe([...additions, ...newest.messages]);
			this.#metadata[0].messageIds = newest.messages.map(
				(message) => message.messageId,
			);
		}
	}

	upsertNewest(message: T): void {
		this.#ensureNewestSegment();
		for (const segment of this.#activeSegments.values()) {
			segment.messages = segment.messages.filter(
				(candidate) => candidate.messageId !== message.messageId,
			);
		}
		const newest = this.#activeSegments.get(this.#metadata[0].segmentId)!;
		newest.messages = [message, ...newest.messages];
		for (const metadata of this.#metadata) {
			const segment = this.#activeSegments.get(metadata.segmentId);
			if (segment) {
				metadata.messageIds = segment.messages.map(
					(candidate) => candidate.messageId,
				);
			}
		}
		this.#trimAround(0);
	}

	confirmOptimistic(previousId: string, message: T): boolean {
		const pin = this.#pins.get(previousId) ?? this.#pins.get(message.messageId);
		if (!pin?.reasons.has("optimistic")) return false;
		this.#pins.delete(previousId);
		this.#pins.delete(message.messageId);
		pin.message = message;
		pin.reasons.delete("optimistic");
		if (pin.reasons.size > 0) this.#pins.set(message.messageId, pin);
		this.upsertNewest(message);
		return true;
	}

	pin(message: T, reason: MessagePinReason): void {
		const existing = this.#pins.get(message.messageId);
		if (existing) {
			existing.message = message;
			existing.reasons.add(reason);
			return;
		}
		this.#pins.set(message.messageId, {
			message,
			reasons: new Set([reason]),
			order: this.#pinOrder++,
		});
	}

	unpin(messageId: string, reason: MessagePinReason): void {
		const pin = this.#pins.get(messageId);
		if (!pin) return;
		pin.reasons.delete(reason);
		if (pin.reasons.size === 0) this.#pins.delete(messageId);
	}

	remove(messageId: string): T | undefined {
		const pinned = this.#pins.get(messageId)?.message;
		this.#pins.delete(messageId);
		let removed = pinned;
		for (const segment of this.#activeSegments.values()) {
			const index = segment.messages.findIndex(
				(message) => message.messageId === messageId,
			);
			if (index !== -1) {
				[removed] = segment.messages.splice(index, 1);
			}
		}
		for (const metadata of this.#metadata) {
			metadata.messageIds = metadata.messageIds.filter(
				(id) => id !== messageId,
			);
		}
		return removed;
	}

	clear(): void {
		this.#metadata = [];
		this.#activeSegments.clear();
		this.#pins.clear();
		this.#pinOrder = 0;
	}

	#trimFromNewest(): void {
		while (this.#activeSegments.size > this.maxFetchedPages) {
			const oldestActive = this.#metadata.find((segment) =>
				this.#activeSegments.has(segment.segmentId),
			);
			if (!oldestActive) return;
			this.#activeSegments.delete(oldestActive.segmentId);
		}
	}

	#trimAround(targetIndex: number): void {
		while (this.#activeSegments.size > this.maxFetchedPages) {
			const activeIndexes = this.#metadata.flatMap((segment, index) =>
				this.#activeSegments.has(segment.segmentId) ? [index] : [],
			);
			const removeIndex = activeIndexes.toSorted(
				(left, right) =>
					Math.abs(right - targetIndex) - Math.abs(left - targetIndex) ||
					right - left,
			)[0];
			if (removeIndex === undefined) return;
			this.#activeSegments.delete(this.#metadata[removeIndex].segmentId);
		}
	}

	#segmentId(cursor: string | null, messages: readonly T[]): string {
		return [
			cursor ?? "root",
			messages.at(0)?.messageId ?? "empty",
			messages.at(-1)?.messageId ?? "empty",
		].join(":");
	}

	#ensureNewestSegment(): void {
		const newest = this.#metadata.at(0);
		if (newest) {
			if (!this.#activeSegments.has(newest.segmentId)) {
				this.#activeSegments.set(newest.segmentId, {
					segmentId: newest.segmentId,
					messages: [],
				});
			}
			return;
		}
		const segmentId = this.#segmentId(null, []);
		this.#metadata.push({
			segmentId,
			cursor: null,
			nextCursor: null,
			messageIds: [],
		});
		this.#activeSegments.set(segmentId, { segmentId, messages: [] });
	}

	#dedupe(messages: readonly T[]): T[] {
		const seen = new Set<string>();
		return messages.filter((message) => {
			if (seen.has(message.messageId)) return false;
			seen.add(message.messageId);
			return true;
		});
	}
}
