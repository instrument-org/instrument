# Headless / Cloud dev

Use when Electron fails to start or when setting up from scratch in a VM (Cursor Cloud, CI).

pnpm manages Node via `devEngines.runtime` (`onFail: "download"`). Bootstrap: `corepack enable && corepack prepare pnpm@11.10.0 --activate`.

## Electron as root

Set `NO_SANDBOX=1` (read by electron-vite's `startElectron`). Turbo doesn't forward it reliably; run services directly:

```bash
cd apps/studio && NO_SANDBOX=1 REMOTE_DEBUGGING_PORT=48160 pnpm dev
```

- `REMOTE_DEBUGGING_PORT=48160` enables the CDP endpoint used by `chrome-devtools-mcp` and the devtools skill. Without it, port 48160 won't be listening.
- Ensure `DISPLAY=:1` (Xvfb). D-Bus errors are harmless.

## Quick reference

- `pnpm check:types` / `pnpm check:lint` / `pnpm test run`
- `pnpm-workspace.yaml` has `allowBuilds`; never approve builds interactively.
