<p align="center">
  <img src="assets/prod/logo.svg" alt="Agents Logo" width="128" height="128">
</p>

# Agents

Agents is a minimal web GUI and desktop application for coding agents.

**This project is a fork of T3 (agents.chat).** I was a bit too impatient to wait for official Gemini and Claude support, and I really wanted native Linux Qt6 builds, so here we are.

## Key Additions & Differences

- **Gemini & Claude Support**: First-class support for Gemini and Claude models.
- **Qt6 Linux Builds**: Native Linux support via Qt6 for those who prefer it over Tauri/Electron.
- **Tauri Builds**: The primary desktop application is built using [Tauri](https://v2.tauri.app/), providing a fast, native, and lightweight experience.
- **No Electron**: We have completely removed Electron from the stack in favor of Tauri and Qt6.

## How to use

> [!WARNING]
> You may need to have [Codex CLI](https://github.com/openai/codex) installed and authorized for Agents to work depending on your chosen provider.

### Running the Desktop App (Tauri) from source

**Prerequisites:**

- [Bun](https://bun.sh/)
- [Rust](https://rustup.rs/)
- [Tauri's system dependencies](https://v2.tauri.app/start/prerequisites/) for your specific OS.

From the repository root, you can use the following commands:

- **Development** (Web dev server + Tauri window with hot reload):

  ```bash
  bun run dev:desktop
  ```

- **Production** (Build all assets and start the desktop app):

  ```bash
  bun run start:desktop
  ```

- **Build Only** (Build the web, server, and desktop app):

  ```bash
  bun run build:desktop
  ```

  _Outputs will be located under `apps/desktop/tauri/src-tauri/target/release/` (or `target/debug/` for dev builds)._

### Flatpak (Linux)

A Flatpak build is produced on release and can be built locally:

**Prerequisites:** `flatpak`, `flatpak-builder`, and the Flathub remote (e.g. `flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo`).

```bash
# Build a .flatpak bundle (runs build:desktop:no-bundle then flatpak-builder)
bun run dist:desktop:flatpak
# Output: release/agents.flatpak (or agents-<version>.flatpak with --build-version)
```

Install locally: `flatpak-builder --user --install build flatpak/com.agents.agents.yml` (after `bun run build:desktop:no-bundle`).

### Running the Desktop App (Qt6) from source

An alternative desktop build uses **Qt6** (C++, no Python). It hosts the same web app in a Qt WebEngine view and connects to the same server.

**Prerequisites:**

- [Bun](https://bun.sh/)
- [Qt6](https://www.qt.io/download) with WebEngine support
- [CMake](https://cmake.org/) 3.16+

From the repository root:

- **Development** (Web dev server + Qt window with hot reload):

  ```bash
  bun run dev:qt6
  ```

- **Production** (Build all assets and start the Qt app):

  ```bash
  bun run start:qt6
  ```

- **Build Only**:

  ```bash
  bun run build:qt6
  ```

  _The Qt executable is built under `apps/desktop/qt6/build/`._

### Running via CLI / Web

You can still use Agents as a web application running in your browser:

```bash
# Start the web and server dev runner (uses your local tools, including gh if installed)
bun run dev

# Or via npx
npx agents
```

### Local development vs Docker

- **Local development (recommended for contributors)**:
  - Runs directly on your host using your locally installed tools (e.g. `gh`, `git`, CLI auth, SSH keys).
  - From the repo root:
    ```bash
    bun install
    make dev        # or: make dev-server / make dev-web
    ```
  - When you run these commands, the server and web apps use **your host environment** and whatever `gh`/Git configuration you already have.

- **Docker (optional, self-contained)**:
  - Intended for users who just want to run Agents without setting up the full toolchain locally.
  - The Docker image includes `gh` and other runtime dependencies inside the container, isolated from your host.
  - From the repo root:
    ```bash
    make docker-build   # Build the image (uses Dockerfile)
    make docker-up      # Start Agents with Docker Compose
    # make docker-down  # Stop the container
    ```

## Notes

We are very early in this project. Expect bugs.
