# Headless / Cloud dev

Use when Electron fails to start or when setting up from scratch in a VM (Cursor Cloud, CI).

pnpm manages Node via `devEngines.runtime` (`onFail: "download"`). Bootstrap: `corepack enable && corepack prepare pnpm@11.10.0 --activate`.

## Electron as root

Set `NO_SANDBOX=1` (read by electron-vite's `startElectron`). Turbo doesn't forward it reliably; run services directly:

```bash
cd apps/studio && NO_SANDBOX=1 pnpm dev
```

- `REMOTE_DEBUGGING_PORT` picks the CDP port used by `chrome-devtools-mcp` and the devtools skill. It defaults to 48160 (`electron.vite.config.ts`), so a hand-started dev instance is already listening there; set it only to choose a different port.
- Ensure `DISPLAY` points at a running Xvfb (`:1` on Cursor Cloud; this repo's CI uses `:99`). D-Bus errors are harmless.

## Quick reference

- `pnpm-workspace.yaml` has `allowBuilds`; never approve builds interactively.
