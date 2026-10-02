# Token cost per task: where it goes and what would move it

**Status:** open. Baseline measured once, 2026-09-24, over one developer's local task history. The ranked list is the live part; each item names how it would be validated. Two direct fixes from this pass landed (reasoning replay for current OpenAI models, cache-aware eval cost); nothing prompt-side has moved.

The question is price-weighted token cost per completed task, not tokens per request: every step resends the prefix and the whole conversation so far, so a change that shrinks one request but adds steps can cost more. This is the cost counterpart to [agent-prompt-surface-review.md](./agent-prompt-surface-review.md), which measured the prompt's wording, and to [prompt-cache-provider-affinity-and-breakpoints.md](./prompt-cache-provider-affinity-and-breakpoints.md), which this measurement partly retires.

## Method

- **Source.** Every `.instrument/task.db` in the production workspace: 366 tasks, 5,934 model steps with reported usage (2026-04-15 to 2026-09-23). Synthetic replay steps are excluded. Each assistant message is one step and carries `metadata.usage` with `inputTokenDetails.{cacheReadTokens,cacheWriteTokens,noCacheTokens}` and `outputTokenDetails.reasoningTokens`, so no new telemetry was needed. Figures marked "since Sep 1" (107 sessions, 1,848 steps) reflect the current prompt and the immutable session context; the full range is kept where it shows change.
- **Prices.** Weighted at OpenRouter's list price for `openai/gpt-5.6-luna`, the model behind most recent steps: $0.20/M fresh input, $0.02/M cache read, $0.25/M cache write, $1.20/M output. Ratios, not absolutes, are the point. Anthropic's ratios (1 : 0.1 : 1.25 : 5) give the same ranking.
- **Static prefix by section.** Rendered with `mainAgent.getMessages` / `instrumentAgent.getMessages` and each tool's `aiSDKTool`, counted with `tokenx`. The estimate sums to 15.6K against a reported 14.5K median first-step input for a task, so section shares are good and absolutes run about 7% high.
- **History by source.** Each part's model-visible size (bash output capped at the 20 KB head-and-tail `toModelOutput` shows; media excluded) times the number of later steps in its session that resend it. That is the share of cumulative input each source is responsible for; it is character-weighted, so it slightly undercounts dense content (see [character-budgets-are-a-token-proxy.md](./character-budgets-are-a-token-proxy.md)).

## Baseline

### Cost by billing type (since Sep 1)

| | share of cost |
| --- | ---: |
| cache reads | 47% |
| cache writes (new content each step, cold first steps) | 36% |
| output, visible | 11% |
| output, reasoning | 6% |
| fresh uncached input | ~0% |

Input is 83% of cost despite a 94% cache-read rate, because a session averages 17 steps and 49K input tokens a step. Output is not where the money is. `cacheWriteTokens` on the `instrument` route arrives as a near-copy of `noCacheTokens`, so writes are billed here at the write rate; if that route in fact bills them as plain input, the write row shrinks by a fifth and nothing below reorders.

### Cost by source

Input splits 34% static prefix (resent every step) and 66% conversation history. Folding in the billing mix:

| source | est. share of total cost |
| --- | ---: |
| **static prefix** | **~23%** |
| of which: tool definitions | ~12% |
| of which: `bash` description alone | ~5% |
| of which: system prompt | ~8% |
| of which: skill catalog (`<available_skills>`) | ~3% |
| **history** | **~60%** |
| assistant text replayed | ~12% |
| `agent-browser` output (via `bash`) | ~10% |
| other `bash` output | ~8% |
| `read_file` results | ~8% |
| `web_search` results | ~7% |
| `load_skill` bodies | ~5% |
| tool call inputs | ~3% |
| `web_fetch` results | ~3% |
| stored reasoning text, notes, user text | ~3% |
| **output** | **~17%** |

The top 10% of sessions carry 48% of all input since Sep 1 (71% over the full range); the largest reached 196K tokens of context in one step.

### Static prefix per request (main agent, task opened by the user)

