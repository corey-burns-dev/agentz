import { useCallback } from "react";

import {
  type ResolvedTheme,
  resolveUISettingsTheme,
  type ThemeMode,
  useUISettings,
} from "../uiSettings";

export type Theme = ThemeMode;

export function useTheme() {
  const { settings, updateUISettings } = useUISettings();
  const { resolvedTheme } = resolveUISettingsTheme(settings);

  const setTheme = useCallback(
    (next: Theme) => {
      updateUISettings({ themeMode: next });
    },
    [updateUISettings],
  );

  return {
    theme: settings.themeMode,
    setTheme,
    resolvedTheme: resolvedTheme as ResolvedTheme,
  } as const;
}
