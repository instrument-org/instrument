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

## Setup for development

Prerequisites: [.agents/setup.md](.agents/setup.md). Environment variables:
[.agents/env.md](.agents/env.md).

```bash
pnpm install
./scripts/setup.sh
pnpm run dev:studio
```

## Dependencies

### `pnpm-workspace.yaml`

- `@types/node` locked in `package.json` to avoid constant `pnpm dedupe --check` failures.
- `better-sqlite3` is ignored in `pnpm-workspace.yaml` to avoid the native dependency installation because we are using Node's native SQLite support.
- `@mongodb-js/zstd` and `node-liblzma` are ignored because they are included by `just-bash` but not working.