| section | ~tokens |
| --- | ---: |
| system prompt | 5,250 |
| context message (`<system_info>` 200, `<available_skills>` 2,100) | 2,300 |
| `bash` description + schema | 3,650 + 230 |
| `read_file` | 570 + 440 |
| `generate_image` | 420 + 430 |
| `web_fetch` | 230 + 420 |
| `edit_file` | 330 + 210 |
| `web_search` | 300 + 130 |
| `load_skill` | 220 + 120 |
| `write_file` | 200 + 150 |

The orchestrator's prefix is ~10K: an 8.1K system prompt (the `# Tasks` section alone is 3.2K), 600 of context, 1.4K of tools.

The `bash` description has grown from ~1,040 tokens when the prompt-surface review said not to trim it on size grounds to ~3,650 now, most of it the specialized-command list and the Python, background-process and mount paragraphs.

### Cache behavior

| since Sep 1 | share of uncached input |
| --- | ---: |
| new content appended each step | 67% |
| cold first step of a session | 21% |
| resume after more than 5 minutes idle | 11% |
| miss within 5 minutes of the previous step | 2% |

Over the full range, short-gap misses were 34% of uncached input and 9.1% of steps; since Sep 1 they are 0.3% of steps. That drop lines up with the immutable session context landing, so the byte-stability work did what it was for, and the affinity key the provider-affinity finding proposes is now worth about 2% of uncached input on this route. First steps hit the cross-session prefix (~11.7K of system and tools) 53% of the time and miss it entirely the rest.

### Tools

| tool | calls | % of tasks | error rate |
| --- | ---: | ---: | ---: |
| `bash` | 3,123 | 71% | 0.8% |
| `read_file` | 867 | 50% | 1.5% |
| `start_activity` | 549 | 34% | 0% |
| `web_search` | 462 | 20% | 0.2% |
| `load_skill` | 232 | 46% | 2.2% |
| `edit_file` | 303 | 20% | 3.0% |
| `write_file` | 209 | 28% | 1.9% |
| `web_fetch` | 163 | 14% | 0% |
| `generate_image` | 24 | 3% | 12.5% |

Steps per session: 15.2 over the full range, 17.3 since Sep 1. Tasks the orchestrator started run 22 steps on average at a 95% read rate; the orchestrator itself runs at 86%.

## Ranked opportunities

Ranked by share of spend times fraction removable, divided by quality risk.

| # | layer | change | est. saving | risk | validate | roll back |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | history | Collapse superseded `agent-browser` page output: once a later `snapshot`/`get`/`eval` of the same tab exists, replace the earlier result with a one-line stub naming the spill file. Apply in batches (e.g. only when 20K+ tokens are collapsible) so each collapse costs one cache rewrite rather than one per step. | 4-6% of total (half to two thirds of the ~10%) | medium: element refs in an old snapshot are already stale, but a model may quote text it saw there | browsing eval cases across three model tiers; tool-error rate on `agent-browser click` with stale refs; steps per task | flag in `prepareModelMessages` |
| 2 | history | Tighten `web_search` excerpts: median 14.6K characters per call, repository READMEs arriving whole. Cap per-source excerpt length and let `web_fetch` carry depth. | 2-4% | medium: fewer facts per search can mean more searches | research eval cases; searches and fetches per task; answer-quality assertions | constant in the search client |
| 3 | static | Move `generate_image` (3% of tasks, 850 tokens) and `web_fetch` (14%, 650 tokens) out of the static tool set, discoverable through `load_skill` or a one-line pointer | ~2% | medium: `generate_image` is a first-turn tool when asked for; offloading it risks a missed call | image and fetch eval cases; tool-not-found and repair counts | flag on `getTools` |
| 4 | static | Rewrite the `bash` description (table below): drop what the command list already says, and the emphasis | ~1% | low to medium | full eval suite across tiers; `which` probes, `cd`-into-skill failures, loopback curl failures | revert the commit |
| 5 | static | System prompt pass (table below) | ~1-2% | medium to high on mid-tier models, per [the prompt-surface review](./agent-prompt-surface-review.md) section C | cross-tier eval with long-document transcription cases | revert the commit |
| 6 | history | Sparse line numbers in `read_file` (every 10th line, plus the first and last of a range) | <1% | low | `edit_file` "oldString not found" rate; citation accuracy | constant in `addLineNumbers` |
| 7 | cache | Session-derived `prompt_cache_key` on OpenAI routes | ~0.5% (2% of uncached) | low | cache-read share on short gaps | provider option |
| 8 | cache | Cold first steps: 47% of sessions pay ~12K of writes for a prefix every session shares | ~2% | needs a routing contract, and a constant key concentrates every user of the shared key onto one cache node | first-step read share | provider option |

