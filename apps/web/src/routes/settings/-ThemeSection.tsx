import {
	SettingsCardRadioGroup,
	type SettingsOption,
	SettingsSegmentedControl,
} from "~/components/settings/SettingsRadioGroup";
import {
	SettingsHint,
	SettingsPanel,
	SettingsSection,
	SettingsToggleRow,
} from "~/components/settings/SettingsSection";
import {
	type AppliedThemePreset,
	DARK_THEME_PRESETS,
	DENSITY_OPTIONS,
	LIGHT_THEME_PRESET,
	RADIUS_PRESETS,
	resolveUISettingsTheme,
	THEME_MODE_OPTIONS,
	type ThemeMode,
	useUISettings,
} from "~/uiSettings";

const THEME_SWATCH_META: Record<
	AppliedThemePreset,
	{ bg: string; card: string; primary: string; label: string }
> = {
	"default-dark": {
		bg: "#0d0d0f",
		card: "#131315",
		primary: "#7c6af7",
		label: "Dark",
	},
	midnight: {
		bg: "#05050a",
		card: "#0a0a14",
		primary: "#8b7ef8",
		label: "Midnight",
	},
	nord: { bg: "#2e3440", card: "#3b4252", primary: "#88c0d0", label: "Nord" },
	"catppuccin-mocha": {
		bg: "#1e1e2e",
		card: "#313244",
		primary: "#cba6f7",
		label: "Mocha",
	},
	"dark-modern": {
		bg: "#181818",
		card: "#1f1f1f",
		primary: "#007fd4",
		label: "Dark Modern",
	},
	"tokyo-night": {
		bg: "#1a1b26",
		card: "#24283b",
		primary: "#7aa2f7",
		label: "Tokyo Night",
	},
	"default-light": {
		bg: "#ffffff",
		card: "#f0f0f2",
		primary: "#6356e5",
		label: "Light",
	},
};

const THEME_MODE_LABELS: Record<ThemeMode, string> = {
	system: "System",
	light: "Light",
	dark: "Dark",
};

const RADIUS_PREVIEW_PX: Record<(typeof RADIUS_PRESETS)[number], number> = {
	sharp: 0,
	default: 6,
	rounded: 10,
	pill: 18,
};

const DENSITY_LABELS: Record<(typeof DENSITY_OPTIONS)[number], string> = {
	compact: "Compact",
	comfortable: "Comfortable",
	spacious: "Spacious",
};

const RADIUS_LABELS: Record<(typeof RADIUS_PRESETS)[number], string> = {
	sharp: "Sharp",
	default: "Default",
	rounded: "Rounded",
	pill: "Pill",
};

const THEME_MODE_OPTIONS_LIST: ReadonlyArray<SettingsOption<ThemeMode>> =
	THEME_MODE_OPTIONS.map((mode) => ({
		value: mode,
		label: THEME_MODE_LABELS[mode],
		description:
			mode === "system"
				? "Match your OS setting."
				: mode === "light"
					? "Use the light palette."
					: "Use a dark palette.",
	}));

const DENSITY_OPTIONS_LIST: ReadonlyArray<
	SettingsOption<(typeof DENSITY_OPTIONS)[number]>
> = DENSITY_OPTIONS.map((density) => ({
	value: density,
	label: DENSITY_LABELS[density],
}));

const RADIUS_OPTIONS_LIST: ReadonlyArray<
	SettingsOption<(typeof RADIUS_PRESETS)[number]>
> = RADIUS_PRESETS.map((radius) => ({
	value: radius,
	label: RADIUS_LABELS[radius],
}));

const PALETTE_OPTIONS: ReadonlyArray<
	SettingsOption<(typeof DARK_THEME_PRESETS)[number]>
> = DARK_THEME_PRESETS.map((preset) => ({
	value: preset,
	label: THEME_SWATCH_META[preset].label,
}));

function ThemeSwatchPreview({ preset }: { preset: AppliedThemePreset }) {
	const meta = THEME_SWATCH_META[preset];
	const isLight = preset === LIGHT_THEME_PRESET;

	return (
		<div className="flex w-full flex-col items-center gap-2">
			<div
				className="relative h-14 w-full max-w-24 overflow-hidden rounded-md border border-black/5 shadow-xs/5"
				style={{ background: meta.bg }}
				aria-hidden="true"
			>
				<div
					className="absolute inset-x-0 bottom-0 h-7 rounded-t"
					style={{ background: meta.card }}
				/>
				<div
					className="absolute bottom-2 right-2 h-3 w-3 rounded-full"
					style={{ background: meta.primary }}
				/>
				<div
					className="absolute left-2 top-2 h-1 w-8 rounded-full opacity-40"
					style={{ background: isLight ? "#333" : "#fff" }}
				/>
				<div
					className="absolute left-2 top-[1.125rem] h-1 w-5 rounded-full opacity-25"
					style={{ background: isLight ? "#333" : "#fff" }}
				/>
			</div>
			<span className="text-2xs font-medium text-current">{meta.label}</span>
		</div>
	);
}

