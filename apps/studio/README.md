# Instrument Studio

Electron desktop app for Instrument.

## Dependencies

Due to how Electron Builder works, client-only (renderer) dependencies should
be listed in `devDependencies` to avoid them being bundled into the app.

## Canary builds

Canary is a separate, side-by-side build of Studio for internal feature
validation. It has its own yellow icon, bundle id (`com.finalpoint.instrument.canary`),
product name (**Instrument Canary**), user-data folder, and updater cache, so it
installs and runs alongside the stable app.

- **Built nightly** from `main` by [`.github/workflows/canary.yml`](../../.github/workflows/canary.yml)
  (cron + manual `workflow_dispatch`) for macOS arm64, Windows x64, and Linux
  arm64 (AppImage). Versions are stamped `X.Y.Z-canary.<timestamp>`.
- **Distinct deep-link scheme.** Canary registers `instrument-canary://` (vs
  `instrument://`) so deep links and single-instance handoff stay separate from
  stable. OAuth is unaffected — it round-trips through a `localhost` callback,
  not the custom scheme.
- **Targets the staging API.** It does **not** auto-update: open
  **Settings → About → Download update** to pull the latest nightly, then install.
  The in-app download/install flow works on all platforms (AppImage on Linux).
- **Identification.** Settings → About shows the channel, branch, and a clickable
  short commit SHA for the exact build.
- A single build flag, `INSTRUMENT_CHANNEL=canary`, drives everything: the
  electron-builder identity ([`electron-builder.ts`](electron-builder.ts)), the
  baked-in app channel/metadata (vite `define` in
  [`electron.vite.config.ts`](electron.vite.config.ts)), and the updater behavior
  ([`src/electron-main/lib/update.ts`](src/electron-main/lib/update.ts)).
- Canary publishes a `canary.yml` manifest into the **same** `instrument-releases`
  bucket as stable; the distinct channel + bundle id keep it isolated, and
  `generateUpdatesFilesForAllChannels` is disabled for canary so it can never
  emit a `latest.yml`.

### CI prerequisites (provisioned outside this repo)

- `vars.MAIN_VITE_APP_API_BASE_URL_STAGING` — staging API base URL for canary.
- The canary workflow reuses the existing release signing secrets
  (`APPLE_*`, `CSC_*`, Windows GCP-KMS HSM) and S3 publish creds
  (`AWS_*`, `vars.BUILDER_PUBLISH_S3_ENDPOINT`).

### Regenerating the canary icon

`pnpm --filter @instrument-org/studio icons:generate` emits both stable and a
tinted canary icon set (`build/canary/`). To swap in bespoke canary artwork,
replace the tint step in [`scripts/generate-icons.ts`](scripts/generate-icons.ts)
with dedicated source PNGs and regenerate.
