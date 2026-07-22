# oxlint / oxfmt migration

Status of the move from ESLint+Prettier to the oxc toolchain, and the work deferred to keep this branch mergeable ahead of other in-flight branches.

## Done (this branch)

- **Type-aware linting → oxlint** (`oxlint --type-aware`, tsgolint). ESLint no longer builds a TypeScript program. See `.oxlintrc.json`.
- **Tailwind → oxlint-tailwindcss** (per-package `.oxlintrc.json`), including `no-unknown-classes` (allowlist `toaster`). Dropped `eslint-plugin-better-tailwindcss`.
- **Formatting → oxfmt** (native, `.oxfmtrc.json`). Dropped Prettier and its curly/sh/sql plugins. `check:format`/`fix:format` and the editor (`oxc.oxc-vscode`) use oxfmt. The agent-hooks `format.mjs` runs oxfmt too.
- Dropped deprecated `eslint-plugin-markdown` (repo has no fenced code blocks).
- Bumped markdownlint/cli2; upgraded knip 5→6.
- **Untyped TypeScript rules → oxlint** (`eslint-plugin-oxlint`). Added oxlint equivalents of typescript-eslint's `strict` + `stylistic` configs, plus the explicit `no-shadow` / `no-redeclare` / `no-unused-vars` / `no-use-before-define` / `consistent-type-imports` rules, to `.oxlintrc.json` (bare names for rules oxlint reimplements under core `eslint`, e.g. `no-shadow`; `typescript/*` for the rest) with matching options. `base.ts`'s last config entry, `oxlint.buildFromOxlintConfigFile(...)`, turns off the now-redundant ESLint copies. Validated empirically first: across ~988 files, enabling the full set surfaced exactly one real finding (an `adjacent-overload-signatures` case in `apps/studio/src/electron-main/lib/update.ts`, where a public getter and private setter are intentionally kept apart by `perfectionist/sort-classes` — suppressed with `oxlint-disable-next-line`, same as the pre-existing `eslint-disable` it replaced). Existing `eslint-disable` comments for the migrated rules were converted to `oxlint-disable` (oxlint also honors the old `@typescript-eslint/*` disable-comment spelling for interop, but leaving them as `eslint-disable` would trip ESLint's `reportUnusedDisableDirectives` once its copy of the rule is off).

### Current split (who owns what)

- **oxlint**: all TypeScript rules, type-aware and syntactic, + Tailwind.
- **oxfmt**: all formatting (JS/TS/JSON/CSS/MD/YAML/HTML).
- **ESLint**: everything else — perfectionist (sorting), react-hooks (React Compiler rules), unicorn, import-x, react, regexp, n, yml, jsonc, package-json, turbo, vitest, eslint-comments, core.
- **eslint-config-prettier**: kept. It is config-only (no rules); it disables ESLint's formatting rules (e.g. `unicorn/template-indent`) so they don't fight oxfmt. Per oxc's own migration guidance, keep it while ESLint stays.

## Deferred (do after the other branches merge)

Import sorting reformats/autofixes across the tree; doing it now would conflict heavily with the 5-10 open branches targeting main. Do it as a dedicated follow-up once the tree is quiet. (The untyped-TypeScript-rules step that used to be listed here is done — see "Done" above. It turned out to be low-risk: config + a couple of comment edits, no tree-wide autofix, so it didn't need to wait.)

### 1. Import sorting → oxfmt (drop `perfectionist/sort-imports`)

The import _order_ already matches perfectionist; the only churn is oxfmt adding a blank line between import groups (~281 files). Chosen style: grouped with blank lines (`newlinesBetween: true`, the default).

Steps:

1. Add to `.oxfmtrc.json`:

   ```json
   "sortImports": {
     "groups": [
       "type-import",
       ["value-builtin", "value-external"],
       "type-internal",
       "value-internal",
       ["type-parent", "type-sibling", "type-index"],
       ["value-parent", "value-sibling", "value-index"],
       "unknown"
     ]
   }
   ```

2. Set `perfectionist/sort-imports` to `off` in `packages/eslint-config/base.ts` and `format.ts` (perfectionist keeps sort-objects / sort-jsx-props / sort-named-imports / sort-exports / etc.).
3. `pnpm fix:format`, then verify `check:format` + `check:lint` green.

Note: `newlinesBetween` is a boolean in oxfmt (no "ignore" mode), so it enforces one policy tree-wide — that's the source of the churn.

### 2. Move remaining untyped rules (unicorn/import/react/core) to oxlint

The TypeScript-eslint slice of this is done (see "Done" above); this covers what's left. Consolidation step, not a speed win (the ESLint floor is `react-hooks/static-components` ~4.5s, which oxlint has no equivalent for) — unlike the TypeScript-rules step, this one is unvalidated, so check for tree-wide noise before committing to it (same approach: build a scratch `.oxlintrc.json`, run `oxlint --type-aware` repo-wide, and look at the diff before touching config for real).

Steps:

1. Enable oxlint's native rule sets that mirror the currently-enabled ESLint rules (unicorn / import / react / core) in `.oxlintrc.json`. Match rule config, not whole categories — enabling `pedantic`/`style` surfaces thousands of opinionated findings.
2. `oxlint.buildFromOxlintConfigFile(...)` (already wired in `base.ts`, see "Done") picks up any new rules automatically — no further `base.ts` changes needed, just extend `.oxlintrc.json`.
3. Reconcile findings, watch for orphaned `eslint-disable` comments (convert to `oxlint-disable` the way the TypeScript-rules step did) and knip.

Stays in ESLint (no oxlint equivalent): perfectionist, react-hooks React Compiler rules, most of regexp, yml, jsonc, package-json, turbo, vitest, eslint-comments, `unicorn/expiring-todo-comments`, `import/no-unused-modules`.

**Endgame** (per oxlint docs): once oxlint covers those gaps, ESLint can be removed entirely.

## Other follow-ups

- **Deploy agent-hooks oxlint pass**: `~/code/instrument/agent-hooks` `main` (commit `1242ba1`) adds an `oxlint --fix` pass to `format.mjs` (fast, no `--type-aware`) on the Stop / batch-edit paths so agent edits auto-sort Tailwind classes and pick up other oxlint autofixes — the eslint `--fix` pass never covered oxlint's rules. Needed now that `tailwindcss/enforce-sort-order` is an `error` (see `apps/studio/.oxlintrc.json`): without it, agent-written class order fails `check:lint` with nothing fixing it. Push it and bump the `@instrument-org/agent-hooks` github dep — currently pinned to the oxfmt commit `144b17b` — in each consuming repo (monorepo, skills, internal) so the installed hook runs oxfmt + oxlint. (The earlier prettier→oxfmt change is already pushed and pinned.)
- **TypeScript 7**: revisit at **7.1**. TS 7.0 ships no programmatic JS API, so typescript-eslint's parser can't run on it; the current native-preview tsgo + typescript 5.9 split is already Microsoft's recommended setup.
- **oxfmt embedded HTML**: `embeddedLanguageFormatting` is on (default) and stable now that the unstable `runtime-list.ts` is gone. If a future `html\`\``-heavy file destabilizes`check:format`(non-idempotent), set`"embeddedLanguageFormatting": "off"`in`.oxfmtrc.json`.
