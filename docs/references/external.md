# External references

Curated links that shaped Instrument’s documentation model. Summaries are brief; read the originals for nuance.

## Agent-first and harness engineering

- **Harness engineering: leveraging Codex in an agent-first world** (Ryan Lopopolo, OpenAI, 2026)  
  <https://openai.com/index/harness-engineering/>  
  Describes treating `AGENTS.md` as a table of contents, a structured `docs/` directory as system of record, progressive disclosure, mechanical validation of docs, execution plans, and making logs and metrics legible to agents.

- **agents.md** (community format)  
  <https://agents.md/>  
  Lightweight convention for agent-facing repo guidance; complementary to our [AGENTS.md](../../AGENTS.md).

## Execution plans

- **Using PLANS.md for multi-hour problem solving** (OpenAI Cookbook, 2025)  
  <https://cookbook.openai.com/articles/codex_exec_plans>  
  Defines ExecPlans, living sections, and how to keep plans self-contained for stateless agents.

## Architecture documentation

- **ARCHITECTURE.md** (Aleksey Kladov, 2021)  
  <https://matklad.github.io/2021/02/06/ARCHITECTURE.md.html>  
  Argues for a short architecture file with a codemap and explicit invariants rather than trying to mirror every code change.

## Feedback loops and iteration

- **Everything is a Ralph loop** (Geoffrey Huntley)  
  <https://ghuntley.com/loop/>  
  Describes iterative goal-driven loops; useful mental model for agent review and fix cycles (related to the “Ralph Wiggum loop” mentioned in OpenAI’s harness post).

## Code quality under agents

- **AI Is Forcing Us To Write Good Code** (Steve Krenzel, Logic, 2025)  
  <https://bits.logic.inc/p/ai-is-forcing-us-to-write-good-code>  
  Emphasizes namespaces, fast tests, typed boundaries, and guardrails agents can rely on.

## Parse at boundaries

- **Parse, don’t validate** (Niki Matsakis / Alexis Beingessner) — canonical article on representing validated states with types.  
  **Note:** The historical `lexi-lambda.github.io` URL for this post returned **404** when fetched from this environment (February 2019 post). If you need the primary source, open it in a browser or paste an archived copy into your ExecPlan. A common stable mirror is the Internet Archive or the author’s canonical publication; search for “parse don’t validate rust traits”.

## Housekeeping

When adding a link, include **title**, **author or venue**, **year if known**, **URL**, and **one sentence** why it matters here.
