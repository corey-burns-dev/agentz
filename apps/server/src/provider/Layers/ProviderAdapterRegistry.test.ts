import type { ProviderKind } from "@agentz/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it, vi } from "@effect/vitest";
import { assertFailure } from "@effect/vitest/utils";
import { Effect, Layer, Stream } from "effect";
import { ProviderUnsupportedError } from "../Errors.ts";
import {
	CodexAdapter,
	type CodexAdapterShape,
} from "../Services/CodexAdapter.ts";
import { GeminiAdapter } from "../Services/GeminiAdapter.ts";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import { ProviderAdapterRegistryLive } from "./ProviderAdapterRegistry.ts";

const fakeCodexAdapter: CodexAdapterShape = {
	provider: "codex",
	capabilities: { sessionModelSwitch: "in-session" },
	startSession: vi.fn(),
	sendTurn: vi.fn(),
	interruptTurn: vi.fn(),
	respondToRequest: vi.fn(),
	respondToUserInput: vi.fn(),
	stopSession: vi.fn(),
	listSessions: vi.fn(),
	hasSession: vi.fn(),
	readThread: vi.fn(),
	rollbackThread: vi.fn(),
	stopAll: vi.fn(),
	streamEvents: Stream.empty,
};

const fakeGeminiAdapter = {
	...fakeCodexAdapter,
	provider: "gemini" as const,
};

const layer = it.layer(
	Layer.mergeAll(
		Layer.provide(
			ProviderAdapterRegistryLive,
			Layer.mergeAll(
				Layer.succeed(CodexAdapter, fakeCodexAdapter),
				Layer.succeed(GeminiAdapter, fakeGeminiAdapter),
			),
		),
		NodeServices.layer,
	),
);

layer("ProviderAdapterRegistryLive", (it) => {
	it.effect("resolves a registered provider adapter", () =>
		Effect.gen(function* () {
			const registry = yield* ProviderAdapterRegistry;
			const codex = yield* registry.getByProvider("codex");
			assert.equal(codex, fakeCodexAdapter);

			const providers = yield* registry.listProviders();
			assert.deepEqual([...providers].sort(), ["codex", "gemini"].sort());
		}),
	);

	it.effect("fails with ProviderUnsupportedError for unknown providers", () =>
		Effect.gen(function* () {
			const registry = yield* ProviderAdapterRegistry;
			const adapter = yield* registry
				.getByProvider("unknown" as ProviderKind)
				.pipe(Effect.result);
			assertFailure(
				adapter,
				new ProviderUnsupportedError({ provider: "unknown" }),
			);
		}),
	);
});
