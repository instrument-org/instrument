# Instrument repository guide for agents

This file is a **map**, not an encyclopedia. Prefer reading targeted docs under `docs/` over stuffing everything into one prompt.

## What this repo is

Pnpm monorepo for **Instrument**, an Electron desktop product:

- `apps/studio` — Electron app (main, preload, renderer).
- `packages/workspace` — agents, workflow logic, workspace management.
- `packages/shim-client` — runtime injected into user applications.
- `packages/shared`, `packages/ai-gateway` — shared utilities and local AI gateway.

The `registry/` directory is a **read-only** git submodule (skills). Do not edit files inside it.

## Where to look first

| Goal                         | Start here                                              |
| ---------------------------- | ------------------------------------------------------- |
| Repo layout and boundaries   | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)            |
| Local setup and dev commands | [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)            |
| Tests, lint, CI expectations | [docs/QUALITY.md](docs/QUALITY.md)                    |
| Security and trust boundaries | [docs/SECURITY.md](docs/SECURITY.md)                    |
| Design principles and index  | [docs/design-docs/index.md](docs/design-docs/index.md) |
| Product-facing specs (when present) | [docs/product-specs/index.md](docs/product-specs/index.md) |
| Active or archived execution plans | [docs/exec-plans/](docs/exec-plans/)           |
| External references (URLs)   | [docs/references/external.md](docs/references/external.md) |

## Execution plans (ExecPlans)

For large or multi-step work, use an **ExecPlan** as a living document:

- Rules and expectations: [PLANS.md](PLANS.md) at the repository root.
- Put **active** plans in `docs/exec-plans/active/` and **completed** plans in `docs/exec-plans/completed/`.
- Name files so intent is obvious, for example `docs/exec-plans/active/FP-123-feature-name.md`.

## Progressive disclosure

1. Read `docs/ARCHITECTURE.md` for orientation.
2. Open only the package directory you are changing.
3. Use search by symbol or path names referenced in the architecture doc.
4. Update docs when you change invariants, public APIs, or workflow assumptions.

## Doc maintenance

When your change alters how developers or agents should work, update the smallest relevant doc in `docs/`. If unsure, add a note to [docs/exec-plans/tech-debt-tracker.md](docs/exec-plans/tech-debt-tracker.md) or the active ExecPlan.

Periodic automated doc gardening is tracked separately (FP-957).
