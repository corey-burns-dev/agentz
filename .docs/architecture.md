# Architecture

Agents runs as a **Node.js WebSocket server** that manages provider subprocesses (Codex, Gemini, Claude Code) and serves a React web app.

```text
┌─────────────────────────────────┐
│  Browser (React + Vite)         │
│  Connected via WebSocket        │
└──────────┬──────────────────────┘
           │ ws://localhost:3773
┌──────────▼──────────────────────┐
│  apps/server (Node.js)          │
│  WebSocket + HTTP static server │
│  ProviderService (Effect)       │
│  ProviderAdapterRegistry        │
│  OrchestrationEngine            │
└──────┬──────────┬───────────────┘
       │          │
  JSON-RPC     NDJSON stream (per-turn subprocess)
  over stdio   via readline
       │          │
┌──────▼──┐  ┌───▼──────────────────┐
│  codex  │  │  claude -p           │
│  app-   │  │  --output-format     │
│  server │  │  stream-json         │
│ (or     │  │  (Claude Code)       │
│ gemini) │  └──────────────────────┘
└─────────┘
```

## Server Layers (Effect-TS)

The server is composed via Effect Layers in `serverLayers.ts`:

- **ProviderAdapterRegistry** — maps provider kinds (`codex`, `gemini`, `claude-code`) to their adapter implementations
- **ProviderService** — routes API calls to the correct adapter; emits `ProviderRuntimeEvent` streams
- **OrchestrationEngine** — consumes runtime events and projects them into orchestration domain events
- **CheckpointStore** — diff tracking per session turn
- **GitService** / **GitManager** — git operations
- **TerminalManager** — PTY management (Bun or node-pty)

## Provider Session Models

| Provider    | Process model                          | Session persistence                                                     |
| ----------- | -------------------------------------- | ----------------------------------------------------------------------- |
| Codex       | Long-lived JSON-RPC daemon per session | In-memory (daemon process)                                              |
| Gemini      | Long-lived JSON-RPC daemon per session | In-memory (daemon process)                                              |
| Claude Code | New subprocess per turn                | File-based (`~/.claude/projects/`), resumed via `--resume <session_id>` |

## Event Flow

```text
Provider subprocess output
        │
        ▼
Provider Adapter (parses native events)
        │  ProviderRuntimeEvent stream
        ▼
ProviderRuntimeIngestion
        │  projects into domain events
        ▼
OrchestrationEngine (event store + projections)
        │  push via WebSocket
        ▼
orchestration.domainEvent channel → Browser
```
