import { Option, Schema } from "effect";
import { useCallback, useSyncExternalStore } from "react";

const UI_SETTINGS_STORAGE_KEY = "agents:ui-settings:v1";
const LEGACY_THEME_STORAGE_KEY = "agents:theme";
const MEDIA_QUERY = "(prefers-color-scheme: dark)";

export const THEME_MODE_OPTIONS = ["system", "light", "dark"] as const;
export type ThemeMode = (typeof THEME_MODE_OPTIONS)[number];

export const DARK_THEME_PRESETS = [
	"default-dark",
	"midnight",
	"nord",
	"catppuccin-mocha",
	"dark-modern",
	"tokyo-night",
] as const;

export type ThemePreset = (typeof DARK_THEME_PRESETS)[number];

export const LIGHT_THEME_PRESET = "default-light" as const;
export type AppliedThemePreset = ThemePreset | typeof LIGHT_THEME_PRESET;

export const DENSITY_OPTIONS = ["compact", "comfortable", "spacious"] as const;
export type DensityOption = (typeof DENSITY_OPTIONS)[number];

export const DIFF_SIZE_OPTIONS = [
	"compact",
	"balanced",
	"comfortable",
] as const;
export type DiffSizeOption = (typeof DIFF_SIZE_OPTIONS)[number];

export const RADIUS_PRESETS = ["sharp", "default", "rounded", "pill"] as const;
export type RadiusPreset = (typeof RADIUS_PRESETS)[number];
export const PROJECT_FAVICON_SIZE_OPTIONS = [
	"small",
	"medium",
	"large",
] as const;
export type ProjectFaviconDisplaySize =
	(typeof PROJECT_FAVICON_SIZE_OPTIONS)[number];

export const SIDEBAR_SPACING_OPTIONS = [
	"compact",
	"default",
	"spacious",
] as const;
export type SidebarSpacingOption = (typeof SIDEBAR_SPACING_OPTIONS)[number];

export type ResolvedTheme = "light" | "dark";

const LEGACY_THEME_PRESETS = [
	...DARK_THEME_PRESETS,
	LIGHT_THEME_PRESET,
] as const;

const RADIUS_VALUES: Record<RadiusPreset, string> = {
	sharp: "0rem",
	default: "0.625rem",
	rounded: "1rem",
	pill: "1.5rem",
};

const UISettingsSchema = Schema.Struct({
	themeMode: Schema.Literals(THEME_MODE_OPTIONS).pipe(
		Schema.withConstructorDefault(() => Option.some<ThemeMode>("system")),
	),
	themePreset: Schema.Literals(DARK_THEME_PRESETS).pipe(
		Schema.withConstructorDefault(() =>
			Option.some<ThemePreset>("default-dark"),
		),
	),
	glassEffect: Schema.Boolean.pipe(
		Schema.withConstructorDefault(() => Option.some(false)),
	),
	fontSize: Schema.Number.check(
		Schema.isBetween({ minimum: 75, maximum: 125 }),
	).pipe(Schema.withConstructorDefault(() => Option.some(100))),
	density: Schema.Literals(DENSITY_OPTIONS).pipe(
		Schema.withConstructorDefault(() =>
			Option.some<DensityOption>("comfortable"),
		),
	),
	diffSize: Schema.Literals(DIFF_SIZE_OPTIONS).pipe(
		Schema.withConstructorDefault(() =>
			Option.some<DiffSizeOption>("balanced"),
		),
	),
	diffWrap: Schema.Boolean.pipe(
		Schema.withConstructorDefault(() => Option.some(false)),
	),
	diffShowLineNumbers: Schema.Boolean.pipe(
		Schema.withConstructorDefault(() => Option.some(true)),
	),
	diffShowFileNavigator: Schema.Boolean.pipe(
		Schema.withConstructorDefault(() => Option.some(true)),
	),
	radiusPreset: Schema.Literals(RADIUS_PRESETS).pipe(
		Schema.withConstructorDefault(() => Option.some<RadiusPreset>("default")),
	),
	projectFaviconSize: Schema.Literals(PROJECT_FAVICON_SIZE_OPTIONS).pipe(
		Schema.withConstructorDefault(() =>
			Option.some<ProjectFaviconDisplaySize>("medium"),
		),
	),
	sidebarSpacing: Schema.Literals(SIDEBAR_SPACING_OPTIONS).pipe(
		Schema.withConstructorDefault(() =>
			Option.some<SidebarSpacingOption>("default"),
		),
	),
});

export type UISettings = typeof UISettingsSchema.Type;

