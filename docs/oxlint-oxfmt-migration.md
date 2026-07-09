# oxlint / oxfmt migration

Status of the move from ESLint+Prettier to the oxc toolchain, and the work
deferred to keep this branch mergeable ahead of other in-flight branches.

## Done (this branch)

- **Type-aware linting → oxlint** (`oxlint --type-aware`, tsgolint). ESLint no
  longer builds a TypeScript program. See `.oxlintrc.json`.
- **Tailwind → oxlint-tailwindcss** (per-package `.oxlintrc.json`), including
  `no-unknown-classes` (allowlist `toaster`). Dropped `eslint-plugin-better-tailwindcss`.
- **Formatting → oxfmt** (native, `.oxfmtrc.json`). Dropped Prettier and its
  curly/sh/sql plugins. `check:format`/`fix:format` and the editor
  (`oxc.oxc-vscode`) use oxfmt. The agent-hooks `format.mjs` runs oxfmt too.
- Dropped deprecated `eslint-plugin-markdown` (repo has no fenced code blocks).
- Bumped markdownlint/cli2; upgraded knip 5→6.

### Current split (who owns what)

- **oxlint**: all TypeScript type-aware rules + Tailwind.
- **oxfmt**: all formatting (JS/TS/JSON/CSS/MD/YAML/HTML).
- **ESLint**: everything else — perfectionist (sorting), react-hooks (React
  Compiler rules), unicorn, import-x, react, regexp, n, yml, jsonc,
  package-json, turbo, vitest, eslint-comments, core, untyped TS syntax rules.
- **eslint-config-prettier**: kept. It is config-only (no rules); it disables
  ESLint's formatting rules (e.g. `unicorn/template-indent`) so they don't fight
  oxfmt. Per oxc's own migration guidance, keep it while ESLint stays.

## Deferred (do after the other branches merge)

Both items reformat/​autofix across the tree; doing them now would conflict
heavily with the 5-10 open branches targeting main. Do them as dedicated
follow-ups once the tree is quiet.

### 1. Import sorting → oxfmt (drop `perfectionist/sort-imports`)

The import _order_ already matches perfectionist; the only churn is oxfmt adding
a blank line between import groups (~281 files). Chosen style: grouped with
blank lines (`newlinesBetween: true`, the default).

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

2. Set `perfectionist/sort-imports` to `off` in `packages/eslint-config/base.ts`
   and `format.ts` (perfectionist keeps sort-objects / sort-jsx-props /
   sort-named-imports / sort-exports / etc.).
3. `pnpm fix:format`, then verify `check:format` + `check:lint` green.

Note: `newlinesBetween` is a boolean in oxfmt (no "ignore" mode), so it enforces
one policy tree-wide — that's the source of the churn.

### 2. Move untyped rules to oxlint via `eslint-plugin-oxlint`

Consolidation step, not a speed win (the ESLint floor is
`react-hooks/static-components` ~4.5s, which oxlint has no equivalent for).

Steps:

1. `pnpm add -D eslint-plugin-oxlint` (in `packages/eslint-config`).
2. Enable oxlint's native rule sets that mirror the currently-enabled ESLint
   rules (unicorn / import / react / core) in `.oxlintrc.json`. Match rule
   config, not whole categories — enabling `pedantic`/`style` surfaces
   thousands of opinionated findings.
3. Add `...oxlint.buildFromOxlintConfigFile("./.oxlintrc.json")` as the **last**
   entry in `base.ts` to turn off the ESLint copies of whatever oxlint runs.
4. Reconcile findings (expect a few TS7-precision diffs, like the type-aware
   migration), watch for orphaned `eslint-disable` comments and knip.

Stays in ESLint (no oxlint equivalent): perfectionist, react-hooks React
Compiler rules, most of regexp, yml, jsonc, package-json, turbo, vitest,
eslint-comments, `unicorn/expiring-todo-comments`, `import/no-unused-modules`.

**Endgame** (per oxlint docs): once oxlint covers those gaps, ESLint can be
removed entirely.

## Other follow-ups

- **Deploy agent-hooks**: `~/code/instrument/agent-hooks` commit `18df760`
  (prettier→oxfmt in `format.mjs`) is committed locally on `main`. Push it and
  bump the `@instrument-org/agent-hooks` github dep in each consuming repo
  (monorepo, skills, internal) so the installed hook runs oxfmt. The installed
  copy is patched locally in the meantime.
- **TypeScript 7**: revisit at **7.1**. TS 7.0 ships no programmatic JS API, so
  typescript-eslint's parser can't run on it; the current native-preview tsgo +
  typescript 5.9 split is already Microsoft's recommended setup.
- **oxfmt embedded HTML**: `embeddedLanguageFormatting` is on (default) and
  stable now that the unstable `runtime-list.ts` is gone. If a future `html\`\``-heavy file destabilizes`check:format`(non-idempotent), set`"embeddedLanguageFormatting": "off"`in`.oxfmtrc.json`.
