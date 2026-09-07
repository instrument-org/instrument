# Which Workers AI models can run the product

**Status:** measured 2026-09-06/07 against the Cloudflare Workers AI catalog, GPT 5.6 Luna as the paid control. The verdict is **GLM 5.3 Flash in both seats**, with a reasoning level set. Eligibility rules out most of the catalog before behavior is even scored, and validity checks rule out nothing — the models separate on design and reliability, which only rendering the output shows. Re-running this costs roughly four hours of wall clock and a few million tokens, so the numbers are recorded rather than the method alone.

Companion reading: [the reasoning level was never connected](reasoning-effort-was-never-connected.md) for why every number here would have been different a day earlier.

## The short answer

| Seat | Model | Why |
| --- | --- | --- |
| The conversation | **GLM 5.3 Flash** | Best delegation score in the eligible pool (74%), cheapest per correct turn, and the only free model strong in both seats. |
| Tasks | **GLM 5.3 Flash** | Produces designed documents. The cheaper alternative does not, and the seats stop disagreeing once quality is scored. |
| Second source for tasks | Qwen3.8 27B | Same breadth, 60% slower, design is inconsistent between runs. |
| Paid upgrade | GPT 5.6 Luna | 92% delegation, three times faster on task work, and not uniformly better — see the chart below. |

## Eligibility cuts 27 models to 6

If a model must take an image and call tools to hold any seat, the catalog answers most of the question:

- **27** text-generation models
- **7** take an image
- **6** of those also call tools
- **5** of those six deliver a real document

The six: `glm-5.3-flash`, `qwen3.8-27b`, `kimi-k2.7-code`, `kimi-k2.6`, `gemma-4-26b-a4b-it`, `llama-4-scout-17b-16e-instruct`.

Two things that cost time to rediscover:

- **DeepSeek V4 Flash is text-only.** It scores 86% as a conversation, second only to Luna, and it cannot be a worker. The orchestrator's composer submits `files` and `message.create` accepts them, so a user can paste a screenshot into the top-level chat — which rules it out of that seat too unless "the agent says it cannot see your screenshot" is acceptable.
- **`llama-3.2-11b-vision-instruct` answers 403** until someone submits the literal prompt `agree` to accept Meta's community license. It also has no tool support, so it is out regardless.

All six genuinely read an image; the catalog's claim held in every case. Note that `kimi-k2.6` and `gemma-4` need roughly 2000 `max_tokens` before an image answer appears at all — reasoning consumes the budget first and the content comes back empty, which reads as blindness and is not.

## The conversation seat

Scored over 1,836 streamed first turns against the real orchestrator system prompt and its four real tool definitions, on nine scenarios taken from an actual orchestrator transcript. "Right" is the share of the six contested delegation scenarios where the first turn started the tasks the ask implied.

| Model | Right | Speaks before acting | $/1k turns | $/1k correct |
| --- | --- | --- | --- | --- |
| GPT 5.6 Luna | 93% | 100% | $1.60 | $1.71 |
| DeepSeek V4 Flash | 86% | 100% | $3.63 | $4.22 |
| GLM 5.3 Flash | 74% | 92% | $1.18 | $1.61 |
| Qwen3.8 27B | 70% | 100% | $5.62 | $7.99 |
| Qwen3 30B A3B | 68% | 100% | $0.59 | $0.86 |
| GLM 5.3 | 67% | 85% | $10.97 | $16.46 |
| Kimi K2.7 Code | 49% | 52% | $7.54 | $15.52 |
| Gemma 4 26B | 47% | 100% | $0.72 | $1.52 |
| Nemotron 3 120B | 40% | 100% | $4.14 | $10.28 |
| Llama 3.3 70B | 19% | **0%** | $2.02 | $10.41 |
| GLM 5.2 · GPT OSS 120B | 3% | 94% · **4%** | — | — |
| GLM 4.7 Flash · GPT OSS 20B · Llama 4 Scout · Granite 4.0 | 0% | — | — | — |

Three findings worth keeping:

- **Normalizing by hit rate collapses the price gap.** Luna costs $1.71 per thousand correct first turns against GLM 5.3 Flash's $1.61. Per token the free model looks four times cheaper; per unit of work that lands it is a rounding error, because the wrong answers are paid for too. Which pool the money comes from decides this, not the price.
- **The failure is one-directional.** Not one run in 1,805 started a task for "hey" or for a folder question. Nothing over-delegates, so a prompt can push harder toward handing off without risking the opposite failure.
- **The second failure mode is silence, not eagerness.** Llama 3.3 70B answers "hey" by running a shell command and saying nothing, 108 times out of 108. Granite does it 107 times. Seven models look up a folder correctly and never tell the user the number. A model at 0% in the "speaks" column is unusable for a conversation whatever else it scores.

## The worker seat

Six deliverables, scored on disk rather than in the transcript: a Word document, a spreadsheet with working formulas, a five-slide deck, a bar chart PNG, a single-file HTML page, and a data report over a 48-row CSV whose totals are known exactly.