const DEFAULT_UI_SETTINGS = UISettingsSchema.makeUnsafe({});

let listeners: Array<() => void> = [];
let cachedRawSettings: string | null | undefined;
let cachedSnapshot: UISettings = DEFAULT_UI_SETTINGS;
let listenerRefCount = 0;
let registeredMediaQuery: MediaQueryList | null = null;

function emitChange(): void {
	for (const listener of listeners) {
		listener();
	}
}

function getSystemDark(): boolean {
	return (
		typeof window !== "undefined" && window.matchMedia(MEDIA_QUERY).matches
	);
}

// Migrates from the old `agents:theme` localStorage key (pre-v8).
// Can be removed after 2027-01.
function migrateFromLegacyTheme(): ThemeMode | null {
	if (typeof window === "undefined") return null;
	const raw = window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
	if (raw === "light" || raw === "dark" || raw === "system") {
		return raw;
	}
	return null;
}

function parseLegacyPreset(
	value: unknown,
): (typeof LEGACY_THEME_PRESETS)[number] | null {
	return LEGACY_THEME_PRESETS.includes(
		value as (typeof LEGACY_THEME_PRESETS)[number],
	)
		? (value as (typeof LEGACY_THEME_PRESETS)[number])
		: null;
}

function parseThemeMode(value: unknown): ThemeMode | null {
	return THEME_MODE_OPTIONS.includes(value as ThemeMode)
		? (value as ThemeMode)
		: null;
}

function parseThemePreset(value: unknown): ThemePreset | null {
	return DARK_THEME_PRESETS.includes(value as ThemePreset)
		? (value as ThemePreset)
		: null;
}

function decodeUISettingsOrDefault(value: unknown): UISettings {
	try {
		const merged =
			value && typeof value === "object"
				? { ...DEFAULT_UI_SETTINGS, ...(value as Record<string, unknown>) }
				: DEFAULT_UI_SETTINGS;
		return Schema.decodeUnknownSync(UISettingsSchema as never)(merged);
	} catch {
		return DEFAULT_UI_SETTINGS;
	}
}

export function resolveThemeMode(
	themeMode: ThemeMode,
	systemDark: boolean,
): ResolvedTheme {
	if (themeMode === "system") {
		return systemDark ? "dark" : "light";
	}
	return themeMode;
}

export function resolveAppliedThemePreset(
	settings: Pick<UISettings, "themeMode" | "themePreset">,
	systemDark = getSystemDark(),
): AppliedThemePreset {
	return resolveThemeMode(settings.themeMode, systemDark) === "light"
		? LIGHT_THEME_PRESET
		: settings.themePreset;
}

export function resolveUISettingsTheme(
	settings: Pick<UISettings, "themeMode" | "themePreset">,
	systemDark = getSystemDark(),
): {
	appliedThemePreset: AppliedThemePreset;
	resolvedTheme: ResolvedTheme;
} {
	const resolvedTheme = resolveThemeMode(settings.themeMode, systemDark);
	return {
		appliedThemePreset:
			resolvedTheme === "light" ? LIGHT_THEME_PRESET : settings.themePreset,
		resolvedTheme,
	};
}

export function normalizePersistedUISettings(
	value: unknown,
	legacyThemeMode: ThemeMode | null,
): UISettings {
	const record =
		value && typeof value === "object"
			? (value as Record<string, unknown>)
			: {};
	const storedThemeMode = parseThemeMode(record.themeMode);
	const legacyPreset = parseLegacyPreset(record.themePreset);
	const storedThemePreset = parseThemePreset(record.themePreset);

	const inferredThemeMode =
		storedThemeMode ??
		legacyThemeMode ??
		(legacyPreset === LIGHT_THEME_PRESET
			? "light"
			: legacyPreset
				? "dark"
				: DEFAULT_UI_SETTINGS.themeMode);

	const normalizedThemePreset =
		storedThemePreset ??
		(legacyPreset && legacyPreset !== LIGHT_THEME_PRESET
			? legacyPreset
			: DEFAULT_UI_SETTINGS.themePreset);

	return decodeUISettingsOrDefault({
		...record,
		themeMode: inferredThemeMode,
		themePreset: normalizedThemePreset,
	});
}

function parsePersistedSettings(raw: string | null): UISettings {
	// Only read legacy storage when no new settings are stored yet —
	// persistUISettings already removes the legacy key on every save.
	const legacyThemeMode = raw === null ? migrateFromLegacyTheme() : null;
	if (!raw) {
		return normalizePersistedUISettings({}, legacyThemeMode);
	}

	try {
		return normalizePersistedUISettings(JSON.parse(raw), legacyThemeMode);
	} catch {
		return normalizePersistedUISettings({}, legacyThemeMode);
	}
}