Proposed only (model mix and orchestration, not harness text):

- **Children on a cheaper model.** Orchestrator-started tasks are 25% of input and run 22 steps each. The orchestrator writes a brief and reads a 4,000-character receipt, which is the planner and worker split where a cheaper worker has matched a frontier one elsewhere. It wants an eval over the orchestrator cases measuring the whole tree's cost, since a cheaper worker that takes more steps can cost more.
- **Effort routing.** Reasoning is 35% of output tokens, 6% of cost. Not worth routing on cost alone.

## Changes made

- **`ai-gateway`: encrypted reasoning for gpt-6 and the o-series.** `providerOptionsForModel` matched `gpt-5` and the literal prefix `o-`, so `gpt-6-luna`, `o3` and `o4-mini` on a direct OpenAI Responses route ran with `store: false` and no encrypted reasoning item: every step started without the previous step's reasoning. It now matches gpt-5 and later and `o<digit>`.
- **`evals`: cache-aware cost.** `costUSD` billed every input token at the prompt rate, so a run with 90% cache reads read several times its real cost and a change that moved tokens between fresh and cached showed nothing. It now prices reads and writes from OpenRouter's `input_cache_read` / `input_cache_write`. This is the number the flagged changes above get judged by.

Not changed, and why:

- Request order, tool order, and volatile content were already right: tools are picked in a fixed order, the context message is written once per session, the date is day-granular, and nonces are seeded from the tool-call id. The ways a tool description changes mid-session (activity-headings flag, external-browser setting, `generate_image` on a model switch) are all rare, and a model switch already discards the cache.
- Large outputs already spill: `bash` and `web_fetch` write the full output to `.tool-output/` and show head and tail.
- Nothing strips reasoning items except the cross-model OpenRouter redaction, which is correct.

## Proposed prompt text changes

Labels: **keep** (product or environment fact the model cannot infer, or a quirk seen in transcripts), **rewrite** (same content, stated plainly), **delete** (repeats another surface, or a default behavior), **move** (belongs somewhere read only when needed).

### `bash` description (~3,650 tokens)

| paragraph | label | reason |
| --- | --- | --- |
| "Execute bash commands in the task directory." | keep | |
| Mounts under `/mnt`, read-only vs read-write, native hatches cannot resolve them | keep, rewrite | environment fact; drop the `IMPORTANT:` prefix |
| "Two Pythons" paragraph | rewrite, about -250 tokens | the `python`, `python-native`, `node` and `js-exec` entries in the command list say the same thing; keep only the path-translation rule, "npm is not available", and the do-not-keep-probing line (14 `which` probes seen) |
| "Not a persistent terminal", no `/tmp` | keep, rewrite | the no-`cd` failure rate is measured (5.8% vs 1.6%) |
| Interactive input unsupported | keep, rewrite | environment fact |
| Background processes, `yieldMs`, composition examples, 2-hour cap, streaming | rewrite, about -120 tokens | the `jobs`/`fg`/`kill` entries repeat most of it; keep "outliving `yieldMs` backgrounds a command, `&` does not" and the cap |
| `curl` refuses loopback with a bare exit 7 | keep | the model cannot infer it and the failure is silent |
| Prefer `read_file` / `edit_file` over `cat` / `sed` | keep | shell-first model families fall back to `cat` without it |
| `rg` lines | rewrite | merge "prefer `rg` over `grep`" into the first `rg` line |
| TIP: `curl -L -o` | delete | default knowledge |
| TIP: run `--help` first | delete | default behavior |
| TIP: heredoc pipe placement | keep pending transcripts | delete if no transcript shows the mistake |
| Builtin list and "not listed means not available" | keep, rewrite | environment fact; drop the caps |
| Bare-name invocation, `which` lies | keep, rewrite | quirk seen in transcripts |
| `agent-browser` entry, "never fabricate URLs" | keep | behavior guard against stale deep links; unmeasured, so a candidate for the eval |
| `fg` entry's two `IMPORTANT:` lines | rewrite | plain statements of behavior |

