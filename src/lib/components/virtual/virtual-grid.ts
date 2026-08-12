import type { GridColumns } from "$lib/app-data/preferences.svelte";

const GRID_COLUMN_THRESHOLDS = [328, 608, 736, 992, 1_248] as const;

export function responsiveGridColumnCount(
	width: number,
	preference: GridColumns = "auto",
): number {
	if (preference !== "auto") return preference;
	return (
		2 + GRID_COLUMN_THRESHOLDS.filter((threshold) => width >= threshold).length
	);
}

export function toGridRows<T>(items: readonly T[], columns: number): T[][] {
	const rows: T[][] = [];
	for (let index = 0; index < items.length; index += columns) {
		rows.push(items.slice(index, index + columns));
	}
	return rows;
}
