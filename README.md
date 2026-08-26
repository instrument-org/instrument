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
pnpm install
./scripts/setup.sh
pnpm run dev:studio
```

## Dependencies

### `pnpm-workspace.yaml`

- `@types/node` locked in `package.json` to avoid constant `pnpm dedupe --check` failures.
- `better-sqlite3` is ignored in `pnpm-workspace.yaml` to avoid the native dependency installation because we are using Node's native SQLite support.
- `@mongodb-js/zstd` and `node-liblzma` are ignored because they are native addons pulled in by `just-bash`'s `tar` command for zstd/xz support; tar works without them via fallback.
- `@electron/rebuild>node-abi` is overridden to `4.31.0`. electron-builder 26.8.2 resolves `node-abi` 4.24.0, which predates Electron 42 and cannot map its ABI, so `@electron/rebuild` fails. The override is scoped to `@electron/rebuild` so nothing else is affected.
- `just-bash@3.2.0` is patched so the sandbox can make any network request at all (see `patches/just-bash@3.2.0.patch`). Its ESM bundle inlines undici's CommonJS module, and the namespace the dynamic import returns for it carries the module under `default` alone, so the `Agent` the pinned connection owner constructs is `undefined`. With `denyPrivateRanges` on, which is the whole point of the option, the resulting `TypeError` is reported as `DNS pinning unavailable for private IP enforcement` and every `curl` fails. The patch reads the transport off whichever shape the namespace has; it edits minified bundle output, so read the equivalent source change in vercel-labs/just-bash#339 instead of the diff. Delete both once a release carries the fix. `create-bash-env-network.test.ts` fails if it regresses. Everything we patch or work around in `just-bash`, and what has to be true before each can go, is registered in [docs/architecture/just-bash-upstream.md](docs/architecture/just-bash-upstream.md).
- `@parcel/watcher@2.5.1` is patched to delete its `binding.gyp` (see `patches/@parcel__watcher@2.5.1.patch`). At runtime the loader requires the prebuilt per-platform package (`@parcel/watcher-${platform}-${arch}`, all listed as explicit deps) first and only falls back to a source-compiled `./build/Release/watcher.node`, which we never use. With `npmRebuild: true`, `@electron/rebuild` sees `binding.gyp` and compiles that unused fallback against Electron's ABI (wasted work, and a cross-compile failure risk). Removing `binding.gyp` makes `@electron/rebuild` skip just this package while still rebuilding every other native addon. electron-builder has no per-module rebuild exclusion (`excludeReBuildModules` PR #9097 was closed unmerged), so the patch is the supported path; revisit if that lands.
