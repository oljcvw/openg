import { describe, expect, it, vi } from "vitest";

import { CollectionPageWindow } from "$lib/chat/collection-page-window";

type Item = { id: string; value: number };

function page(index: number, size = 60): Item[] {
	return Array.from({ length: size }, (_, offset) => ({
		id: `item-${index * 60 + offset}`,
		value: index * 60 + offset,
	}));
}

describe("CollectionPageWindow", () => {
	it("keeps only current preceding and following pages", () => {
		const window = new CollectionPageWindow<Item>((item) => item.id);
		window.setPage(3, page(3));
		window.setPage(4, page(4));
		window.setPage(5, page(5));
		window.focus(4);

		expect(window.pageIndexes).toEqual([3, 4, 5]);
		expect(window.items).toHaveLength(180);

		window.setPage(6, page(6));
		window.focus(5);
		expect(window.pageIndexes).toEqual([4, 5, 6]);
		expect(window.items).toHaveLength(180);
	});

	it("bounds ten thousand records while retaining a pinned open item", () => {
		const evicted = vi.fn<(items: Item[]) => void>();
		const window = new CollectionPageWindow<Item>((item) => item.id, {
			onEvict: evicted,
		});
		const pinned = page(0)[0]!;
		window.pin(pinned);
		for (let index = 0; index < 167; index += 1) {
			window.setPage(index, page(index, index === 166 ? 40 : 60));
			window.focus(index);
		}

		expect(window.pageIndexes).toEqual([165, 166]);
		expect(window.items).toHaveLength(101);
		expect(window.items.at(-1)).toEqual(pinned);
		expect(evicted).toHaveBeenCalled();
		expect(evicted.mock.calls.flat(2)).not.toContainEqual(pinned);

		window.unpin();
		expect(window.items).toHaveLength(100);
		expect(evicted.mock.calls.at(-1)?.[0]).toContainEqual(pinned);
	});

	it("clears pages without releasing a pinned viewer item", () => {
		const evicted = vi.fn<(items: Item[]) => void>();
		const window = new CollectionPageWindow<Item>((item) => item.id, {
			onEvict: evicted,
		});
		const pinned = page(0)[2]!;
		window.setPage(0, page(0));
		window.pin(pinned);
		window.clear();

		expect(window.items).toEqual([pinned]);
		expect(evicted.mock.calls.flat(2)).not.toContainEqual(pinned);
	});

	it("releases only records absent from every retained page and pin", () => {
		const evicted = vi.fn<(items: Item[]) => void>();
		const window = new CollectionPageWindow<Item>((item) => item.id, {
			onEvict: evicted,
		});
		const shared = { id: "shared-boundary", value: 1 };
		const firstPin = { id: "first-pin", value: 2 };
		const secondPin = { id: "second-pin", value: 3 };

		window.setPage(0, [shared]);
		window.setPage(1, [shared]);
		window.focus(1);
		window.setPage(0, []);
		expect(evicted).not.toHaveBeenCalled();

		window.pin(firstPin);
		window.pin(secondPin);
		expect(evicted).toHaveBeenCalledWith([firstPin]);

		window.setPage(1, []);
		expect(evicted).toHaveBeenCalledWith([shared]);
	});
});
