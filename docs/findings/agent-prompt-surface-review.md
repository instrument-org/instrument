# Agent prompt surface: what we measured, and what is still open

**Status:** open items, measured once. The "Open work" section is the live part; "Already correct -- do not regress in a cleanup" is the part to read before editing prompt text. Prompt copy moves faster than this document, so re-read the surface it names before acting.

A review of the text our agent actually reads -- the main system prompt (`packages/workspace/src/agents/main.ts`) and the tool descriptions (`packages/workspace/src/tools/`, plus `lib/create-bash-env.ts`) -- against [Anthropic's "new rules of context engineering for Claude 5 generation models"](https://claude.com/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models), our own recorded sessions, and the equivalent surfaces in other agent harnesses.

This is the prompt-language counterpart to [`agent-tool-surface-review.md`](./agent-tool-surface-review.md), which covered tool *capabilities*.

A first pass removed the lines that were contradictory or untrue regardless of model. This document keeps the parts that outlive that pass: the measurements, and the changes that were deliberately **not** made along with why.

**The constraint that shapes every recommendation:** users pick the model. Cutting text a frontier model does not need can regress a mid-tier one, and we ship to both. So anything that is merely *redundant for frontier models* wants `pnpm eval run --model ...` across tiers before it moves, not a reading of the diff. The [`validate-changes`](../../.agents/skills/validate-changes/SKILL.md) skill is the gate.

## Surface sizes

Static instruction text only -- this excludes the skill catalog rendered into `load_skill`, the bash command list, the image-parameter block, and the per-session context message (`<system_info>`, attached folders, `<task_layout>`).

| surface                  | ~tokens | notes                                            |
| ------------------------ | ------: | ------------------------------------------------ |
| main system prompt       |   ~4700 | 12 top-level sections                            |
| `bash` description       |   ~1040 | plus the full command list, built per call       |
| `read_file` description  |    ~650 | ~200 words of it is the image-`region` technique |
| `generate_image`         |    ~390 | plus per-model parameter block                   |
| `edit_file` description  |    ~370 |                                                  |
| `web_fetch` description  |    ~234 |                                                  |
| `write_file` description |    ~230 |                                                  |
| `web_search` description |    ~177 |                                                  |

## A. What the recorded sessions say

Reasoning about a prompt is cheap; this section reasons from what the model did with it. 5,117 tool calls across 530 tasks in the local dev and production workspaces, 2026-04-15 to 2026-08-01, read out of each task's `.instrument/task.db`. One developer's usage, so treat it as direction rather than a measurement of the user base.

### A1. Where the calls actually go

| tool         | calls | share |
| ------------ | ----: | ----: |
| `bash`       | 2,727 |   53% |
| `read_file`  |   653 |   13% |
| `load_skill` |   393 |    8% |
| `web_search` |   354 |    7% |
| `write_file` |   340 |    7% |
| `edit_file`  |   275 |    5% |

Within `bash`, one command dominates: `agent-browser` is 1,332 calls, 49% of all bash and **26% of every tool call in the corpus**. It is the largest prompt surface in the product, and no review has examined its description yet.

`write_file` and `edit_file` together are 12%. Correctness is not weighted by traffic, so fixing them first was right -- but further *trimming* should aim where the tokens and the attention actually go.

### A2. The no-`cd` rule is correct, and ignored

The system prompt tells the model not to `cd` into a script's folder. It did it anyway, 208 times, and those calls fail differently from the rest:

| calls                    |     n | file-not-found |
| ------------------------ | ----: | -------------: |
| `cd` into a skill folder |   208 |      12 (5.8%) |
| every other bash call    | 2,519 |      40 (1.6%) |

The errors are the ones the rule predicts -- `ENOENT './work/skills/pdf/attachments/...'`, `'./skills/<skill>/user-provided/...'` -- paths resolving inside the skill folder instead of the task root. The rule is load-bearing and must not be cut as "obvious". It is also not working: a 3.6x failure rate the model walks into 208 times is an argument for enforcement or a better error, not for more prompt text.

Caveat on the wording we ship: those 12 are 23% of the 52 file-not-found errors in the corpus, so "the most common cause" is the largest single cause identified here, not a majority.

`../` chains show the same shape -- 7 of 136 calls (5.1%) against 1.7% without one. The model writes them mostly *because* it `cd`'d first (`cd work/skills/sharp-images && tsx scripts/crop.ts ../../../attachments/...`), which is why the two rules belong in one sentence.

### A3. Unenforced absolutes are cheaper than they look

Of 148 tasks that ran `agent-browser`, 147 loaded the `agent-browser` skill before the first call and one never loaded it -- 99.3% compliance, none late. That compliance was already produced by three non-absolute mentions, so the `MUST` was not what was doing the work.

Read-before-edit is the same story: 265 of 275 `edit_file` calls (96.4%) already follow a read or write of the same path, and the 10 that do not are mostly files the agent had just scaffolded. Blind edits hit "oldString not found" at 1 in 10 against 5 in 265 for informed ones -- directionally real, too small to lean on.

### A4. Emoji is not one population

21 of 340 `write_file` calls put emoji in file content, in four distinct groups:

- **The deliverable is the emoji** -- `/skills/smiley/SKILL.md`, `sad-boy`, `random-smiley`. The user asked for exactly this.
- **Functional glyphs** -- `☰` for a menu affordance in a generated wireframe, `✓`/`★` in scripts and style samples. A blanket ban reads on these.
- **The model decorating its own output** -- `🚀 ✅ 🎉` in demo markdown. The only group the rule is for.
- **The user's own emoji passing through** -- `output/release-notes.md` keeping `✨ 🐛 ♻ 📦` from a "give me back markdown for this" conversion.

That last case is why the rule has to separate *adding* emoji from *preserving* it: without the split, one section of the prompt tells the model to strip a user's own content while another requires faithful transcription.

### A5. Visible in the data, not yet acted on

- **`npx` works and is undocumented.** 15 calls, all succeeding, mostly `npx tsx <path>` -- a second route to running TypeScript, and one the bash description's "package management via `pnpm` (`npm` is not available)" implies should not exist.
- **The model still probes with `which`** 14 times, against a description that says `which` lies about specialized commands.
- **Undocumented top-level folders.** `write_file` targets include `scripts/` (24), `tmp/` (6), `src/` (3) alongside `output/` (168) and `work/` (105). Worth knowing before anyone trims the task-layout section on the grounds that the model has internalized it.
- **One task burned 22 consecutive `edit_file` calls** on the same rejected no-op edit (`oldString` equal to `newString`, escaping `&` in an SVG). A single pathological loop rather than a trend, but the description says nothing about what a no-op rejection means, and "try a materially different method" did not fire.

## B. Calibration against comparable harnesses

Measured against other agent harnesses' file and shell tools, including a version-tracked archive of a reference coding agent's prompts.

### B1. We are already in range, and lighter where it counts

Description text only, excluding JSON schema, both columns estimated at the same chars-per-token ratio -- read the ratios, not the absolutes.

| tool  | reference agent |   ours |
| ----- | --------------: | -----: |
| bash  |          ~3,340 | ~1,040 |
| read  |            ~450 |   ~650 |
| edit  |            ~300 |   ~370 |
| write |            ~170 |   ~230 |

System prompts land in the same place: theirs is 4,200-6,300 tokens across current variants, ours ~4,700.

There is no bloat problem to solve. **Our shell description is a third the size of theirs** while carrying 53% of our calls (A1) -- an argument against trimming `bash`, not for it. The file tools run 20-35% heavier, and for `read_file` essentially the whole gap is the image-`region` paragraph (D2).

### B2. Read-before-edit is not the obvious rule it looks like

The instinct is that a Claude 5 model does not need telling to read a file before editing it. The reference agent still ships it in both its edit and write tools, in the strongest form available:

> You must use your `Read` tool at least once in the conversation before editing. **This tool will error if you attempt an edit without reading the file.**

That last clause is the point. Theirs is not an unenforced absolute; it is documentation of a runtime behavior. The resolution they picked is **enforce it and say so**, which is the interface-design shift rather than the deletion shift.

We currently do neither: the line is an imperative, and nothing checks it. With 96.4% compliance already (A3), enforcing or deleting are both cheap; leaving it as exhortation is the option that buys nothing.

### B3. Where the minimalist end gets its wins

The smallest harness in the comparison has a one-sentence write tool:

> Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.

No read-before-write, no emoji rule, no "never create docs", and its edit tool has almost no prose at all. That is not achieved by being braver about deletion. It is achieved by moving the constraints into the parameters: its edit tool takes an `edits[]` array whose item description carries what we spend prose on.

> must be unique in the original file and must not overlap with any other `edits[].oldText` in the same call

**The remaining size gap on our file tools is an interface gap, not an editing-discipline gap** -- which makes the `edits[]` array the next real win, not another pass at the wording.

## C. Unhobbling: the "Automation on the User's Behalf" section

`main.ts`, roughly 280 words in the highest-value position in the whole prompt -- immediately after the role sentence. Its content is entirely anti-refusal and anti-laziness pressure:

> `Your job is to execute their intent, not to gatekeep it.`
> `There is no excerpt budget, character cap, or quota on material the user supplied.`
> `Never quietly substitute a summary, a paraphrase, or a handful of short quotes for the output that was asked for.`

This is the genre the guide calls hobbling-removal: constraints written to fight a *previous* generation's failure modes. Two of the three paragraphs are plausibly deletable for frontier models, and it is the largest single cut available.

It is also the riskiest, and should not be made on the strength of a blog post. The behaviors it targets -- refusing to transcribe a user's own document, silently returning three pages of a twenty-page translation -- are real, user-visible, and worse on mid-tier models. **Run the eval first**, across at least Haiku 4.5, Sonnet 5, and Opus 5, with cases exercising long-document transcription and full-corpus extraction.

The provenance paragraph (`Files in this task came from the user ... Treat them as the user's own working material`) does different and more durable work: it establishes a fact about our product the model cannot infer. That one stays regardless.

## D. Progressive disclosure

We have the mechanism the guide recommends -- skills, with a budgeted catalog rendered into `load_skill`. We under-use it for our own guidance.

### D1. "Scripts and Running Code"

What remains after deduplication is the pnpm monorepo layout and the per-package `node_modules` facts. Every token is paid on every turn, including the many that write no code at all. Moving it into a bundled skill changes *when* the model learns those facts rather than just how often it is told -- but note A2: the no-`cd` rule inside it must stay in the system prompt, because it fires for scripts the agent writes itself, not just skill scripts.

### D2. The `read_file` image-`region` paragraph

~200 words teaching a real technique (re-read a crop at full resolution rather than trusting a first impression of a downscaled image). Good content in an expensive place: every turn pays for it, including the overwhelming majority that never read an image. It is also essentially the entire size gap in B1.

The guide's second shift points at the alternative: make the interface express it rather than explaining it in prose. Return the coordinate-mapping hint in the read result itself (as one comparison harness does with `[Image: original 4000x3000, displayed at 2000x1500. Multiply coordinates by 2.00]`, noted as E4 in the tool-surface review), and let a short description clause plus that hint carry what four sentences carry now.

## E. Interface design over prose

The guide's line is that examples "constrain [models] to a certain exploration space" and that the better lever is tool design: *"what parameters does Claude have and how can they be more expressive?"*

- **`edit_file` cannot batch.** B3 in the tool-surface review, still open, and the largest single win available in the tool surface -- see B3 above for what it buys.
- **`read_file`'s `region`.** The code carries a 15-line comment about one model family sending an all-zero rectangle on every first image read, handled by treating all-zeros as "unset". A good example of the shift: the interface absorbed the failure instead of the prompt arguing against it.

Counter-note in our favor: `toolInputSchemaForLLM`'s forced-required `explanation` (advertised required in JSON Schema, optional in Zod so an omission degrades rather than hard-failing) is textbook interface-design-over-instruction, and no other harness reviewed does it.

## F. Where model-conditional text can and cannot live

This constrains how any "trim for frontier models, keep for others" plan can be built.

**Tool descriptions can be model-conditional today.** `create-tool.ts` passes `{ agentName, model, taskId }` to a `description` function, and `generate_image` already uses it. Descriptions are rebuilt on every request, so they track a mid-session model switch exactly.

**The system prompt cannot.** `agent.getMessages({ sessionId, taskId })` (`agents/types.ts`) is not given the model, and `prepare-model-messages.ts` writes the session-context message once and never rebuilds it. `model` *is* in scope at the call site, so threading it is trivial; the immutability of the baseline is the real obstacle. A model-conditional system prompt would keep serving Opus's trimmed prompt for the rest of a session in which the user switched to Haiku.

So the shape of any tiering work is: thread `model` into `getMessages`, **and** decide what a mid-session model switch does to a baseline that is deliberately never rewritten -- most likely an append-only correction, since rebuilding it would reintroduce the cache invalidation the immutable baseline exists to remove. This is the same reasoning already recorded in the `browserTargetingGuidance` comment, which chose *not* to state volatile facts in session context for exactly this reason.

Absent that work, system-prompt cuts must be safe for the weakest model we ship to -- which makes the eval in C load-bearing rather than a formality.

## Open work

1. **Audit `agent-browser`'s description and skill.** 26% of all tool calls run through it and no pass has looked at it. The obvious next target, ahead of any further trimming of the file tools.
2. **`edits[]` on `edit_file`** (E, B3). The uniqueness rule, the batching note, and the ordering note all collapse into one array parameter plus two schema descriptions.
3. **Settle read-before-edit/write** (B2). Enforce it and document the error, or delete it and let "oldString not found" teach. Not another rewording.
4. **Make the no-`cd` rule land** (A2). Candidates: resolve skill-script paths against the task root regardless of cwd, or a teaching error on ENOENT inside a skill folder that names the task-root path the model meant.
5. **Decide what `npx` is** (A5). Document it or stub it like `npm`.
6. **The "Automation on the User's Behalf" section** (C). Highest token win available and the highest risk; wants the cross-tier eval first.
7. **Relocate what remains of "Scripts and Running Code"** (D1).
8. **Replace the `region` prose with a coordinate hint in the result** (D2).
9. **Thread `model` into `getMessages`** and make the session-context staleness check model-aware (F). Prerequisite for any per-model system prompt.

**Do not** trim `bash` on size grounds (B1), and do not re-cut the no-`cd` or no-`../` rules as redundant -- the bash description has never carried them, and A2 measures what they are worth.

## Already correct -- do not regress in a cleanup

- The `browserTargetingGuidance` split between durable policy (session context) and volatile availability (per-request description).
- Forced-required `explanation`.
- The nonce-bounded untrusted-content preambles on `web_search`, `load_skill`, and `agent_browser` page output. These read as repetition but are a security boundary, not guidance -- see [the decision record](../decisions/2026-07-27-nonce-bounded-untrusted-content.md).
- `write_file`'s "do not re-emit content, use `cp`" rule.
