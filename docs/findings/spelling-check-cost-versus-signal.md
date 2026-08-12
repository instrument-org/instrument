# Why the spell checker is `typos` and not `cspell`

**Status:** resolved. cspell removed, `typos` adopted. Recorded 2026-08-12.

## Context

`check:spelling` used to run cspell against a hand-maintained 233-word allowlist in `cspell.json`, with `check:unused-words` pruning that allowlist when nothing used a word anymore. It was kept for three reasons: catch typos, notice when a word that has never appeared in the codebase appears, and catch British spellings that violate the American-English rule in [AGENTS.md](../../AGENTS.md).

Measuring it showed the first reason had been overtaken by typechecking, the third was half-failing, and the second was not worth what it cost. This records the evidence, because "we should probably spell check" is a conclusion anyone would re-derive.

## What the measurement showed

### The cost was structural, not one-time

Over the first 4545 commits (from 2024-10-23):

| Signal                                                 | Count                     |
| ------------------------------------------------------ | ------------------------- |
| Commits touching `cspell.json`                         | 176 (3.9% of all commits) |
| Commits whose only changed file was `cspell.json`      | 37                        |
| Commits with "spell" or "typo" in the subject          | 91                        |
| Words added to the allowlist over its life             | 425                       |
| Words removed from the allowlist over its life         | 173                       |
| Final allowlist size                                   | 233                       |
| Inline `cspell:ignore`/`cspell:disable` directives      | 99 lines across 73 files  |
| Full-run wall time                                     | 5.2s over 1452 files      |

The add/remove ratio is the telling one. Onboarding cost would be front-loaded and flat by the end; instead the largest single month of additions was the last one measured. The allowlist grew with integration surface, and `check:unused-words` then forced removals when that surface moved, producing add-then-remove-then-re-add cycles no defect was downstream of. Both halves of that cycle are in the history: `dx: teach the spell checker a word this work introduced` and `dx: drop a dictionary word nothing spells`.

The config also understated the real suppression surface by a factor of five. Beyond the 233 listed words, 73 files carried inline directives, some of them long runs of platform symbols.

### The allowlist was noise by construction

Classifying the 233 words against a system dictionary with prefix and suffix stripping:

- **173 (74%) were proper nouns**: library names, model providers, GitHub handles, file formats, platform APIs. cspell can never stop asking about these, and every new dependency adds more.
- **60 (26%) were ordinary English that cspell lacks morphology for**: `renderable`, `retryable`, `unsandboxed`, `backgrounded`, `refetches`, `zoomable`, `navigations`, `recentering`.

Neither category recorded a judgment worth keeping. The file was not a curated vocabulary, it was a log of things cspell did not know.

### It checked the wrong half of the tree

`docs/` was in `ignorePaths`, and it is also excluded from [markdownlint](../../.markdownlint-cli2.jsonc) and [eslint](../../eslint.config.ts). The knowledge base, the one surface where a misspelling reaches a reader instead of a compiler, was the least-checked text in the repo: 64 real issues were sitting in it.

Meanwhile the code it did check is where typos already fail loudly. A misspelled identifier fails typechecking; a misspelled key in a literal fails a test or a schema parse.

### It passed half the British spellings

cspell flagged `behaviour`, `colour`, `favourite`, `capitalised`, `realise`, but passed `labelled`, `honour`, `honours`, `honouring`, `judgement`, `centred`, `unlabelled`, `coloured`, `labelling`, `modelling`, `totalling`, because those are in its English dictionary as accepted variants. **32 of them were in checked source paths and passing**, with another 40 in the unchecked `docs/`. The rule it was most explicitly kept for was the one it leaked.

### CI never enforced it

`check-and-test:ci` omitted `check:spelling` entirely, so the gate was local and self-imposed. Every commit spent satisfying it was voluntary.

## Why `typos`

[crate-ci/typos](https://github.com/crate-ci/typos) inverts the model. Instead of flagging every word not in a dictionary, it flags only words in a curated corrections corpus and reports the correction. Novel proper nouns are free, so there is nothing to allowlist as the codebase grows.

| | cspell | typos |
| --- | --- | --- |
| Wall time, whole repo | 5.2s | 0.08s |
| Allowlist entries | 233 plus 99 inline directives | 10 words, 1 identifier |
| Checks `docs/` | no | yes |
| Catches `labelled`, `honour`, `judgement`, `centred` | no | yes |
| Output | "unknown word" | "`labelled` should be `labeled`" |

`locale = "en-us"` is what makes the American-English rule executable rather than aspirational.

The honest tradeoff: because it is corrections-based, it misses novel transpositions of domain words. On ten fabricated ones it caught four and missed six (`wroktree`, `sandbxo`, `aggent`, `taskk`, `workspcae`, `trascript`). On ten realistic typos including British variants it caught ten. cspell would have caught all twenty, at the cost documented above.

We accepted that gap because what it protects is narrow. A misspelled identifier fails the typechecker, a misspelled key fails a test, and what survives to a human is comments, docs, and user-facing copy. Noticing a never-before-seen word is a **review** signal, not a correctness one; its natural shape is reading a diff, not a blocking gate backed by a hand-maintained file.

## What landed

- `typos.toml` at the root, and `scripts/typos.ts`, which fetches the pinned checksum-verified binary from crate-ci's GitHub releases into `node_modules/.cache` on first use. There is no first-party npm package, and the third-party wrapper would have needed a postinstall allowance in [pnpm-workspace.yaml](../../pnpm-workspace.yaml) for a single-maintainer package that downloads binaries.
- `check:spelling` now runs it, and unlike its predecessor it runs in CI. `fix:spelling` applies the corrections.
- `check:unused-words` is gone.
- 154 corrections across the tree, including `unparseable` to `unparsable` (a discriminated-union member, its producer, and its snapshots) and one genuine typo cspell had never seen (`macoS`).

Two things had to be excluded rather than corrected, both because their misspellings are the content: the eval that tests whether the agent honors a standing instruction to write British English, and this document.

Bumping the version means updating `TYPOS_VERSION` and every entry in `CHECKSUMS`. crate-ci publishes no checksum sidecar, so the hashes are pinned in the script rather than fetched.

## The pedantic lint rules are a different verdict

Worth separating, because the intuition that they are the same kind of waste does not hold up.

20 `perfectionist` sort rules are on via `recommended-natural`, plus `yml/sort-keys`, `yml/sort-sequence-values`, and `jsonc/sort-keys`. All are auto-fixable, and the `Stop` hook in [.claude/settings.json](../../.claude/settings.json) runs `eslint --fix` over changed files. Agents are not paying for these; the hook is.

The evidence that they are not fighting the code: **3 `eslint-disable` comments for perfectionist rules in the entire repo**. A rule set that needed constant escape hatches would show it here. The real cost is diff noise and the "the file changed after I wrote it" surprise, which AGENTS.md already warns about.

One rule is worth a second look. `perfectionist/sort-modules` orders top-level declarations, which forbids narrative ordering (entry point first, helpers below). It is the only sort rule that overrides a meaningful ordering rather than imposing one where none existed; the rest sort things with no natural order, which is exactly where alphabetization pays. `sort-objects` is already mitigated with `partitionByComment: true`.

`knip` and the type-aware oxlint rules are not in this category at all. They find real defects and should stay as they are.
