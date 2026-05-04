# Design documentation

Design docs describe **durable** intent: tradeoffs, invariants, and how major subsystems should evolve. They complement code and [ARCHITECTURE.md](../ARCHITECTURE.md).

## Index

| Document                           | Status | Summary                                        |
| ---------------------------------- | ------ | ---------------------------------------------- |
| [core-beliefs.md](core-beliefs.md) | living | Agent-first operating principles for this repo |

Add new design docs as `docs/design-docs/<topic>.md` and list them here with a one-line summary and status (`draft`, `living`, or `archived`).

## When to add a design doc

- A change affects multiple packages or public surfaces.
- You are encoding a team decision that is not obvious from code alone.
- You need a place to record alternatives considered and why one path won.

Keep each document focused. Prefer links to [../exec-plans/](../exec-plans/) for time-bounded implementation detail.
