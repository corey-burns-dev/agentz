# Repo Cleanup & Agentz Rebrand – Prioritized Findings

Short prioritized list from the repo audit. Focus: current-stack improvements only; no broad stack migration.

## Addressed in This Pass

1. **Desktop bootstrap env drift** – Server and dev-runner now use canonical `AGENTZ_*` env vars; dev-runner sets both `AGENTZ_*` and `T3CODE_*` for compatibility. Server and desktop Rust read `AGENTZ_*` first with `T3CODE_*` fallback.
2. **Tracked Tauri build outputs** – `apps/desktop/src-tauri/target` added to root and desktop `.gitignore`; Biome already excluded it. No tracked artifacts under `target/` were present.
3. **Stale Electron naming** – `isElectron` renamed to `isDesktopShell` across web app; comments updated to "desktop shell (Tauri)".
4. **Stale `t3` state/worktree paths** – Default state dir is `~/.agentz/userdata`; worktrees use `~/.agentz/worktrees/...`. Legacy `~/.t3` remains readable during migration (server/desktop read canonical first, then legacy where applicable).
5. **Product branding** – Desktop binary/crate name `t3-code` → `agentz`; UI strings "T3 Code" → "Agentz" in settings, dialogs, and smoke test.

## Follow-ups (Prioritized)

1. **Terminal Manager test** – `retries with fallback shells when preferred shell spawn fails` fails in CI/local (expects a fallback shell in `spawnInputs`). Unrelated to env/rebrand; investigate shell resolution or test environment.
2. **Legacy env/state removal** – Once migration is complete, remove `T3CODE_*` fallback and `.t3` path handling; document cutoff in changelog.
3. **A11y** – Biome a11y rules (e.g. `noSvgWithoutTitle`, `noLabelWithoutControl`) are currently set to `warn`. Consider fixing and promoting to `error`, or adding per-file suppressions with rationale.
4. **Pre-commit validation** – Manually confirm: staged changes get Biome `--write`, then full `bun run typecheck` runs; a type error blocks commit.

## References

- Pre-commit: `simple-git-hooks` + `lint-staged` (root `package.json`).
- Canonical env: `AGENTZ_*`; legacy: `T3CODE_*` (temporary).
- Canonical paths: `~/.agentz/...`; legacy: `~/.t3/...` (read-only during migration).
