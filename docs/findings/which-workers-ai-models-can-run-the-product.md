# Which Workers AI models can run the product

**Status:** measured 2026-09-06/07 against the Cloudflare Workers AI catalog, GPT 5.6 Luna as the paid control. The verdict is **GLM 5.3 Flash in both seats**, with a reasoning level set. Eligibility rules out most of the catalog before behavior is even scored, and validity checks rule out nothing — the models separate on design and reliability, which only rendering the output shows. Re-running this costs roughly four hours of wall clock and a few million tokens, so the numbers are recorded rather than the method alone.

Companion reading: [the reasoning level was never connected](reasoning-effort-was-never-connected.md) for why every number here would have been different a day earlier, and [a task cannot look at what it drew](a-task-cannot-look-at-what-it-drew.md) for why the self-check numbers below are a floor rather than a measurement.

## The short answer

| Seat | Model | Why |
| --- | --- | --- |
| The conversation | **GLM 5.3 Flash** | Best delegation score in the eligible pool (74%), cheapest per correct turn, and the only free model strong in both seats. |
| Tasks | **GLM 5.3 Flash** | Produces designed documents. The cheaper alternative does not, and the seats stop disagreeing once quality is scored. |
| Second source for tasks | Qwen3.8 27B | Same breadth, but it delivered nothing at all on two of five later briefs. Fallback, not a plan. |
| Paid upgrade | GPT 5.6 Luna, or Muse Spark 1.3 on the contributor tier | 92% delegation, three times faster on task work, and not uniformly better — see the chart below. Muse matched it on deliverables for half the money; it has not been scored as a conversation. |

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

## A second round, on work nobody has seen before

The deliverables above are formats. A later round asked for five things with no memorized answer: an octopus juggling five bowling pins and an axolotl at a sewing machine (both hand-written SVG, replacing the pelican, which every model can recall), a year of CSV sales as a one-page Word memo with the chart embedded in the document, a six-machine shopping comparison whose constraints leave exactly two defensible picks, and a heat-pump explainer with both loop directions drawn and a crossover chart.

| Model | Briefs finished | Checks | Working time | Where it lost |
| --- | --- | --- | --- | --- |
| Muse Spark 1.3 (contributor) | 5 of 5 | 14/14 | 9.3 min | Nothing. Busiest pages of the four. |
| GPT 5.6 Luna | 5 of 5 | 14/14 | 5.1 min | Nothing. Two label collisions. |
| GLM 5.3 Flash | 4 of 5 | 12/14 | 12.8 min | One brief: reasoned the whole drawing out, then emitted eight tokens and no file. |
| Qwen3.8 27B | 3 of 5 | 9/14 | 23.9 min | Two briefs empty; three requests refused. |

Rerun unchanged, Luna and Muse repeated 14/14 and GLM repeated 4 of 5 — but lost a **different** brief, having delivered the one it failed before. So GLM's gap is roughly a one-in-five chance of reasoning a drawing out and emitting nothing, not a brief it cannot do. Qwen fell to 2 of 5.

- **Quality on a finished brief is no longer the differentiator; finishing is.** Every model that produced a file produced a defensible one — correct to the cent on the memo, and all four that got there picked one of the two machines the constraints allow. What separates them is that Luna and Muse always finished and the two Cloudflare models did not.
- **Qwen3.8 27B is cut off at five minutes, by Cloudflare.** Five briefs across two rounds produced nothing, each ending at 300 or 301 seconds with `finishReason=other` and one output token. That looks exactly like the five-minute no-chunk timer in `machines/agent.ts`, and it is not: a direct streaming request to the endpoint returns 10,105 chunks over 300.9s with a longest gap of 31s, and the timer resets on every stream part including reasoning deltas, so it cannot fire. Nor is it an account cap — GLM has run a single generation to 330s on the same key. It is a per-model generation limit, nothing on our side changes it, and it rules Qwen out of any work that reasons past five minutes. Separately it had three requests refused with `Expected string, received array` at `messages[N].content`, the shape a message takes once it carries an image, which is the self-check path.
- **Muse Spark 1.3 on the contributor tier is worth a look as the paid tier.** Same 14/14 as Luna at roughly half the cost, and on the two briefs that reward argument it produced more of it. Slower, and it spends tokens freely. Unscored on the conversation seat.
- **Both new drawing briefs work as tests and the sewing machine is the better one.** Every model that finished the octopus satisfied the counting constraint, so it separates on arrangement rather than comprehension; the sewing machine broke two models outright.

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

## Checking its own work, which was never measurable

The self-check assertion scores whether a task read its deliverable back, and by that measure every model is fine. The number that matters is narrower and it is a column of zeroes: across seventeen finished briefs, real pixels reached the model five times, and not one of those looks changed anything that shipped. The defects that survived are exactly the ones a render catches — an arrowhead over a label, a callout across an axis, a drawing running off its own viewBox — each in a file whose model passed the check.

All of that was ours. Until 2026-09-07 the eval harness answered every browser command with an empty object, so a task trying to open the page it had just written got a CDP deserialization error and nothing else; see [a task cannot look at what it drew](a-task-cannot-look-at-what-it-drew.md). The whole suite was then rerun unchanged with the browser working:

| | Finished briefs | Got real pixels | Changed something after |
| --- | --- | --- | --- |
| Browser broken | 17 | 5 | 0 of 5 |
| Browser working | 16 | 7 | 6 of 7 |

Across three different models, from one seam change and no prompt edit. Muse's next call after seeing its octopus was "Removing overlapping label from SVG"; GLM's after seeing its sewing machine was "Tightening the thread path so it hugs the machine instead of looping wide", then a re-shoot and a verify. Both are the defect class that shipped unnoticed the round before.

Finishing rates did not move, so this buys quality on the briefs a model completes rather than more completions. Two rounds is two rounds; the direction is not subtle.

## What this does not cover

- **Web search and the browser are stubbed in the eval harness.** Research and page-driving are roughly a third of the real corpus and are unscored here. This is where the eligible models are most likely to separate, and where the verdict above is least tested.
- **One to two runs per model per deliverable.** Enough to separate delivers from does-not and to catch the design gap twice; not enough to rank the models that pass.
- **Every visual case was scored with the browser broken.** The models could not open what they wrote, which is the affordance the self-check numbers are about.
- **Long-horizon work.** These deliverables take one to fifteen minutes; the real corpus has tasks running 28 and 41.
- **Kimi K2.6 and K2.7 were not scored on the conversation seat** or on the newer deliverables, at the point where they were ruled out on other grounds.
