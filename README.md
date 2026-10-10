<div align="center">
  <a href="https://tryinstrument.com">
    <img src=".github/assets/app-icon-stylized.png" width="96" alt="Instrument" />
  </a>
  <h1><a href="https://tryinstrument.com">Instrument</a></h1>
  <p>A calm, powerful, private AI workspace, perfectly at home on your computer.</p>
</div>

---

Instrument is an AI workspace that runs privately on your computer. It has a built-in browser, works with your local files, and runs its own tools to complete complex, multi-step tasks rather than just answering questions.

- Complete challenging multi-step tasks with AI
- Create and edit documents, slides, spreadsheets, and reports
- Browse and act on the web with an onboard AI agent
- Every task saves as a local folder you own, versioned automatically

Works with Claude, GPT, Gemini, or local models.

---

## Support and feedback

Reports and requests start as discussions, not issues. Please pick the matching category, because only Issue Triage asks for the details a bug needs.

- **Something broken?** [Open an Issue Triage discussion](https://github.com/instrument-org/instrument/discussions/new?category=issue-triage).
- **Want a feature, or have an idea?** [Open a Feature Requests, Ideas discussion](https://github.com/instrument-org/instrument/discussions/new?category=feature-requests-ideas).
- **Question, or need help with setup?** [Open a Q&A discussion](https://github.com/instrument-org/instrument/discussions/new?category=q-a).
- **Security vulnerability?** Email `security@tryinstrument.com` rather than filing publicly. See [SECURITY.md](.github/SECURITY.md).

The [issue tracker](https://github.com/instrument-org/instrument/issues) holds work we have accepted; discussions get promoted to issues once they reach an actionable conclusion. [CONTRIBUTING.md](CONTRIBUTING.md) has the full routing and what makes a report actionable.

---

## Setup for development

Prerequisites: [.agents/setup.md](.agents/setup.md). Environment variables: [.agents/env.md](.agents/env.md).

```bash
pnpm studio   # run Studio
pnpm sync     # pull the latest main
```

Both get the checkout ready before anything else (dependencies, the `registry/` submodule, the Mac bridge, `apps/studio/.env.local`), so they are safe to run at any time, on a fresh clone or after a pull. The account and billing API that Studio signs in through runs from the `internal` repository, with `pnpm api` at its root.

## Dependencies

### `pnpm-workspace.yaml`

- `@types/node` is pinned to an exact version in the `catalog:` to avoid constant `pnpm dedupe --check` failures.
- `better-sqlite3` is ignored in `pnpm-workspace.yaml` to avoid the native dependency installation because we are using Node's native SQLite support.
- `@mongodb-js/zstd` and `node-liblzma` are ignored because they are native addons pulled in by `just-bash`'s `tar` command for zstd/xz support; tar works without them via fallback.
- `@electron/rebuild>node-abi` is overridden to `4.31.0`. electron-builder 26.8.2 resolves `node-abi` 4.24.0, which predates Electron 42 and cannot map its ABI, so `@electron/rebuild` fails. The override is scoped to `@electron/rebuild` so nothing else is affected.
- `just-bash@3.4.1` is patched with changes we carry ahead of upstream releases (see `patches/just-bash@3.4.1.patch`). The patch is generated, not hand-edited: `pnpm scripts:rebuild-just-bash-patch` rebuilds it from the sources named in `patches/just-bash-sources/`. Everything we patch or work around in `just-bash`, and what has to be true before each can go, is registered in [docs/architecture/just-bash-upstream.md](docs/architecture/just-bash-upstream.md).
- `@parcel/watcher@2.6.0` is patched to delete its `binding.gyp` (see `patches/@parcel__watcher@2.6.0.patch`). At runtime the loader requires the prebuilt per-platform package (`@parcel/watcher-${platform}-${arch}`, all listed as explicit deps) first and only falls back to a source-compiled `./build/Release/watcher.node`, which we never use. With `npmRebuild: true`, `@electron/rebuild` sees `binding.gyp` and compiles that unused fallback against Electron's ABI (wasted work, and a cross-compile failure risk). Removing `binding.gyp` makes `@electron/rebuild` skip just this package while still rebuilding every other native addon. electron-builder has no per-module rebuild exclusion (`excludeReBuildModules` PR #9097 was closed unmerged), so the patch is the supported path; revisit if that lands.
