# Execution plans

Long-running or multi-step work uses **ExecPlans** (living markdown specs). See [PLANS.md](../../PLANS.md) for the required sections and rules.

## Layout

| Path | Purpose |
| ---- | ------- |
| [active/](active/) | Current ExecPlans |
| [completed/](completed/) | Finished ExecPlans kept for history |
| [tech-debt-tracker.md](tech-debt-tracker.md) | Known doc or code gaps worth scheduling |

Move a plan from `active/` to `completed/` when acceptance criteria are met and the **Outcomes and retrospective** section is filled in.

## Naming

Use identifiers that read well in git logs, for example `FP-956-agent-documentation.md` or `feature-slug-short.md`.
