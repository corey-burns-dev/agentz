import { describe, expect, it } from "vitest";

import {
	getAppModelOptions,
	getCustomModelsForProvider,
	getProviderStartOptionsForProvider,
	getSlashModelOptions,
	normalizeCustomModelSlugs,
	patchCustomModelsForProvider,
	resolveAppModelSelection,
	resolveAppServiceTier,
	shouldShowFastTierIcon,
} from "./appSettings";

describe("normalizeCustomModelSlugs", () => {
	it("normalizes aliases, removes built-ins, and deduplicates values", () => {
		expect(
			normalizeCustomModelSlugs([
				" custom/internal-model ",
				"gpt-5.3-codex",
				"5.3",
				"custom/internal-model",
				"",
				null,
			]),
		).toEqual(["custom/internal-model"]);
	});

	it("normalizes Gemini custom model slugs against Gemini built-ins", () => {
		expect(
			normalizeCustomModelSlugs(
				[" gemini/internal-preview ", "2.5", "gemini/internal-preview"],
				"gemini",
			),
		).toEqual(["gemini/internal-preview"]);
	});
});

describe("getAppModelOptions", () => {
	it("appends saved custom models after the built-in options", () => {
		const options = getAppModelOptions("codex", ["custom/internal-model"]);

		expect(options.map((option) => option.slug)).toEqual([
			"gpt-5.4",
			"gpt-5.3-codex",
			"gpt-5.3-codex-spark",
			"gpt-5.2-codex",
			"gpt-5.2",
			"custom/internal-model",
		]);
	});

	it("keeps the currently selected custom model available even if it is no longer saved", () => {
		const options = getAppModelOptions("codex", [], "custom/selected-model");

		expect(options.at(-1)).toEqual({
			slug: "custom/selected-model",
			name: "custom/selected-model",
			isCustom: true,
		});
	});

	it("appends saved Gemini custom models after the built-in options", () => {
		const options = getAppModelOptions("gemini", ["gemini/internal-preview"]);

		expect(options.map((option) => option.slug)).toEqual([
			"gemini-2.5-pro",
			"gemini-2.5-flash",
			"auto-gemini-3",
			"gemini/internal-preview",
		]);
	});
});

describe("resolveAppModelSelection", () => {
	it("preserves saved custom model slugs instead of falling back to the default", () => {
		expect(
			resolveAppModelSelection("codex", ["galapagos-alpha"], "galapagos-alpha"),
		).toBe("galapagos-alpha");
	});

	it("falls back to the provider default when no model is selected", () => {
		expect(resolveAppModelSelection("codex", [], "")).toBe("gpt-5.4");
	});

	it("preserves saved Gemini custom model slugs", () => {
		expect(
			resolveAppModelSelection(
				"gemini",
				["gemini/internal-preview"],
				"gemini/internal-preview",
			),
		).toBe("gemini/internal-preview");
	});
});

describe("getSlashModelOptions", () => {
	it("includes saved custom model slugs for /model command suggestions", () => {
		const options = getSlashModelOptions(
			"codex",
			["custom/internal-model"],
			"",
			"gpt-5.3-codex",
		);

		expect(
			options.some((option) => option.slug === "custom/internal-model"),
		).toBe(true);
	});

	it("filters slash-model suggestions across built-in and custom model names", () => {
		const options = getSlashModelOptions(
			"codex",
			["openai/gpt-oss-120b"],
			"oss",
			"gpt-5.3-codex",
		);

		expect(options.map((option) => option.slug)).toEqual([
			"openai/gpt-oss-120b",
		]);
	});

	it("includes saved Gemini custom model slugs for /model command suggestions", () => {
		const options = getSlashModelOptions(
			"gemini",
			["gemini/internal-preview"],
			"preview",
			"gemini-2.5-pro",
		);

		expect(options.map((option) => option.slug)).toEqual([
			"gemini/internal-preview",
		]);
	});
});

describe("resolveAppServiceTier", () => {
	it("maps automatic to no override", () => {
		expect(resolveAppServiceTier("auto")).toBeNull();
	});

	it("preserves explicit service tier overrides", () => {
		expect(resolveAppServiceTier("fast")).toBe("fast");
		expect(resolveAppServiceTier("flex")).toBe("flex");
	});
});

describe("shouldShowFastTierIcon", () => {
	it("shows the fast-tier icon only for gpt-5.4 on fast tier", () => {
		expect(shouldShowFastTierIcon("gpt-5.4", "fast")).toBe(true);
		expect(shouldShowFastTierIcon("gpt-5.4", "auto")).toBe(false);
		expect(shouldShowFastTierIcon("gpt-5.3-codex", "fast")).toBe(false);
	});
});

describe("provider-scoped helpers", () => {
	it("reads and patches custom models per provider", () => {
		const settings = {
			customCodexModels: ["codex/custom"],
			customGeminiModels: ["gemini/custom"],
		};

		expect(getCustomModelsForProvider(settings, "codex")).toEqual([
			"codex/custom",
		]);
		expect(getCustomModelsForProvider(settings, "gemini")).toEqual([
			"gemini/custom",
		]);
		expect(patchCustomModelsForProvider("gemini", ["gemini/next"])).toEqual({
			customGeminiModels: ["gemini/next"],
		});
	});

	it("builds provider start options only for non-empty overrides", () => {
		expect(
			getProviderStartOptionsForProvider(
				{
					codexBinaryPath: " /usr/local/bin/codex ",
					codexHomePath: "",
					geminiBinaryPath: "",
					geminiHomePath: "",
				},
				"codex",
			),
		).toEqual({
			codex: {
				binaryPath: "/usr/local/bin/codex",
			},
		});

		expect(
			getProviderStartOptionsForProvider(
				{
					codexBinaryPath: "",
					codexHomePath: "",
					geminiBinaryPath: "",
					geminiHomePath: " /tmp/.gemini ",
				},
				"gemini",
			),
		).toEqual({
			gemini: {
				homePath: "/tmp/.gemini",
			},
		});

		expect(
			getProviderStartOptionsForProvider(
				{
					codexBinaryPath: "",
					codexHomePath: "",
					geminiBinaryPath: "",
					geminiHomePath: "",
				},
				"gemini",
			),
		).toBeUndefined();
	});
});