Net: roughly -450 tokens, 12% of the description.

### Main system prompt (~5,250 tokens)

| section | ~tokens | label | reason |
| --- | ---: | --- | --- |
| Role sentence | 66 | keep | |
| Automation on the User's Behalf | 450 | keep until evaluated | anti-refusal pressure for older models; the prompt-surface review's section C holds the eval it needs |
| Who reads you | 170 | keep | product fact |
| Tone and Style | 545 | keep | product voice |
| Files you write | 299 | keep | product fact |
| Execution and Autonomy | 585 | rewrite | several bullets restate default agentic behavior ("stay with the task", "try a materially different method"); keep the ask-one-question rule and "do not hand the user instructions" |
| Task Folder | 618 | keep | environment fact |
| Tools Usage Guidance | 927 | rewrite and move | the `generate_image` paragraph belongs in that tool's description (rule 3 moves it with the tool); "POSIX forward slashes" is a delete; the web-search rules are measured behavior and stay |
| Producing Deliverables | 203 | keep | |
| Showing Files / Sources | 775 | keep | product rendering contract |
| Scripts and Running Code | 431 | move | to a bundled skill, except the no-`cd` rule (prompt-surface review D1) |
| File Changes | 120 | keep | |

Net: roughly -600 to -800 tokens if every rewrite and move lands. The orchestrator's `# Tasks` section (3.2K) is the other large block and has not been labeled.

## Test plan for the flagged changes

1. **Offline, per change.** `pnpm eval run` over the existing cases on three tiers (a frontier model, the default `auto` target, and one mid-tier), `--repeat 3`, before and after. Compare per case: pass rate, `costUSD` (now cache-aware), steps, tool errors, `stoppedBy`. The `systemPromptSha256` in `eval-case.json` confirms which prompt each run used. Ship only when cost drops and pass rate does not.
2. **Cases the current suite lacks.** Items 1 and 2 need browsing and research cases that run long enough (15+ steps) for history to dominate; items 3 and 5 need a first-turn image request and a long-document transcription.
3. **Real usage.** Re-run this measurement over the following two weeks of real tasks: cost per task, steps per task, cache-read share, tool error rates by tool, and whether the user's next message moves on or reports a problem.
4. **Record nulls.** A change that saves tokens and costs steps goes back, and gets a line here.

## Gaps

- **One developer's history.** No user-base data; the mix skews toward browsing and building.
- **Cost is priced, not billed.** No runtime cost accounting exists; figures are list-price estimates on one model's rates. `llm.request_finished` omits `cacheWriteTokens`.
- **Write accounting on the `instrument` route.** `cacheWriteTokens` arrives as a near-copy of `noCacheTokens`. Whether the route bills those at the write rate is unconfirmed.
- **Task success is not in the data.** Nothing records whether a task succeeded, so this baseline has cost and no quality denominator. The eval suite's assertions are the only quality signal.
- **Section sizes are estimates** from `tokenx`, not the served model's tokenizer.
- **Why assistant text is 12%.** Replies average 6K characters, far longer than chat replies; it is unclear whether that is long answers, receipts, or text the model wrote before moving it into a file.
