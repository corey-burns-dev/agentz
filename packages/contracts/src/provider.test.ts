import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { ProviderSendTurnInput, ProviderSessionStartInput } from "./provider";

const decodeProviderSessionStartInput = Schema.decodeUnknownSync(
	ProviderSessionStartInput,
);
const decodeProviderSendTurnInput = Schema.decodeUnknownSync(
	ProviderSendTurnInput,
);

describe("ProviderSessionStartInput", () => {
	it("accepts codex-compatible payloads", () => {
		const parsed = decodeProviderSessionStartInput({
			threadId: "thread-1",
			provider: "codex",
			cwd: "/tmp/workspace",
			model: "gpt-5.3-codex",
			modelOptions: {
				codex: {
					reasoningEffort: "high",
					fastMode: true,
				},
			},
			runtimeMode: "full-access",
			providerOptions: {
				codex: {
					binaryPath: "/usr/local/bin/codex",
					homePath: "/tmp/.codex",
				},
			},
		});
		expect(parsed.runtimeMode).toBe("full-access");
		expect(parsed.modelOptions?.codex?.reasoningEffort).toBe("high");
		expect(parsed.modelOptions?.codex?.fastMode).toBe(true);
		expect(parsed.providerOptions?.codex?.binaryPath).toBe(
			"/usr/local/bin/codex",
		);
		expect(parsed.providerOptions?.codex?.homePath).toBe("/tmp/.codex");
	});

	it("accepts Gemini-compatible provider options", () => {
		const parsed = decodeProviderSessionStartInput({
			threadId: "thread-1",
			provider: "gemini",
			runtimeMode: "full-access",
			providerOptions: {
				gemini: {
					binaryPath: "/usr/local/bin/gemini",
					homePath: "/tmp/.gemini",
				},
			},
		});

		expect(parsed.providerOptions?.gemini?.binaryPath).toBe(
			"/usr/local/bin/gemini",
		);
		expect(parsed.providerOptions?.gemini?.homePath).toBe("/tmp/.gemini");
	});

	it("rejects payloads without runtime mode", () => {
		expect(() =>
			decodeProviderSessionStartInput({
				threadId: "thread-1",
				provider: "codex",
			}),
		).toThrow();
	});
});

describe("ProviderSendTurnInput", () => {
	it("accepts provider-scoped model options", () => {
		const parsed = decodeProviderSendTurnInput({
			threadId: "thread-1",
			model: "gpt-5.3-codex",
			modelOptions: {
				codex: {
					reasoningEffort: "xhigh",
					fastMode: true,
				},
			},
		});

		expect(parsed.model).toBe("gpt-5.3-codex");
		expect(parsed.modelOptions?.codex?.reasoningEffort).toBe("xhigh");
		expect(parsed.modelOptions?.codex?.fastMode).toBe(true);
	});
});
