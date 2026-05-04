# Execution plans (ExecPlans)

An **ExecPlan** is a self-contained, living markdown document that guides implementation of a non-trivial change. It is the contract between intent and code.

## When to use an ExecPlan

Use an ExecPlan when any of the following apply:

- The work spans multiple packages or sessions.
- There are real design forks or unknowns to resolve in-repo.
- You need a novice (human or agent) to finish the work without chat history.

For small, localized edits, a ExecPlan is optional.

## Where plans live

| Location                         | Purpose                                      |
| -------------------------------- | -------------------------------------------- |
| `docs/exec-plans/active/`        | In-progress plans                            |
| `docs/exec-plans/completed/`     | Finished plans kept for history and learning |
| `docs/exec-plans/tech-debt-tracker.md` | Known gaps that affect reliability or velocity |

## Required sections

Every ExecPlan must include and maintain:

1. **Purpose** — User-visible outcome and why it matters.
2. **Progress** — Checkbox list with timestamps at stopping points.
3. **Surprises and discoveries** — Evidence-backed notes from implementation.
4. **Decision log** — Decisions with rationale and date.
5. **Outcomes and retrospective** — What shipped, what is left, lessons.

Add **Context and orientation**, **Plan of work**, **Concrete steps**, **Validation and acceptance**, and **Interfaces and dependencies** as needed so a reader with only the repo and this file can succeed.

## Rules

- **Self-contained** — Do not rely on private chat, undocumented tribal knowledge, or URLs as substitutes for explanations. Link to stable references only as supplements.
- **Observable acceptance** — Describe how a human or agent verifies behavior (commands, URLs, fixtures), not only internal refactors.
- **Living document** — Update all sections when scope or facts change. Append a short revision note when meaningfully editing a completed plan.

## Further reading

OpenAI's cookbook describes the same pattern in depth (ExecPlans and long-running Codex tasks):

https://cookbook.openai.com/articles/codex_exec_plans