function RadiusPreviewCard({
	radius,
	selected,
}: {
	radius: (typeof RADIUS_PRESETS)[number];
	selected: boolean;
}) {
	return (
		<div className="flex w-full flex-col items-center gap-2">
			<div
				className={`h-8 w-11 border-2 transition-colors ${
					selected ? "border-primary" : "border-muted-foreground/40"
				}`}
				style={{ borderRadius: `${RADIUS_PREVIEW_PX[radius]}px` }}
				aria-hidden="true"
			/>
			<span
				className={`text-2xs font-medium ${
					selected ? "text-primary" : "text-muted-foreground"
				}`}
			>
				{RADIUS_LABELS[radius]}
			</span>
		</div>
	);
}

export function ThemeSection() {
	const { settings: uiSettings, updateUISettings } = useUISettings();
	const { resolvedTheme } = resolveUISettingsTheme(uiSettings);

	return (
		<SettingsSection
			title="Appearance"
			description="Customize colors, typography, spacing, and motion density."
		>
			<div className="space-y-5">
				<div className="space-y-2.5">
					<div className="space-y-1">
						<p className="text-xs font-medium text-foreground">Theme mode</p>
						<SettingsHint>
							{uiSettings.themeMode === "system"
								? `Following your OS appearance. Currently ${resolvedTheme}.`
								: uiSettings.themeMode === "light"
									? "The light palette stays active until you switch back."
									: "Dark mode uses the palette selected below."}
						</SettingsHint>
					</div>
					<SettingsSegmentedControl
						legend="Theme mode"
						value={uiSettings.themeMode}
						onChange={(themeMode) => updateUISettings({ themeMode })}
						options={THEME_MODE_OPTIONS_LIST}
					/>
				</div>

				<div className="space-y-2.5">
					<div className="space-y-1">
						<p className="text-xs font-medium text-foreground">Palette</p>
						<SettingsHint>
							Light mode uses a single shared palette. Dark mode exposes
							additional presets.
						</SettingsHint>
					</div>
					{resolvedTheme === "light" ? (
						<SettingsPanel className="max-w-40">
							<ThemeSwatchPreview preset={LIGHT_THEME_PRESET} />
						</SettingsPanel>
					) : (
						<SettingsCardRadioGroup
							legend="Theme palette"
							value={uiSettings.themePreset}
							onChange={(themePreset) => updateUISettings({ themePreset })}
							options={PALETTE_OPTIONS}
							className="grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
							renderCard={(option) => (
								<ThemeSwatchPreview preset={option.value} />
							)}
						/>
					)}
				</div>

				<div className="space-y-2.5">
					<div className="flex items-center justify-between gap-3">
						<p className="text-xs font-medium text-foreground">Font size</p>
						<span className="text-xs tabular-nums text-muted-foreground">
							{uiSettings.fontSize}%
						</span>
					</div>
					<label className="flex items-center gap-3 rounded-xl border border-border bg-background/50 px-4 py-3">
						<span className="text-xs text-muted-foreground">A</span>
						<input
							type="range"
							min={75}
							max={125}
							step={5}
							value={uiSettings.fontSize}
							onChange={(event) =>
								updateUISettings({
									fontSize: Number(event.target.value),
								})
							}
							className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-border accent-primary"
							aria-label="Font size"
							aria-valuetext={`${uiSettings.fontSize} percent`}
						/>
						<span className="text-base text-muted-foreground">A</span>
					</label>
				</div>

				<div className="space-y-2.5">
					<div className="space-y-1">
						<p className="text-xs font-medium text-foreground">Density</p>
						<SettingsHint>
							Adjust chrome spacing without changing the message layout itself.
						</SettingsHint>
					</div>
					<SettingsSegmentedControl
						legend="UI density"
						value={uiSettings.density}
						onChange={(density) => updateUISettings({ density })}
						options={DENSITY_OPTIONS_LIST}
					/>
				</div>

				<div className="space-y-2.5">
					<div className="space-y-1">
						<p className="text-xs font-medium text-foreground">Corner radius</p>
						<SettingsHint>
							Use sharper chrome for dense workspaces or softer corners for a
							more relaxed look.
						</SettingsHint>
					</div>
					<SettingsCardRadioGroup
						legend="Corner radius"
						value={uiSettings.radiusPreset}
						onChange={(radiusPreset) => updateUISettings({ radiusPreset })}
						options={RADIUS_OPTIONS_LIST}
						className="grid-cols-2 sm:grid-cols-4"
						renderCard={(option, selected) => (
							<RadiusPreviewCard radius={option.value} selected={selected} />
						)}
					/>
				</div>

				<SettingsToggleRow
					title="Glass effect"
					description="Adds blur and transparency to panels. This can increase GPU work on low-power devices."
					checked={uiSettings.glassEffect}
					onCheckedChange={(glassEffect) =>
						updateUISettings({
							glassEffect,
						})
					}
					ariaLabel="Toggle glass effect"
				/>
			</div>
		</SettingsSection>
	);
}
