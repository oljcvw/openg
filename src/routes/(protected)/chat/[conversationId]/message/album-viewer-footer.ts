/**
 * Album viewer footer — profile cluster, counter/pill row, and expiration info.
 *
 * Extracted from AlbumMessage.svelte to keep the component clean.
 * Built imperatively for PhotoSwipe's `registerElement` API.
 */

import { goto } from "$app/navigation";

import { formatDistance } from "$lib/util/units";
import type { UnitSystem } from "$lib/util/units";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OwnerProfile = {
	profileId: number;
	mediaHash: string | null;
	name: string | null;
	distance: number | null;
};

type UnitSnapshot = UnitSystem;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type FooterOptions = {
	owner: OwnerProfile | null;
	albumName: string | null;
	contentLength: number;
	units: UnitSnapshot;
	/** Unix ms when the album expires, or null if indefinite. */
	expiresAt: number | null;
	/** If the album is a once-view (AlbumExpiration.ONCE). */
	onceView: boolean;
};

/**
 * Build the album footer children and append them to `footerEl`.
 *
 * @param footerEl – The HTMLElement that PhotoSwipe registered as the footer
 *   (already has class `pswp__chat-album-footer`).
 * @param pswp – The PhotoSwipe instance (used for event binding).
 * @param opts – Footer options.
 * @param cleanups – Array to push cleanup functions into (called on destroy).
 */
export function buildAlbumFooter(
	footerEl: HTMLElement,
	pswp: import("photoswipe").default,
	opts: FooterOptions,
	cleanups: (() => void)[],
): void {
	// ---- Left: profile cluster ----
	const profileCluster = buildProfileCluster(
		opts.owner,
		opts.albumName,
		opts.units,
		opts.expiresAt,
		opts.onceView,
		cleanups,
	);

	// ---- Center: counter + pill row ----
	const counterStack = buildCounterStack(pswp, opts.contentLength, cleanups);

	footerEl.append(profileCluster, counterStack);
}

// ---------------------------------------------------------------------------
// Profile cluster builder
// ---------------------------------------------------------------------------

const AVATAR_SIZE_PX = 44;
const GRID_SIZE = 320;

function buildProfileCluster(
	owner: OwnerProfile | null,
	albumName: string | null,
	unitSystem: UnitSnapshot,
	expiresAt: number | null,
	onceView: boolean,
	cleanups: (() => void)[],
): HTMLElement {
	const cluster = document.createElement("div");
	cluster.className = "pswp__chat-album-footer-profile";
	cluster.style.cursor = "pointer";
	cluster.addEventListener("click", () => {
		if (owner?.profileId) void goto(`/profile/${owner.profileId}`);
	});

	// Avatar
	const avatar = document.createElement("div");
	avatar.className = "pswp__chat-album-footer-avatar";
	avatar.style.width = `${AVATAR_SIZE_PX}px`;
	avatar.style.height = `${AVATAR_SIZE_PX}px`;
	if (owner?.mediaHash) {
		const img = document.createElement("img");
		img.src = `https://cdns.grindr.com/images/thumb/${GRID_SIZE}x${GRID_SIZE}/${owner.mediaHash}`;
		img.alt = owner.name ?? "Album owner";
		img.draggable = false;
		avatar.appendChild(img);
	} else {
		const placeholder = document.createElement("div");
		placeholder.className = "pswp__chat-album-footer-avatar-placeholder";
		placeholder.textContent = (owner?.name?.[0] ?? "A").toUpperCase();
		avatar.appendChild(placeholder);
	}

	// Details
	const details = document.createElement("div");
	details.className = "pswp__chat-album-footer-profile-details";

	const nameEl = document.createElement("div");
	nameEl.className = "pswp__chat-album-footer-profile-name";
	nameEl.textContent = owner?.name ?? "Someone";

	const subtitleEl = document.createElement("div");
	subtitleEl.className = "pswp__chat-album-footer-album-name";

	const distanceLabel =
		owner?.distance != null
			? formatDistance(owner.distance, unitSystem)
			: null;

	// Show the first non-null among: albumName, distanceLabel, "Album", blank
	const subtitle = albumName ?? distanceLabel ?? "Album";
	subtitleEl.textContent = subtitle;

	details.append(nameEl, subtitleEl);

	// Expiration / view info chip
	if (onceView || (expiresAt && expiresAt > Date.now())) {
		const metaEl = document.createElement("div");
		metaEl.className = "pswp__chat-album-footer-meta";
		if (onceView) {
			metaEl.textContent = "View once";
		} else if (expiresAt && expiresAt > Date.now()) {
			const remaining = expiresAt - Date.now();
			metaEl.textContent = formatExpiry(remaining);
			// Update every 30 s while the lightbox is open
			const interval = setInterval(() => {
				const r = expiresAt - Date.now();
				if (r <= 0) {
					metaEl.textContent = "Expired";
					clearInterval(interval);
				} else {
					metaEl.textContent = formatExpiry(r);
				}
			}, 30_000);
			cleanups.push(() => clearInterval(interval));
		}
		details.append(metaEl);
	}

	cluster.append(avatar, details);
	return cluster;
}

