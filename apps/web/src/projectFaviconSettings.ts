import { normalizeProjectRelativePath } from "@agents/shared/projectFavicon";
import { useCallback, useSyncExternalStore } from "react";

interface ProjectFaviconState {
	byProjectKey: Record<string, string>;
}

const STORAGE_KEY = "agents:project-favicons:v1";
const DEFAULT_STATE: ProjectFaviconState = {
	byProjectKey: {},
};

let listeners: Array<() => void> = [];
let cachedRawState: string | null | undefined;
let cachedSnapshot: ProjectFaviconState = DEFAULT_STATE;

function emitChange(): void {
	for (const listener of listeners) {
		listener();
	}
}

function parsePersistedState(raw: string | null): ProjectFaviconState {
	if (!raw) return DEFAULT_STATE;

	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object") {
			return DEFAULT_STATE;
		}

		const record = parsed as { byProjectKey?: unknown };
		const byProjectKey: Record<string, string> = {};

		if (record.byProjectKey && typeof record.byProjectKey === "object") {
			for (const [key, value] of Object.entries(record.byProjectKey)) {
				if (typeof key !== "string" || key.trim().length === 0) {
					continue;
				}
				if (typeof value !== "string") {
					continue;
				}
				const normalizedPath = normalizeProjectRelativePath(value);
				if (normalizedPath.length === 0) {
					continue;
				}
				byProjectKey[key] = normalizedPath;
			}
		}

		return { byProjectKey };
	} catch {
		return DEFAULT_STATE;
	}
}

function persistState(next: ProjectFaviconState): void {
	if (typeof window === "undefined") return;

	const raw = JSON.stringify(next);
	try {
		if (raw !== cachedRawState) {
			window.localStorage.setItem(STORAGE_KEY, raw);
		}
	} catch {
		// Best-effort only.
	}

	cachedRawState = raw;
	cachedSnapshot = next;
}

export function getProjectFaviconSettingsSnapshot(): ProjectFaviconState {
	if (typeof window === "undefined") {
		return DEFAULT_STATE;
	}

	const raw = window.localStorage.getItem(STORAGE_KEY);
	if (raw === cachedRawState) {
		return cachedSnapshot;
	}

	cachedRawState = raw;
	cachedSnapshot = parsePersistedState(raw);
	return cachedSnapshot;
}

export function getProjectFaviconOverrideForKey(
	projectKey: string | null,
): string | null {
	if (!projectKey) return null;
	return getProjectFaviconSettingsSnapshot().byProjectKey[projectKey] ?? null;
}

export function setProjectFaviconOverrideForKey(
	projectKey: string,
	relativePath: string,
): void {
	if (!projectKey || projectKey.trim().length === 0) return;

	const normalizedPath = normalizeProjectRelativePath(relativePath);
	if (normalizedPath.length === 0) return;

	const current = getProjectFaviconSettingsSnapshot();
	const next: ProjectFaviconState = {
		byProjectKey: {
			...current.byProjectKey,
			[projectKey]: normalizedPath,
		},
	};

	persistState(next);
	emitChange();
}

export function clearProjectFaviconOverrideForKey(projectKey: string): void {
	if (!projectKey || projectKey.trim().length === 0) return;

	const current = getProjectFaviconSettingsSnapshot();
	if (!(projectKey in current.byProjectKey)) {
		return;
	}

	const nextByProjectKey = { ...current.byProjectKey };
	delete nextByProjectKey[projectKey];
	persistState({ byProjectKey: nextByProjectKey });
	emitChange();
}

function subscribe(listener: () => void): () => void {
	listeners.push(listener);

	if (typeof window === "undefined") {
		return () => {
			listeners = listeners.filter((entry) => entry !== listener);
		};
	}

	const onStorage = (event: StorageEvent) => {
		if (event.key === STORAGE_KEY) {
			emitChange();
		}
	};

	window.addEventListener("storage", onStorage);

	return () => {
		listeners = listeners.filter((entry) => entry !== listener);
		window.removeEventListener("storage", onStorage);
	};
}

export function useProjectFaviconOverride(projectKey: string | null) {
	const state = useSyncExternalStore(
		subscribe,
		getProjectFaviconSettingsSnapshot,
		() => DEFAULT_STATE,
	);

	const relativePath = projectKey
		? (state.byProjectKey[projectKey] ?? null)
		: null;

	const setOverride = useCallback(
		(nextRelativePath: string) => {
			if (!projectKey) return;
			setProjectFaviconOverrideForKey(projectKey, nextRelativePath);
		},
		[projectKey],
	);

	const clearOverride = useCallback(() => {
		if (!projectKey) return;
		clearProjectFaviconOverrideForKey(projectKey);
	}, [projectKey]);

	return {
		relativePath,
		setOverride,
		clearOverride,
	} as const;
}
