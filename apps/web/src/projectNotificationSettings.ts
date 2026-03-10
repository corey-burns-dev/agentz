import { useCallback, useSyncExternalStore } from "react";

export interface PerProjectNotificationSettings {
  /**
   * When true, disables all notifications (toasts, sounds, OS) for this project.
   */
  disabled?: boolean;

  /**
   * When false, suppresses notifications for successful turn completion.
   * When undefined, falls back to global defaults.
   */
  notifyOnTurnComplete?: boolean;

  /**
   * When false, suppresses notifications for error events.
   * When undefined, falls back to global defaults.
   */
  notifyOnError?: boolean;
}

interface ProjectNotificationState {
  byProjectKey: Record<string, PerProjectNotificationSettings>;
}

const STORAGE_KEY = "agents:project-notifications:v1";

const DEFAULT_STATE: ProjectNotificationState = {
  byProjectKey: {},
};

let listeners: Array<() => void> = [];
let cachedRawState: string | null | undefined;
let cachedSnapshot: ProjectNotificationState = DEFAULT_STATE;

function emitChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

function parsePersistedState(raw: string | null): ProjectNotificationState {
  if (!raw) return DEFAULT_STATE;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return DEFAULT_STATE;
    }

    const record = parsed as { byProjectKey?: unknown };
    const byProjectKey: Record<string, PerProjectNotificationSettings> = {};

    if (record.byProjectKey && typeof record.byProjectKey === "object") {
      for (const [key, value] of Object.entries(record.byProjectKey)) {
        if (typeof key !== "string" || key.trim().length === 0) {
          continue;
        }
        if (!value || typeof value !== "object") {
          continue;
        }
        const entry = value as Record<string, unknown>;
        const settings: PerProjectNotificationSettings = {};

        if (typeof entry.disabled === "boolean") {
          settings.disabled = entry.disabled;
        }
        if (typeof entry.notifyOnTurnComplete === "boolean") {
          settings.notifyOnTurnComplete = entry.notifyOnTurnComplete;
        }
        if (typeof entry.notifyOnError === "boolean") {
          settings.notifyOnError = entry.notifyOnError;
        }

        if (Object.keys(settings).length > 0) {
          byProjectKey[key] = settings;
        }
      }
    }

    return { byProjectKey };
  } catch {
    return DEFAULT_STATE;
  }
}

function persistState(next: ProjectNotificationState): void {
  if (typeof window === "undefined") return;

  const raw = JSON.stringify(next);
  try {
    if (raw !== cachedRawState) {
      window.localStorage.setItem(STORAGE_KEY, raw);
    }
  } catch {
    // Best-effort only; ignore quota/storage errors.
  }

  cachedRawState = raw;
  cachedSnapshot = next;
}

export function getProjectNotificationSettingsSnapshot(): ProjectNotificationState {
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

export function getProjectNotificationSettingsForKey(
  projectKey: string | null,
): PerProjectNotificationSettings {
  if (!projectKey) return {};
  const snapshot = getProjectNotificationSettingsSnapshot();
  return snapshot.byProjectKey[projectKey] ?? {};
}

export function updateProjectNotificationSettingsForKey(
  projectKey: string,
  patch: PerProjectNotificationSettings,
): void {
  if (!projectKey || projectKey.trim().length === 0) return;

  const current = getProjectNotificationSettingsSnapshot();
  const existing = current.byProjectKey[projectKey] ?? {};
  const nextSettings: PerProjectNotificationSettings = {
    ...existing,
    ...patch,
  };

  const next: ProjectNotificationState = {
    byProjectKey: {
      ...current.byProjectKey,
      [projectKey]: nextSettings,
    },
  };

  persistState(next);
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

export function useProjectNotificationSettings(projectKey: string | null) {
  const state = useSyncExternalStore(
    subscribe,
    getProjectNotificationSettingsSnapshot,
    () => DEFAULT_STATE,
  );

  const effectiveKey = projectKey ?? null;
  const rawSettings =
    effectiveKey && effectiveKey in state.byProjectKey
      ? state.byProjectKey[effectiveKey]
      : undefined;
  const settings: PerProjectNotificationSettings = rawSettings ?? {};

  const updateSettings = useCallback(
    (patch: PerProjectNotificationSettings) => {
      if (!effectiveKey) return;
      updateProjectNotificationSettingsForKey(effectiveKey, patch);
    },
    [effectiveKey],
  );

  return {
    settings,
    updateSettings,
  } as const;
}
