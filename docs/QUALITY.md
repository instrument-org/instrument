# Quality bars

Instrument uses automated checks to keep the codebase consistent and agent-legible.

## Default workflow before pushing

From the repo root:

```bash
pnpm run check-and-test
```

This aggregates Turbo tasks for formatting, ESLint, TypeScript, spelling, unused-code detection, package install checks, builds, and CI-style tests. Use it when you touch multiple packages.

## Individual checks

| Check               | Command                   |
| ------------------- | ------------------------- |
| Format              | `pnpm run check:format`   |
| ESLint              | `pnpm run check:lint`     |
| TypeScript          | `pnpm run check:types`    |
| Markdown            | `pnpm run check:md`       |
| Spelling            | `pnpm run check:spelling` |
| Unused exports/deps | `pnpm run check:unused`   |

Fix helpers: `pnpm run fix:format`, `pnpm run fix:lint`.

## Philosophy

Strict boundaries and fast feedback help agents and humans alike (see Steve Krenzel, “AI Is Forcing Us To Write Good Code”, 2025, in [references/external.md](references/external.md)). Prefer small, well-named modules and tests that pin behavior at boundaries.

## Tests

- Root `pnpm test` runs Vitest with repository configuration.
- Packages may define `test` or `test:ci` scripts consumed by Turbo.

When adding behavior, add or update tests in the same change when feasible.
