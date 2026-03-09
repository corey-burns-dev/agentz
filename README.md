# Agentz

Agentz is a minimal web GUI for coding agents. Currently Codex-first, with Claude Code support coming soon.

## How to use

> [!WARNING]
> You need to have [Codex CLI](https://github.com/openai/codex) installed and authorized for Agentz to work.

```bash
npx agentz
```

You can also just install the desktop app. It's cooler.

Install the [desktop app from the Releases page](https://github.com/pingdotgg/agentz/releases)

### Running the desktop app (Tauri) from source

Prerequisites: [Rust](https://rustup.rs/) and [Tauri’s system dependencies](https://v2.tauri.app/start/prerequisites/) for your OS.

From the repo root:

- **Development** (web dev server + Tauri window with hot reload):

  ```bash
  bun run dev:desktop
  ```

- **Production** (build then run):

  ```bash
  bun run start:desktop
  ```

To only build the desktop app: `bun run --cwd apps/desktop build`. Outputs are under `apps/desktop/src-tauri/target/release/` (or `target/debug/` for dev builds).

## Some notes

We are very very early in this project. Expect bugs.

We are not accepting contributions yet.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
