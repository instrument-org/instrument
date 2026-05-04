# Core beliefs (agent-first)

These principles guide how we structure Instrument and how agents (and humans) should work in this repository. They align with the “harness engineering” idea: **humans steer, agents execute**, and the repo must stay **legible** to future runs (OpenAI, “Harness engineering”, 2026).

1. **Repository is the system of record**  
   What is not in git (or linked from versioned docs with stable intent) is effectively unknown to the next session. Capture decisions in code, `docs/`, or an ExecPlan.

2. **Progressive disclosure**  
   Short entry points ([AGENTS.md](../../AGENTS.md), [../ARCHITECTURE.md](../ARCHITECTURE.md)) point to deeper docs. Avoid one giant file that goes stale and crowds out the task in context.

3. **Map, not manual**  
   `AGENTS.md` is a table of contents. Long procedures live in `docs/` or `PLANS.md`-style execution plans.

4. **Enforce invariants, not style opinions**  
   Use types, lint, tests, and clear module boundaries. Prefer **parsing and shaping data at boundaries** over ad-hoc checks scattered through call sites. (See Alexis Beingessner on “parse, do not validate” in [../references/external.md](../references/external.md) when you need the original article; note the upstream URL has been unstable in some environments.)

5. **Tight feedback loops**  
   Prefer small, verifiable steps: run the narrowest check that proves the change, then widen. For long tasks, use an ExecPlan and keep **Progress** accurate ([PLANS.md](../../PLANS.md)).

6. **Respect the registry boundary**  
   The `registry/` submodule is read-only here. Propose changes upstream, not in this tree.

7. **Continuous alignment**  
   When review feedback or incidents reveal a missing guardrail, encode it (lint rule, test, or doc) so the same mistake does not require memory.
