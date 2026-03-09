import type { ProviderKind } from "@agents/contracts";
import { getModelOptions, normalizeModelSlug } from "@agents/shared/model";
import { ZapIcon } from "lucide-react";
import { useCallback, useState } from "react";
import {
	APP_SERVICE_TIER_OPTIONS,
	getCustomModelsForProvider,
	MAX_CUSTOM_MODEL_LENGTH,
	patchCustomModelsForProvider,
	shouldShowFastTierIcon,
	useAppSettings,
} from "~/appSettings";
import {
	SettingsEmptyState,
	SettingsPanel,
	SettingsSection,
} from "~/components/settings/SettingsSection";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
	Select,
	SelectItem,
	SelectPopup,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";

const MODEL_PROVIDER_SETTINGS: Array<{
	provider: ProviderKind;
	title: string;
	description: string;
	placeholder: string;
	example: string;
}> = [
	{
		provider: "codex",
		title: "Codex",
		description:
			"Save additional Codex model slugs for the picker and `/model` command.",
		placeholder: "your-codex-model-slug",
		example: "gpt-6.7-codex-ultra-preview",
	},
	{
		provider: "gemini",
		title: "Gemini",
		description:
			"Save additional Gemini model slugs for the picker and `/model` command.",
		placeholder: "your-gemini-model-slug",
		example: "gemini-2.5-pro-preview",
	},
	{
		provider: "claude-code",
		title: "Claude Code",
		description:
			"Save additional Claude model slugs for the picker and `/model` command.",
		placeholder: "your-claude-model-slug",
		example: "claude-sonnet-4-6-extended",
	},
] as const;