| Model | docx | xlsx | pptx | chart | html | data | Checked own work | Time |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GLM 5.3 Flash | ok | **loop** | designed | ok | ok | exact | 4/6 | 15.2 min |
| GPT 5.6 Luna | ok | ok | designed | mangled type | ok | exact | 6/6 | 5.0 min |
| Qwen3.8 27B | ok | ok | **default** | ok | ok | exact | 6/6 | 12.7 min |
| Gemma 4 26B | ok | ok | **default** | — | — | — | 3/3 | 1.8 min |
| Kimi K2.7 / K2.6 | ok | ok | designed | — | — | — | — | 1.7 / 2.1 min |
| Llama 4 Scout | **none** | **none** | **none** | — | — | — | 0/3 | 0.2 min |

**Validity separates nothing; design separates everything.** Every eligible model writes a `.pptx` that opens. Gemma 4 26B's is python-pptx's untouched default — white, centered Times, two shapes a slide, no colors, no background — at `low`, `medium` and `high` alike, so it is not an effort problem. GLM, Qwen and Luna all produce something with a background, a palette and a layout. The structural gate that catches this (a background on every slide, three colors, three shapes a slide) puts the default at 0/0/2.0 and everything else at 4.0 and above, with nothing near the line. It is `deckWasDesigned` in `packages/workspace/evals/cases/worker.ts`.

The same model can be good in one format and useless in another: Gemma's **Word** document is well structured, with a rule under the title, blue headings and bold-led bullets. Judge per format.

**Effort changes richness, not competence.** GLM at `low` still produces an intentional slide — accent bar, colored title — but sparser, and drops under the shape threshold. Gemma is byte-identical in character at every level. So the level is worth exposing, and it will not rescue a model that does not reach for design.

**Frontier is not uniformly better.** Asked for a bar chart, Luna picked a font the sandbox does not have and matplotlib substituted glyphs badly: the title renders "Units shipped By quarter" with corrupted letters and the caption's "Source: provided data" loses letters. GLM's chart is clean, labeled, with the best bar highlighted. Luna's self-check assertion passed on that run — it opened the PNG and shipped it anyway, which is the limit of that check: it detects that a model looked, not that it judged.

## Reliability, which is where GLM actually costs you

- **A degenerate repetition loop.** Twice in 233 GLM sessions (~1%), and not observed in 54 Luna sessions or 24 Qwen sessions — denominators too small to call it GLM-specific, but real. One instance emitted 85,739 characters over 490 seconds; another spent 686 seconds and 32,000 output tokens repeating "I need to load the spreadsheet skill first" and produced no file. It accounts for most of GLM's 15.2 minutes above. The token cap cannot see it, because usage only lands when an assistant message is saved and these are aborted, so the wall-clock cap is the only thing that ends it.
- **The orchestrator catches it.** In a captured run the conversation ignored the first overdue wake, then on the second read the task's log, stopped it, started a fresh one, and told the user why. The 4-minute overdue clock is the mitigation and it works.
- **A malformed tool call used to kill the whole task.** GLM sometimes emits a tool call with the command in the function *name* (`bash|command|cat > file`, `python work/build.py</arg_value>`) and non-object arguments. The call is then stored, and every later request replaying it is answered `Assistant tool call function.arguments must be a JSON object`, 400 — one task failed that way twelve consecutive times and could never take another turn. Fixed in `repairRequestInit`; a malformed call now costs a step.
- **Reaching for tools that do not exist.** GLM spends two to four calls a run on a tool literally named `task` or `open`; Luna never does. Giving it a real `task` tool removed those and produced no measurable gain (24/28 assertions on the shell arm against 20/28 on the tool arm), moving the failure to malformed structured arguments instead. It ships behind `INSTRUMENT_TASK_TOOL=1`, off.

## Reasoning levels are per model, and a wrong one is fatal

Cloudflare says whether a model reasons and never at what levels. Measured across the sixteen tool-calling models: `low` and `medium` accepted by all sixteen, `high` by fifteen, `minimal` by seven. A level a model refuses is a 400 that ends the turn, so the capability published in `parse-workers-ai-models.ts` is the measured set, with `qwen3.8-27b` carrying a named exception (it wants `xhigh`).

For GLM 5.3 Flash specifically, over ~114 first turns per level, seconds to the first token a user can read:

| Level | Median | p90 | Reasoning chars | Right first move |
| --- | --- | --- | --- | --- |
| none | 22.8 | 61.7 | 2,824 | 83% |
| low | 1.6 | 4.8 | 102 | 56% |
| medium | 17.0 | 77.4 | 2,010 | 81% |
| high | **4.9** | **8.3** | 765 | 72% |

`low` is the dramatic number and the wrong default. `medium` behaves like sending nothing. `high` is the setting, and it is what the catalog now declares as the Workers AI default.

## What this does not cover

- **Web search and the browser are stubbed in the eval harness.** Research and page-driving are roughly a third of the real corpus and are unscored here. This is where the eligible models are most likely to separate, and where the verdict above is least tested.
- **One to two runs per model per deliverable.** Enough to separate delivers from does-not and to catch the design gap twice; not enough to rank the models that pass.
- **Long-horizon work.** These deliverables take one to fifteen minutes; the real corpus has tasks running 28 and 41.
- **Kimi K2.6 and K2.7 were not scored on the conversation seat** or on the newer deliverables, at the point where they were ruled out on other grounds.
