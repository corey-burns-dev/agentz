export const SETTINGS_TABS = [
  {
    id: "appearance",
    label: "Appearance",
    description: "Theme, density, and chrome.",
  },
  {
    id: "providers",
    label: "Providers",
    description: "Codex, Gemini, and Claude paths.",
  },
  {
    id: "models",
    label: "Models",
    description: "Default tier and custom slugs.",
  },
  {
    id: "responses",
    label: "Responses",
    description: "How assistant output is rendered.",
  },
  {
    id: "notifications",
    label: "Notifications & sounds",
    description: "Alerts and sound feedback (coming soon).",
  },
  {
    id: "keybindings",
    label: "Keybindings",
    description: "Open and edit keybindings.json.",
  },
  {
    id: "safety",
    label: "Safety",
    description: "Confirmation prompts for destructive actions.",
  },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];

const SETTINGS_TAB_IDS = new Set<string>(SETTINGS_TABS.map((tab) => tab.id));

export function parseSettingsTab(value: unknown): SettingsTab {
  return typeof value === "string" && SETTINGS_TAB_IDS.has(value)
    ? (value as SettingsTab)
    : "appearance";
}

export function stripSettingsTabSearchParams<T extends Record<string, unknown>>(
  params: T,
): Omit<T, "tab"> {
  const { tab: _tab, ...rest } = params;
  return rest as Omit<T, "tab">;
}
