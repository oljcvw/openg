/**
 * RadialActionWheel — generic, configurable radial action wheel.
 *
 * Renders a pie-slice wheel of options around a central toggle button.
 * Pointer-down on the button opens the wheel; dragging onto a slice
 * highlights it and shows a hint label; releasing on a slice selects it.
 * Releasing in the center "safe zone" or outside the wheel just closes.
 *
 * Built imperatively so it works with any framework that accepts a raw DOM
 * container (PhotoSwipe `registerElement` API, Svelte `use:action`, etc.).
 *
 * Consumers are responsible for providing CSS targeting the class prefix.
 *
 * @example
 * ```ts
 * import { createRadialActionWheel } from "$lib/components/radial-action-wheel";
 *
 * const destroy = createRadialActionWheel(container, options, {
 *   radius: 140,
 *   safeZoneRadius: 30,
 *   arcDegrees: 90,
 *   classPrefix: "my-widget",
 * });
 * ```
 */

export type RadialWheelOption = {
	id: string;
	label: string;
	icon: string;
	enabled: boolean;
	action: () => void | Promise<void>;
};

type Slice = {
	element: HTMLButtonElement;
	option: RadialWheelOption;
	startAngle: number;
	endAngle: number;
};

export type RadialWheelConfig = {
	/** Wheel radius in CSS pixels. */
	radius: number;
	/** Center dead-zone radius in CSS pixels. */
	safeZoneRadius: number;
	/** Total arc the wheel spans, in degrees (e.g. 90 → quarter-circle). */
	arcDegrees: number;
	/** Starting angle in radians. Default -π/2 (top). */
	startAngle?: number;
	/** Sweep direction from the starting angle. Default "counter-clockwise". */
	sweepDirection?: "counter-clockwise" | "clockwise";
	/** UI scale factor (for future user-configurable scaling). Default 1. */
	scale?: number;
	/** CSS class prefix applied to all generated elements. */
	classPrefix: string;
};

const DEFAULTS = {
	startAngle: -Math.PI / 2,
	sweepDirection: "counter-clockwise" as const,
	scale: 1,
};

/**
 * Build the action wheel and append it to `container`.
 * Returns a cleanup function that removes all listeners and DOM.
 */
