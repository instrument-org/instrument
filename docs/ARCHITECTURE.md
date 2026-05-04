# Architecture

This document is a **codemap** for Instrument: where things live, how packages relate, and which boundaries tend to stay stable. It follows the idea that architecture docs should be short and Name important modules so readers can jump with search rather than brittle hyperlinks (see Aleksey Kladov, “ARCHITECTURE.md”, 2021).

## Problem

Instrument is a desktop development environment: an Electron **Studio** app orchestrates AI-assisted workflows, talks to a **workspace** engine for agents and project state, and injects a **shim** into user applications for instrumentation.

## Package map

### `apps/studio`

Electron application: main process, preload, and React renderer.

- **Main process** — Window management, OS integration, backend wiring. Look under `apps/studio/src/electron-main/`.
- **Preload** — Bridge surface exposed to the renderer. Look under `apps/studio/src/electron-preload/`.
- **Renderer** — React UI and client-side routing. Look under `apps/studio/src/client/`.
- **RPC** — Main defines routes under `apps/studio/src/electron-main/rpc/`; renderer consumes a client under `apps/studio/src/client/rpc/`.

Build orchestration uses **electron-vite** (`electron.vite.config.ts`). Turbo may build `shim-client` before Studio builds when tasks are chained.

### `packages/workspace`

Core **AI agents**, workflow logic, and workspace management. Consumed by Studio and related tooling. Public entrypoints are declared via `package.json` `exports` (for example client and Electron adapters).

### `packages/shim-client`

**Client-side runtime injected into user apps** during development or sessions. Built with Vite; dev runs on a dedicated port (see package scripts).

### `packages/shared`

Shared **types, constants, and utilities** used across apps and libraries.

### `packages/ai-gateway`

**Local AI gateway** for routing or serving model traffic in development and product flows.

### Tooling packages

- `packages/eslint-config` and `packages/typescript-config` — Shared lint and TypeScript configuration for the monorepo.

### `registry/` (read-only)

Git submodule with skills and registry metadata. **Do not modify** in this repository; consume and reference only.

## Dependency direction (intent)

- **Studio** depends on **workspace**, **shared**, **shim-client** artifacts, and **ai-gateway** as needed for features.
- **Shim** stays suitable for injection: avoid pulling Studio-only or Electron-main-only code into it.
- **Shared** must remain lightweight and free of product cycles; do not use it as a junk drawer for app-specific logic.

When in doubt, prefer **explicit exports** in `package.json` over deep relative imports across package boundaries.

## Cross-cutting concerns

- **Type safety** — TypeScript project references and shared configs; keep public surfaces typed at boundaries.
- **Testing** — Vitest at the root; packages and apps run scoped tests (see [QUALITY.md](QUALITY.md)).
- **Formatting and lint** — Prettier, ESLint, markdown and spelling checks at the root.
- **Observability and product analytics** — Follow existing patterns in Studio and workspace when adding logs or metrics.

## Related reading

- [DEVELOPMENT.md](DEVELOPMENT.md) for commands and setup.
- [SECURITY.md](SECURITY.md) for boundaries around credentials and user data.
- [references/external.md](references/external.md) for agent-first engineering references.