export function getUISettingsSnapshot(): UISettings {
	if (typeof window === "undefined") return DEFAULT_UI_SETTINGS;
	const raw = window.localStorage.getItem(UI_SETTINGS_STORAGE_KEY);
	if (raw === cachedRawSettings) return cachedSnapshot;
	cachedRawSettings = raw;
	cachedSnapshot = parsePersistedSettings(raw);
	return cachedSnapshot;
}

function persistUISettings(next: UISettings): void {
	if (typeof window === "undefined") return;
	const raw = JSON.stringify(next);
	try {
		if (raw !== cachedRawSettings) {
			window.localStorage.setItem(UI_SETTINGS_STORAGE_KEY, raw);
		}
		window.localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
	} catch {
		// Best-effort persistence only.
	}
	cachedRawSettings = raw;
	cachedSnapshot = next;
}

function applyResolvedThemeClass(
	resolvedTheme: ResolvedTheme,
	suppressTransitions: boolean,
): void {
	if (typeof document === "undefined") return;

	const html = document.documentElement;
	if (suppressTransitions) {
		html.classList.add("no-transitions");
	}
	html.classList.toggle("dark", resolvedTheme === "dark");
	if (suppressTransitions) {
		void html.offsetHeight;
		requestAnimationFrame(() => {
			html.classList.remove("no-transitions");
		});
	}
}

function handleMediaChange() {
	const settings = getUISettingsSnapshot();
	if (settings.themeMode !== "system") return;
	applyUISettings(settings, true);
	emitChange();
}

function handleStorageChange(event: StorageEvent) {
	if (
		event.key === UI_SETTINGS_STORAGE_KEY ||
		event.key === LEGACY_THEME_STORAGE_KEY
	) {
		const settings = getUISettingsSnapshot();
		applyUISettings(settings);
		emitChange();
	}
}

function subscribe(listener: () => void): () => void {
	listeners.push(listener);

	if (typeof window !== "undefined") {
		if (listenerRefCount === 0) {
			registeredMediaQuery = window.matchMedia(MEDIA_QUERY);
			registeredMediaQuery.addEventListener("change", handleMediaChange);
			window.addEventListener("storage", handleStorageChange);
		}
		listenerRefCount++;
	}

	return () => {
		listeners = listeners.filter((entry) => entry !== listener);
		if (typeof window !== "undefined") {
			listenerRefCount--;
			if (listenerRefCount === 0) {
				registeredMediaQuery?.removeEventListener("change", handleMediaChange);
				window.removeEventListener("storage", handleStorageChange);
				registeredMediaQuery = null;
			}
		}
	};
}

export function applyUISettings(
	settings: UISettings,
	suppressTransitions = false,
): void {
	if (typeof document === "undefined") return;

	const html = document.documentElement;
	const { resolvedTheme, appliedThemePreset } =
		resolveUISettingsTheme(settings);

	html.setAttribute("data-theme", appliedThemePreset);
	html.setAttribute("data-density", settings.density);
	html.classList.toggle("glass", settings.glassEffect);
	html.style.fontSize = `${settings.fontSize}%`;
	html.style.setProperty("--radius", RADIUS_VALUES[settings.radiusPreset]);

	applyResolvedThemeClass(resolvedTheme, suppressTransitions);
}

// Apply immediately on module load to prevent flash.
applyUISettings(getUISettingsSnapshot());

export function useUISettings() {
	const settings = useSyncExternalStore(
		subscribe,
		getUISettingsSnapshot,
		() => DEFAULT_UI_SETTINGS,
	);

	const updateUISettings = useCallback((patch: Partial<UISettings>) => {
		const current = getUISettingsSnapshot();
		const next = decodeUISettingsOrDefault({
			...current,
			...patch,
			themePreset:
				patch.themeMode === "light"
					? current.themePreset
					: (patch.themePreset ?? current.themePreset),
		});
		persistUISettings(next);
		applyUISettings(next, true);
		emitChange();
	}, []);

	const resetUISettings = useCallback(() => {
		persistUISettings(DEFAULT_UI_SETTINGS);
		applyUISettings(DEFAULT_UI_SETTINGS, true);
		emitChange();
	}, []);

	return {
		settings,
		updateUISettings,
		resetUISettings,
		defaults: DEFAULT_UI_SETTINGS,
	} as const;
}