export function createRadialActionWheel(
	container: HTMLElement,
	options: RadialWheelOption[],
	config: RadialWheelConfig,
): () => void {
	const {
		radius,
		safeZoneRadius,
		arcDegrees,
		classPrefix,
		startAngle = DEFAULTS.startAngle,
		sweepDirection = DEFAULTS.sweepDirection,
		scale = DEFAULTS.scale,
	} = config;

	const isCCW = sweepDirection === "counter-clockwise";
	const sliceAngleRad = ((arcDegrees * Math.PI) / 180) / options.length;

	// --- DOM construction ---

	const actions = document.createElement("div");
	actions.className = `${classPrefix}-actions`;

	const actionButton = document.createElement("button");
	actionButton.type = "button";
	actionButton.className = `${classPrefix}-action-button`;
	actionButton.textContent = "⋯";
	actionButton.setAttribute("aria-label", "Menu");

	const wheelSize = radius * 2;
	const actionWheel = document.createElement("div");
	actionWheel.className = `${classPrefix}-wheel`;
	actionWheel.hidden = true;
	actionWheel.style.setProperty("--wheel-size", `${wheelSize}px`);
	actionWheel.style.setProperty("--safe-zone-radius", `${safeZoneRadius}px`);
	actionWheel.style.setProperty("--wheel-radius", `${radius}px`);

	const hintBubble = document.createElement("div");
	hintBubble.className = `${classPrefix}-wheel-hint`;
	hintBubble.hidden = true;

	const slices = buildSlices(options, actionWheel, {
		radius,
		safeZoneRadius,
		scale,
		startAngle,
		arcDegrees,
		classPrefix,
		sweepDirection,
	});

	// --- State ---

	let currentIndex = -1;
	let pointerActive = false;
	let ignoreNextClick = false;

	// --- UI helpers ---

	const setHint = (index: number) => {
		if (index === -1) {
			hintBubble.hidden = true;
			hintBubble.textContent = "";
			for (const s of slices)
				s.element.classList.remove(`${classPrefix}-wheel-slice--active`);
			return;
		}
		hintBubble.hidden = false;
		hintBubble.textContent = slices[index].option.label;
		slices.forEach((s, idx) => {
			s.element.classList.toggle(
				`${classPrefix}-wheel-slice--active`,
				idx === index,
			);
		});
	};

	const buttonCenter = (): { x: number; y: number } => {
		const rect = actionButton.getBoundingClientRect();
		return {
			x: rect.left + rect.width / 2,
			y: rect.top + rect.height / 2,
		};
	};

	const distanceFromButton = (event: PointerEvent): number => {
		const c = buttonCenter();
		return Math.hypot(event.clientX - c.x, event.clientY - c.y);
	};

	const angleFromButton = (event: PointerEvent): number => {
		const c = buttonCenter();
		return Math.atan2(event.clientY - c.y, event.clientX - c.x);
	};

	/** Normalize any angle (radians) into [0, 2π). */
	const norm = (a: number): number =>
		((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

	const hoverIndex = (event: PointerEvent): number => {
		if (distanceFromButton(event) < safeZoneRadius) return -1;
		if (distanceFromButton(event) > radius * scale) return -1;
		const userAngle = norm(angleFromButton(event));
		for (let i = 0; i < slices.length; i++) {
			const { startAngle: s, endAngle: e } = slices[i];
			const normStart = norm(s);
			const normEnd = norm(e);
			if (isCCW) {
				// Counter-clockwise: startAngle > endAngle, so normStart >= normEnd
				if (userAngle <= normStart && userAngle >= normEnd) return i;
			} else {
				// Clockwise: startAngle < endAngle, so normStart <= normEnd
				if (userAngle >= normStart && userAngle <= normEnd) return i;
			}
		}
		return -1;
	};

	const openWheel = () => {
		actionWheel.hidden = false;
		actions.classList.add(`${classPrefix}-actions--open`);
		actionButton.textContent = "✕";
		actionButton.setAttribute("aria-label", "Close menu");
	};

	const closeWheel = () => {
		actionWheel.hidden = true;
		setHint(-1);
		actions.classList.remove(`${classPrefix}-actions--open`);
		actionButton.textContent = "⋯";
		actionButton.setAttribute("aria-label", "Menu");
	};

	const selectIndex = async (index: number) => {
		if (index < 0 || index >= slices.length) return;
		const slice = slices[index];
		if (!slice.option.enabled) return;
		await Promise.resolve(slice.option.action());
	};

	const updatePointer = (event: PointerEvent) => {
		const next = hoverIndex(event);
		if (next !== currentIndex) {
			setHint(next);
			currentIndex = next;
		}
	};

	// --- Pointer interactions ---

	const onPointerDown = (event: PointerEvent) => {
		pointerActive = true;
		actionButton.setPointerCapture(event.pointerId);
		if (actionWheel.hidden) openWheel();
		updatePointer(event);
	};

	const onPointerMove = (event: PointerEvent) => {
		if (!pointerActive) return;
		updatePointer(event);
	};

	const onPointerUp = (event: PointerEvent) => {
		if (!pointerActive) return;
		pointerActive = false;
		actionButton.releasePointerCapture(event.pointerId);
		if (
			currentIndex !== -1 &&
			distanceFromButton(event) >= safeZoneRadius
		) {
			ignoreNextClick = true;
			void selectIndex(currentIndex);
		}
		closeWheel();
	};

	const onButtonClick = (event: MouseEvent) => {
		if (ignoreNextClick) {
			ignoreNextClick = false;
			return;
		}
		event.stopPropagation();
		if (actionWheel.hidden) openWheel();
		else closeWheel();
	};

	const onWheelPointerUp = (event: PointerEvent) => {
		if (!pointerActive) return;
		if (
			currentIndex !== -1 &&
			distanceFromButton(event) >= safeZoneRadius
		) {
			ignoreNextClick = true;
			void selectIndex(currentIndex);
		}
		closeWheel();
	};

	const closeWheelOnClick = (event: MouseEvent) => {
		const target = event.target;
		if (!(target instanceof Node)) return;
		if (actions.contains(target)) return;
		closeWheel();
	};

	actionButton.addEventListener("pointerdown", onPointerDown);
	actionButton.addEventListener("pointermove", onPointerMove);
	actionButton.addEventListener("pointerup", onPointerUp);
	actionButton.addEventListener("click", onButtonClick);
	actionWheel.addEventListener("pointermove", onPointerMove);
	actionWheel.addEventListener("pointerup", onWheelPointerUp);
	document.addEventListener("click", closeWheelOnClick);

	actions.append(hintBubble, actionWheel, actionButton);
	container.append(actions);

	return () => {
		actionButton.removeEventListener("pointerdown", onPointerDown);
		actionButton.removeEventListener("pointermove", onPointerMove);
		actionButton.removeEventListener("pointerup", onPointerUp);
		actionButton.removeEventListener("click", onButtonClick);
		actionWheel.removeEventListener("pointermove", onPointerMove);
		actionWheel.removeEventListener("pointerup", onWheelPointerUp);
		document.removeEventListener("click", closeWheelOnClick);
		actions.remove();
	};
}

// ---- Internal helpers ----

type BuildSlicesOptions = {
	radius: number;
	scale: number;
	startAngle: number;
	arcDegrees: number;
	classPrefix: string;
	sweepDirection: "counter-clockwise" | "clockwise";
	safeZoneRadius: number;
};

function buildSlices(
	options: RadialWheelOption[],
	wheel: HTMLElement,
	cfg: BuildSlicesOptions,
): Slice[] {
	const { radius, scale, classPrefix } = cfg;
	const isCCW = cfg.sweepDirection === "counter-clockwise";
	const sliceAngleRad = ((cfg.arcDegrees * Math.PI) / 180) / options.length;

	return options.map((option, index) => {
		const startAngle = isCCW
			? cfg.startAngle - index * sliceAngleRad
			: cfg.startAngle + index * sliceAngleRad;
		const endAngle = isCCW
			? startAngle - sliceAngleRad
			: startAngle + sliceAngleRad;

		const slice = document.createElement("button");
		slice.type = "button";
		slice.className = `${classPrefix}-wheel-slice`;
		slice.disabled = !option.enabled;
		slice.dataset.option = option.id;
		slice.setAttribute("aria-label", option.label);

		const icon = document.createElement("div");
		icon.className = `${classPrefix}-wheel-slice-icon`;
		icon.textContent = option.icon;

		const midAngle = (startAngle + endAngle) / 2;
		const labelRadius = radius * 0.85;
		slice.style.setProperty(
			"--slice-clip-path",
			clipAnnularSector(startAngle, endAngle, radius, cfg.safeZoneRadius, scale),
		);
		slice.style.setProperty(
			"--icon-x",
			`${Math.cos(midAngle) * labelRadius}px`,
		);
		slice.style.setProperty(
			"--icon-y",
			`${Math.sin(midAngle) * labelRadius}px`,
		);

		slice.append(icon);
		wheel.append(slice);
		return { element: slice, option, startAngle, endAngle };
	});
}

/**
 * Generate a polygon clip-path for an annular sector (donut wedge).
 *
 * Traces the outer arc from startAngle to endAngle, then traces the
 * inner arc back from endAngle to startAngle. This prevents the hover
 * highlight from bleeding under the origin button in the safe zone.
 */
function clipAnnularSector(
	startAngle: number,
	endAngle: number,
	outerRadius: number,
	innerRadius: number,
	scale: number,
): string {
	const outerPct = (outerRadius / (outerRadius * scale)) * 50;
	const innerPct = (innerRadius / (outerRadius * scale)) * 50;
	const steps = 10;
	const points: string[] = [];

	// Outer arc (startAngle → endAngle)
	for (let i = 0; i <= steps; i++) {
		const a = startAngle + ((endAngle - startAngle) * i) / steps;
		points.push(`${50 + Math.cos(a) * outerPct}% ${50 + Math.sin(a) * outerPct}%`);
	}
	// Inner arc back (endAngle → startAngle)
	for (let i = steps; i >= 0; i--) {
		const a = startAngle + ((endAngle - startAngle) * i) / steps;
		points.push(`${50 + Math.cos(a) * innerPct}% ${50 + Math.sin(a) * innerPct}%`);
	}

	return `polygon(${points.join(", ")})`;
}