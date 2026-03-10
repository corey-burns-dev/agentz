import type { ProviderKind, ServerProviderStatus } from "@agents/contracts";
import { inferProviderKindForModel } from "@agents/shared/model";
import type { AppSettings } from "./appSettings";
import { getProviderStartOptionsForProvider } from "./appSettings";
import { PROVIDER_OPTIONS, type ProviderPickerKind } from "./session-logic";

type ProviderOption = {
	value: ProviderPickerKind;
	label: string;
	available: true;
};

type ProviderOverrideSettings = Pick<
	AppSettings,
	| "codexBinaryPath"
	| "codexHomePath"
	| "geminiBinaryPath"
	| "geminiHomePath"
	| "claudeCodeBinaryPath"
	| "claudeCodeHomePath"
>;

const SUPPORTED_PROVIDER_OPTIONS = PROVIDER_OPTIONS.filter(
	(option): option is ProviderOption => option.available,
);

export function resolveSelectedProvider(input: {
	readonly lockedProvider?: ProviderKind | null;
	readonly draftProvider?: ProviderKind | null;
	readonly sessionProvider?: ProviderKind | null;
	readonly threadModel?: string | null;
	readonly projectModel?: string | null;
}): ProviderKind {
	if (input.lockedProvider) {
		return input.lockedProvider;
	}
	if (input.draftProvider) {
		return input.draftProvider;
	}
	if (input.sessionProvider) {
		return input.sessionProvider;
	}
	if (input.threadModel) {
		return inferProviderKindForModel(input.threadModel);
	}
	if (input.projectModel) {
		return inferProviderKindForModel(input.projectModel);
	}
	return "codex";
}

export function resolveVisibleProviderOptions(input: {
	readonly providerStatuses: ReadonlyArray<ServerProviderStatus>;
	readonly settings: ProviderOverrideSettings;
}): ReadonlyArray<ProviderOption> {
	const statusByProvider = new Map<ProviderKind, ServerProviderStatus>(
		input.providerStatuses.map((status) => [status.provider, status]),
	);
	const visible = SUPPORTED_PROVIDER_OPTIONS.filter((option) => {
		const status = statusByProvider.get(option.value);
		if (!status) {
			return true;
		}
		if (status.available) {
			return true;
		}
		return (
			getProviderStartOptionsForProvider(input.settings, option.value) !==
			undefined
		);
	});
	return visible.length > 0 ? visible : SUPPORTED_PROVIDER_OPTIONS;
}