// ---------------------------------------------------------------------------
// Counter + pill row builder
// ---------------------------------------------------------------------------

function buildCounterStack(
	pswp: import("photoswipe").default,
	contentLength: number,
	cleanups: (() => void)[],
): HTMLElement {
	const stack = document.createElement("div");
	stack.className = "pswp__chat-album-footer-counter-stack";

	// Pill row
	const pillRow = document.createElement("div");
	pillRow.className = "pswp__chat-album-footer-pill-row";
	const pills: HTMLSpanElement[] = [];
	for (let i = 0; i < contentLength; i++) {
		const pill = document.createElement("span");
		pill.className = "pswp__chat-album-footer-pill";
		pill.dataset.index = String(i);
		pill.setAttribute("aria-label", `Slide ${i + 1}`);
		pillRow.appendChild(pill);
		pills.push(pill);
	}

	// Counter text
	const counter = document.createElement("div");
	counter.className = "pswp__chat-album-footer-counter";

	// ---- Update functions ----

	/** Instant (integer) update — fires on every `change`. */
	const updateInstant = () => {
		const current = (pswp.currSlide?.index ?? 0) + 1;
		counter.textContent = `${current} / ${contentLength}`;
		pills.forEach((pill, index) => {
			pill.classList.toggle(
				"pswp__chat-album-footer-pill--active",
				index === current - 1,
			);
			pill.classList.toggle(
				"pswp__chat-album-footer-pill--viewed",
				index < current - 1,
			);
		});
	};

	/** Fractional update — interpolates pill widths during drag. */
	const updateSmooth = (fractionalIndex: number) => {
		const clamped = Math.max(0, Math.min(contentLength - 1, fractionalIndex));
		const floorIdx = Math.floor(clamped);
		const frac = clamped - floorIdx;

		pills.forEach((pill, idx) => {
			if (idx === floorIdx && idx < contentLength - 1) {
				// Transitioning from this pill to the next
				const width = 10 + 6 * (1 - frac);
				const opacity = 0.95 - 0.95 * frac * 0.5;
				pill.style.width = `${width}px`;
				pill.style.opacity = String(Math.max(0.4, opacity));
				pill.classList.toggle("pswp__chat-album-footer-pill--active", frac < 0.5);
				pill.classList.toggle("pswp__chat-album-footer-pill--viewed", idx < floorIdx);
			} else if (idx === floorIdx + 1) {
				// Transitioning into this pill
				const width = 6 + 10 * frac;
				const opacity = 0.4 + 0.55 * frac;
				pill.style.width = `${width}px`;
				pill.style.opacity = String(Math.max(0.4, opacity));
				pill.classList.toggle("pswp__chat-album-footer-pill--active", frac >= 0.5);
				pill.classList.toggle("pswp__chat-album-footer-pill--viewed", idx <= floorIdx);
			} else {
				// Reset to CSS defaults
				pill.style.width = "";
				pill.style.opacity = "";
				pill.classList.toggle("pswp__chat-album-footer-pill--active", false);
				pill.classList.toggle(
					"pswp__chat-album-footer-pill--viewed",
					idx < floorIdx,
				);
			}
		});

		// Update counter text with fractional position
		const displayIdx = Math.min(
			contentLength,
			Math.max(1, Math.round(clamped + 1)),
		);
		counter.textContent = `${displayIdx} / ${contentLength}`;
	};

	// ---- Pointer tracking for smooth pill animation ----
	let pointerActive = false;
	let startIndex = 0;
	let startX = 0;
	let viewportW = window.innerWidth;

	const onPointerDown = (event: { originalEvent: PointerEvent }) => {
		const e = event.originalEvent;
		pointerActive = true;
		startIndex = pswp.currSlide?.index ?? 0;
		startX = e.clientX;
		viewportW = window.innerWidth;
	};

	const onPointerMove = (event: { originalEvent: PointerEvent }) => {
		if (!pointerActive || viewportW === 0) return;
		const e = event.originalEvent;
		const dx = e.clientX - startX;
		const ratio = dx / viewportW;
		const fractionalIdx = startIndex - ratio;
		updateSmooth(fractionalIdx);
	};

	const onPointerUp = () => {
		pointerActive = false;
	};

	// Reset pill inline styles on `change`
	const onSlideChange = () => {
		updateInstant();
		pills.forEach((pill) => {
			pill.style.width = "";
			pill.style.opacity = "";
		});
	};

	// Register PhotoSwipe listeners (they auto-clean when pswp is destroyed)
	pswp.on("pointerDown", onPointerDown);
	pswp.on("pointerMove", onPointerMove);
	pswp.on("pointerUp", onPointerUp);
	pswp.on("change", onSlideChange);

	// Initial render
	updateInstant();

	stack.append(pillRow, counter);
	return stack;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatExpiry(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	return `${days}d`;
}