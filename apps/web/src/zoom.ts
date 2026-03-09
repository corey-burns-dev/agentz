/**
 * App-level zoom (scaling) for the desktop shell.
 *
 * Keyboard shortcuts (Ctrl or Cmd):
 *   +  /  =   →  zoom in
 *   -        →  zoom out
 *   0        →  reset to 100%
 *
 * The zoom level is persisted in localStorage so it survives restarts.
 * Keyboard handling is only registered in the desktop shell; in a regular
 * browser the native browser zoom works fine on its own.
 */

import { isDesktopShell } from "./env";

const STORAGE_KEY = "app:zoom";
const MIN = 0.5;
const MAX = 3.0;
const DEFAULT = 1.0;

// Discrete zoom levels that snap to clean values (matches Electron behaviour).
const LEVELS = [
	0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0,
];

function clamp(v: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, v));
}

function round2(v: number): number {
	return Math.round(v * 100) / 100;
}

function readStored(): number {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw !== null) {
			const v = parseFloat(raw);
			if (Number.isFinite(v)) return clamp(v, MIN, MAX);
		}
	} catch {
		// localStorage may be unavailable
	}
	return DEFAULT;
}

function writeStored(zoom: number): void {
	try {
		localStorage.setItem(STORAGE_KEY, String(zoom));
	} catch {
		// ignore
	}
}

function applyZoom(zoom: number): void {
	if (zoom === DEFAULT) {
		document.documentElement.style.removeProperty("zoom");
	} else {
		document.documentElement.style.zoom = String(zoom);
	}
}

function nearestLevelIndex(current: number): number {
	let best = 0;
	let bestDist = Infinity;
	for (let i = 0; i < LEVELS.length; i++) {
		const dist = Math.abs((LEVELS[i] as number) - current);
		if (dist < bestDist) {
			bestDist = dist;
			best = i;
		}
	}
	return best;
}

function stepIn(current: number): number {
	const idx = nearestLevelIndex(current);
	const next = LEVELS[Math.min(idx + 1, LEVELS.length - 1)] as number;
	return next;
}

function stepOut(current: number): number {
	const idx = nearestLevelIndex(current);
	const prev = LEVELS[Math.max(idx - 1, 0)] as number;
	return prev;
}

function setZoom(zoom: number): void {
	const v = clamp(round2(zoom), MIN, MAX);
	writeStored(v);
	applyZoom(v);
}

export function setupZoom(): void {
	// Always restore persisted zoom on startup.
	applyZoom(readStored());

	// Only intercept keyboard shortcuts in the desktop shell.
	if (!isDesktopShell) return;

	window.addEventListener(
		"keydown",
		(event) => {
			const isMod = event.ctrlKey || event.metaKey;
			if (!isMod) return;

			const key = event.key;

			if (key === "=" || key === "+") {
				event.preventDefault();
				setZoom(stepIn(readStored()));
			} else if (key === "-" || key === "_") {
				event.preventDefault();
				setZoom(stepOut(readStored()));
			} else if (key === "0") {
				event.preventDefault();
				setZoom(DEFAULT);
			}
		},
		{ capture: true },
	);
}

/** Exposed for the View menu if you want to wire up menu items later. */
export const zoom = {
	in: () => setZoom(stepIn(readStored())),
	out: () => setZoom(stepOut(readStored())),
	reset: () => setZoom(DEFAULT),
	get current() {
		return readStored();
	},
} as const;
