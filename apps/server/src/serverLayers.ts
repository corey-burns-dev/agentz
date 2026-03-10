/// <reference types="bun" />
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, type FileSystem, Layer } from "effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

import { CheckpointDiffQueryLive } from "./checkpointing/Layers/CheckpointDiffQuery";
import { CheckpointStoreLive } from "./checkpointing/Layers/CheckpointStore";
import { ServerConfig } from "./config";
import { CodexTextGenerationLive } from "./git/Layers/CodexTextGeneration";
import { GitCoreLive } from "./git/Layers/GitCore";
import { GitHubCliLive } from "./git/Layers/GitHubCli";
import { GitManagerLive } from "./git/Layers/GitManager";
import { GitServiceLive } from "./git/Layers/GitService";
import { KeybindingsLive } from "./keybindings";
import { CheckpointReactorLive } from "./orchestration/Layers/CheckpointReactor";
import { OrchestrationEngineLive } from "./orchestration/Layers/OrchestrationEngine";
import { OrchestrationReactorLive } from "./orchestration/Layers/OrchestrationReactor";
import { OrchestrationProjectionPipelineLive } from "./orchestration/Layers/ProjectionPipeline";
import { OrchestrationProjectionSnapshotQueryLive } from "./orchestration/Layers/ProjectionSnapshotQuery";
import { ProviderCommandReactorLive } from "./orchestration/Layers/ProviderCommandReactor";
import { ProviderRuntimeIngestionLive } from "./orchestration/Layers/ProviderRuntimeIngestion";
import { OrchestrationCommandReceiptRepositoryLive } from "./persistence/Layers/OrchestrationCommandReceipts";
import { OrchestrationEventStoreLive } from "./persistence/Layers/OrchestrationEventStore";
import { ProviderSessionRuntimeRepositoryLive } from "./persistence/Layers/ProviderSessionRuntime";
import type { ProviderUnsupportedError } from "./provider/Errors";
import { makeClaudeCodeAdapterLive } from "./provider/Layers/ClaudeCodeAdapter";
import { makeCodexAdapterLive } from "./provider/Layers/CodexAdapter";
import { makeEventNdjsonLogger } from "./provider/Layers/EventNdjsonLogger";
import { makeGeminiAdapterLive } from "./provider/Layers/GeminiAdapter";
import { ProviderAdapterRegistryLive } from "./provider/Layers/ProviderAdapterRegistry";
import { makeProviderServiceLive } from "./provider/Layers/ProviderService";
import { ProviderSessionDirectoryLive } from "./provider/Layers/ProviderSessionDirectory";
import type { ProviderService } from "./provider/Services/ProviderService";
import { BunPtyAdapterLive } from "./terminal/Layers/BunPTY";
import { TerminalManagerLive } from "./terminal/Layers/Manager";
import { NodePtyAdapterLive } from "./terminal/Layers/NodePTY";

export function makeServerProviderLayer(): Layer.Layer<
  ProviderService,
  ProviderUnsupportedError,
  SqlClient.SqlClient | ServerConfig | FileSystem.FileSystem
> {
  return Effect.gen(function* () {
    const { stateDir } = yield* ServerConfig;
    const providerLogsDir = path.join(stateDir, "logs", "provider");
    const providerEventLogPath = path.join(providerLogsDir, "events.log");
    const nativeEventLogger = yield* makeEventNdjsonLogger(providerEventLogPath, {
      stream: "native",
    });
    const canonicalEventLogger = yield* makeEventNdjsonLogger(providerEventLogPath, {
      stream: "canonical",
    });
    const providerSessionDirectoryLayer = ProviderSessionDirectoryLive.pipe(
      Layer.provide(ProviderSessionRuntimeRepositoryLive),
    );
    const codexAdapterLayer = makeCodexAdapterLive(
      nativeEventLogger ? { nativeEventLogger } : undefined,
    );
    const geminiAdapterLayer = makeGeminiAdapterLive(
      nativeEventLogger ? { nativeEventLogger } : undefined,
    );
    const claudeCodeAdapterLayer = makeClaudeCodeAdapterLive(
      nativeEventLogger ? { nativeEventLogger } : undefined,
    );
    const adapterRegistryLayer = ProviderAdapterRegistryLive.pipe(
      Layer.provide(codexAdapterLayer),
      Layer.provide(geminiAdapterLayer),
      Layer.provide(claudeCodeAdapterLayer),
      Layer.provideMerge(providerSessionDirectoryLayer),
    );
    return makeProviderServiceLive(
      canonicalEventLogger ? { canonicalEventLogger } : undefined,
    ).pipe(Layer.provide(adapterRegistryLayer), Layer.provide(providerSessionDirectoryLayer));
  }).pipe(Layer.unwrap);
}

export function makeServerRuntimeServicesLayer() {
  const gitCoreLayer = GitCoreLive.pipe(Layer.provideMerge(GitServiceLive));
  const textGenerationLayer = CodexTextGenerationLive;

  const orchestrationLayer = OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionPipelineLive),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
  );

  const checkpointDiffQueryLayer = CheckpointDiffQueryLive.pipe(
    Layer.provideMerge(OrchestrationProjectionSnapshotQueryLive),
    Layer.provideMerge(CheckpointStoreLive),
  );

  const runtimeServicesLayer = Layer.mergeAll(
    orchestrationLayer,
    OrchestrationProjectionSnapshotQueryLive,
    CheckpointStoreLive,
    checkpointDiffQueryLayer,
  );
  const runtimeIngestionLayer = ProviderRuntimeIngestionLive.pipe(
    Layer.provideMerge(runtimeServicesLayer),
  );
  const providerCommandReactorLayer = ProviderCommandReactorLive.pipe(
    Layer.provideMerge(runtimeServicesLayer),
    Layer.provideMerge(gitCoreLayer),
    Layer.provideMerge(textGenerationLayer),
  );
  const checkpointReactorLayer = CheckpointReactorLive.pipe(
    Layer.provideMerge(runtimeServicesLayer),
  );
  const orchestrationReactorLayer = OrchestrationReactorLive.pipe(
    Layer.provideMerge(runtimeIngestionLayer),
    Layer.provideMerge(providerCommandReactorLayer),
    Layer.provideMerge(checkpointReactorLayer),
  );

  const terminalLayer = TerminalManagerLive.pipe(
    Layer.provide(
      typeof Bun !== "undefined" && process.platform !== "win32"
        ? BunPtyAdapterLive
        : NodePtyAdapterLive,
    ),
  );

  const gitManagerLayer = GitManagerLive.pipe(
    Layer.provideMerge(gitCoreLayer),
    Layer.provideMerge(GitHubCliLive),
    Layer.provideMerge(textGenerationLayer),
  );

  return Layer.mergeAll(
    orchestrationReactorLayer,
    gitCoreLayer,
    gitManagerLayer,
    terminalLayer,
    KeybindingsLive,
  ).pipe(Layer.provideMerge(NodeServices.layer));
}