export function CustomModelsSection() {
	const { settings, defaults, updateSettings } = useAppSettings();
	const [customModelInputByProvider, setCustomModelInputByProvider] = useState<
		Record<ProviderKind, string>
	>({
		codex: "",
		gemini: "",
		"claude-code": "",
	});
	const [customModelErrorByProvider, setCustomModelErrorByProvider] = useState<
		Partial<Record<ProviderKind, string | null>>
	>({});

	const codexServiceTier = settings.codexServiceTier;

	const addCustomModel = useCallback(
		(provider: ProviderKind) => {
			const customModelInput = customModelInputByProvider[provider];
			const customModels = getCustomModelsForProvider(settings, provider);
			const normalized = normalizeModelSlug(customModelInput, provider);
			if (!normalized) {
				setCustomModelErrorByProvider((existing) => ({
					...existing,
					[provider]: "Enter a model slug.",
				}));
				return;
			}
			if (
				getModelOptions(provider).some((option) => option.slug === normalized)
			) {
				setCustomModelErrorByProvider((existing) => ({
					...existing,
					[provider]: "That model is already built in.",
				}));
				return;
			}
			if (normalized.length > MAX_CUSTOM_MODEL_LENGTH) {
				setCustomModelErrorByProvider((existing) => ({
					...existing,
					[provider]: `Model slugs must be ${MAX_CUSTOM_MODEL_LENGTH} characters or less.`,
				}));
				return;
			}
			if (customModels.includes(normalized)) {
				setCustomModelErrorByProvider((existing) => ({
					...existing,
					[provider]: "That custom model is already saved.",
				}));
				return;
			}

			updateSettings(
				patchCustomModelsForProvider(provider, [...customModels, normalized]),
			);
			setCustomModelInputByProvider((existing) => ({
				...existing,
				[provider]: "",
			}));
			setCustomModelErrorByProvider((existing) => ({
				...existing,
				[provider]: null,
			}));
		},
		[customModelInputByProvider, settings, updateSettings],
	);

	const removeCustomModel = useCallback(
		(provider: ProviderKind, slug: string) => {
			const customModels = getCustomModelsForProvider(settings, provider);
			updateSettings(
				patchCustomModelsForProvider(
					provider,
					customModels.filter((model) => model !== slug),
				),
			);
			setCustomModelErrorByProvider((existing) => ({
				...existing,
				[provider]: null,
			}));
		},
		[settings, updateSettings],
	);

	return (
		<SettingsSection
			title="Models"
			description="Save additional provider model slugs so they appear in the chat model picker and `/model` command suggestions."
		>
			<div className="space-y-5">
				<fieldset
					aria-labelledby="settings-default-service-tier-label"
					className="block space-y-1 border-0 p-0 m-0 min-w-0 min-h-0"
				>
					<span
						id="settings-default-service-tier-label"
						className="text-xs font-medium text-foreground"
					>
						Default service tier
					</span>
					<Select
						items={APP_SERVICE_TIER_OPTIONS.map((option) => ({
							label: option.label,
							value: option.value,
						}))}
						value={codexServiceTier}
						onValueChange={(value) => {
							if (!value) return;
							updateSettings({ codexServiceTier: value });
						}}
					>
						<SelectTrigger>
							<SelectValue />
						</SelectTrigger>
						<SelectPopup alignItemWithTrigger={false}>
							{APP_SERVICE_TIER_OPTIONS.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									<div className="flex min-w-0 items-center gap-2">
										{option.value === "fast" ? (
											<ZapIcon className="size-3.5 text-amber-500" />
										) : (
											<span className="size-3.5 shrink-0" aria-hidden="true" />
										)}
										<span className="truncate">{option.label}</span>
									</div>
								</SelectItem>
							))}
						</SelectPopup>
					</Select>
					<span className="text-xs text-muted-foreground">
						{APP_SERVICE_TIER_OPTIONS.find(
							(option) => option.value === codexServiceTier,
						)?.description ??
							"Use Codex defaults without forcing a service tier."}
					</span>
				</fieldset>

				{MODEL_PROVIDER_SETTINGS.map((providerSettings) => {
					const provider = providerSettings.provider;
					const customModels = getCustomModelsForProvider(settings, provider);
					const customModelInput = customModelInputByProvider[provider];
					const customModelError = customModelErrorByProvider[provider] ?? null;
					return (
						<SettingsPanel key={provider} className="space-y-4">
							<div className="mb-4">
								<h3 className="text-sm font-medium text-foreground">
									{providerSettings.title}
								</h3>
								<p className="mt-1 text-xs text-muted-foreground">
									{providerSettings.description}
								</p>
							</div>

							<div className="space-y-4">
								<div className="flex flex-col gap-3 sm:flex-row sm:items-start">
									<label
										htmlFor={`custom-model-slug-${provider}`}
										className="block flex-1 space-y-1"
									>
										<span className="text-xs font-medium text-foreground">
											Custom model slug
										</span>
										<Input
											id={`custom-model-slug-${provider}`}
											value={customModelInput}
											onChange={(event) => {
												const value = event.target.value;
												setCustomModelInputByProvider((existing) => ({
													...existing,
													[provider]: value,
												}));
												if (customModelError) {
													setCustomModelErrorByProvider((existing) => ({
														...existing,
														[provider]: null,
													}));
												}
											}}
											onKeyDown={(event) => {
												if (event.key !== "Enter") return;
												event.preventDefault();
												addCustomModel(provider);
											}}
											placeholder={providerSettings.placeholder}
											spellCheck={false}
										/>
										<span className="text-xs text-muted-foreground">
											Example: <code>{providerSettings.example}</code>
										</span>
									</label>

									<Button
										className="sm:mt-6"
										type="button"
										onClick={() => addCustomModel(provider)}
									>
										Add model
									</Button>
								</div>

								{customModelError ? (
									<p className="text-xs text-destructive">{customModelError}</p>
								) : null}

								<div className="space-y-2">
									<div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
										<p>Saved custom models: {customModels.length}</p>
										{customModels.length > 0 ? (
											<Button
												size="xs"
												variant="outline"
												onClick={() =>
													updateSettings(
														patchCustomModelsForProvider(provider, [
															...getCustomModelsForProvider(defaults, provider),
														]),
													)
												}
											>
												Reset custom models
											</Button>
										) : null}
									</div>

									{customModels.length > 0 ? (
										<div className="space-y-2">
											{customModels.map((slug) => (
												<div
													key={`${provider}:${slug}`}
													className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2"
												>
													<div className="flex min-w-0 flex-1 items-center gap-2">
														{provider === "codex" &&
														shouldShowFastTierIcon(slug, codexServiceTier) ? (
															<ZapIcon className="size-3.5 shrink-0 text-amber-500" />
														) : null}
														<code className="min-w-0 flex-1 truncate text-xs text-foreground">
															{slug}
														</code>
													</div>
													<Button
														size="xs"
														variant="ghost"
														onClick={() => removeCustomModel(provider, slug)}
													>
														Remove
													</Button>
												</div>
											))}
										</div>
									) : (
										<SettingsEmptyState>
											No custom models saved yet.
										</SettingsEmptyState>
									)}
								</div>
							</div>
						</SettingsPanel>
					);
				})}
			</div>
		</SettingsSection>
	);
}
