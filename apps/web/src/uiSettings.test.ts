import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockWindowOptions = {
	legacyTheme?: string | null;
	rawUISettings?: string | null;
	systemDark?: boolean;
};

function createDocumentElement() {
	const attributes = new Map<string, string>();
	const styleValues = new Map<string, string>();
	const classes = new Set<string>();

	return {
		classList: {
			add: (...tokens: string[]) => {
				for (const token of tokens) classes.add(token);
			},
			remove: (...tokens: string[]) => {
				for (const token of tokens) classes.delete(token);
			},
			contains: (token: string) => classes.has(token),
			toggle: (token: string, force?: boolean) => {
				if (force === undefined) {
					if (classes.has(token)) {
						classes.delete(token);
						return false;
					}
					classes.add(token);
					return true;
				}
				if (force) {
					classes.add(token);
					return true;
				}
				classes.delete(token);
				return false;
			},
		},
		getAttribute: (name: string) => attributes.get(name) ?? null,
		offsetHeight: 0,
		setAttribute: (name: string, value: string) => {
			attributes.set(name, value);
		},
		style: {
			fontSize: "",
			setProperty: (name: string, value: string) => {
				styleValues.set(name, value);
			},
			getPropertyValue: (name: string) => styleValues.get(name) ?? "",
		},
	};
}

function stubBrowserEnvironment(options: MockWindowOptions = {}) {
	const storage = new Map<string, string>();
	if (options.rawUISettings != null) {
		storage.set("agents:ui-settings:v1", options.rawUISettings);
	}
	if (options.legacyTheme != null) {
		storage.set("agents:theme", options.legacyTheme);
	}

	const mediaQuery = {
		matches: options.systemDark ?? false,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	};

	const documentElement = createDocumentElement();

	vi.stubGlobal("window", {
		localStorage: {
			getItem: (key: string) => storage.get(key) ?? null,
			removeItem: (key: string) => {
				storage.delete(key);
			},
			setItem: (key: string, value: string) => {
				storage.set(key, value);
			},
		},
		matchMedia: vi.fn(() => mediaQuery),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	});
	vi.stubGlobal("document", {
		documentElement,
	});
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		callback(0);
		return 0;
	});

	return { documentElement, storage };
}

describe("uiSettings", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("normalizes legacy light preset migrations into explicit light mode", async () => {
		const { normalizePersistedUISettings } = await import("./uiSettings");

		expect(
			normalizePersistedUISettings(
				{
					themePreset: "default-light",
					fontSize: 105,
				},
				null,
			),
		).toMatchObject({
			fontSize: 105,
			themeMode: "light",
			themePreset: "default-dark",
		});
	});

	it("folds legacy theme storage into the unified settings snapshot", async () => {
		stubBrowserEnvironment({ legacyTheme: "dark" });
		const { getUISettingsSnapshot } = await import("./uiSettings");

		expect(getUISettingsSnapshot()).toMatchObject({
			diffShowFileNavigator: true,
			diffShowLineNumbers: true,
			diffSize: "balanced",
			diffWrap: false,
			projectFaviconSize: "medium",
			themeMode: "dark",
			themePreset: "default-dark",
		});
	});

	it("resolves system mode to the light palette when the OS is light", async () => {
		const { resolveUISettingsTheme } = await import("./uiSettings");

		expect(
			resolveUISettingsTheme(
				{
					themeMode: "system",
					themePreset: "nord",
				},
				false,
			),
		).toEqual({
			appliedThemePreset: "default-light",
			resolvedTheme: "light",
		});
	});

	it("applies density, radius, and dark preset attributes to the document", async () => {
		const { documentElement } = stubBrowserEnvironment({ systemDark: true });
		const { applyUISettings } = await import("./uiSettings");

		applyUISettings({
			density: "spacious",
			diffShowFileNavigator: true,
			diffShowLineNumbers: true,
			diffSize: "balanced",
			diffWrap: false,
			fontSize: 110,
			glassEffect: true,
			projectFaviconSize: "large",
			radiusPreset: "pill",
			sidebarSpacing: "default",
			themeMode: "dark",
			themePreset: "midnight",
		});

		expect(documentElement.getAttribute("data-theme")).toBe("midnight");
		expect(documentElement.getAttribute("data-density")).toBe("spacious");
		expect(documentElement.classList.contains("dark")).toBe(true);
		expect(documentElement.classList.contains("glass")).toBe(true);
		expect(documentElement.style.fontSize).toBe("110%");
		expect(documentElement.style.getPropertyValue("--radius")).toBe("1.5rem");
	});
});
