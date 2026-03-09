import { Schema } from "effect";
import { TrimmedNonEmptyString } from "./baseSchemas";

const TrimmedNonEmptyStringSchema = TrimmedNonEmptyString;

export const CodexProviderStartOptions = Schema.Struct({
	binaryPath: Schema.optional(TrimmedNonEmptyStringSchema),
	homePath: Schema.optional(TrimmedNonEmptyStringSchema),
});
export type CodexProviderStartOptions = typeof CodexProviderStartOptions.Type;

export const GeminiProviderStartOptions = Schema.Struct({
	binaryPath: Schema.optional(TrimmedNonEmptyStringSchema),
	homePath: Schema.optional(TrimmedNonEmptyStringSchema),
});
export type GeminiProviderStartOptions = typeof GeminiProviderStartOptions.Type;

export const ProviderStartOptions = Schema.Struct({
	codex: Schema.optional(CodexProviderStartOptions),
	gemini: Schema.optional(GeminiProviderStartOptions),
});
export type ProviderStartOptions = typeof ProviderStartOptions.Type;
