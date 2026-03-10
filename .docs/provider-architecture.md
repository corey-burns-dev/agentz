# Provider architecture

The web app communicates with the server via WebSocket using a simple JSON-RPC-style protocol:

- **Request/Response**: `{ id, method, params }` → `{ id, result }` or `{ id, error }`
- **Push events**: `{ type: "push", channel, data }` for orchestration read-model updates

Methods mirror the `NativeApi` interface defined in `@agents/contracts`:

- `providers.startSession`, `providers.sendTurn`, `providers.interruptTurn`
- `providers.respondToRequest`, `providers.respondToUserInput`, `providers.stopSession`
- `shell.openInEditor`, `server.getConfig`
- `orchestration.getSnapshot`, `orchestration.dispatchCommand`

## Supported providers

Three providers are fully implemented:

| Provider    | Kind          | Process model                                                     |
| ----------- | ------------- | ----------------------------------------------------------------- |
| Codex       | `codex`       | Long-lived JSON-RPC daemon (`codex app-server`)                   |
| Gemini      | `gemini`      | Long-lived JSON-RPC daemon (`gemini app-server`)                  |
| Claude Code | `claude-code` | New subprocess per turn (`claude -p --output-format stream-json`) |

## Claude Code specifics

Claude Code uses a different integration model than Codex/Gemini:

- **No persistent daemon**: each turn spawns a fresh `claude` CLI subprocess. The CLI stores session state in `~/.claude/projects/`.
- **Session continuity**: the session ID from the first turn's `system/init` message is passed as `--resume <session_id>` on all subsequent turns.
- **NDJSON output**: subprocess stdout is parsed line-by-line via readline. Each line is a JSON event.
- **Control protocol**: when `runtimeMode === "approval-required"`, a lightweight stdin/stdout protocol handles tool approvals (`can_use_tool` requests → allow/block responses). In `full-access` mode, `--dangerously-skip-permissions` is passed instead.
- **Minimum CLI version**: v2.0.0, enforced at session start.

## Adapter registration

All adapters implement `ProviderAdapterShape` and are registered in `serverLayers.ts` via `ProviderAdapterRegistryLive`:

```typescript
const adapterRegistryLayer = ProviderAdapterRegistryLive.pipe(
  Layer.provide(codexAdapterLayer),
  Layer.provide(geminiAdapterLayer),
  Layer.provide(claudeCodeAdapterLayer),
  Layer.provideMerge(providerSessionDirectoryLayer),
);
```

## Runtime event mapping

Each adapter translates provider-native output into canonical `ProviderRuntimeEvent` types (defined in `packages/contracts/src/providerRuntime.ts`). The orchestration layer then projects these into domain events pushed to the browser on channel `orchestration.domainEvent`.
