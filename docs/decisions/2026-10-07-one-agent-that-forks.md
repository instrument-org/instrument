# The chat and its tasks are one agent that does quick work itself and forks the rest

Date: 2026-10-07

## Context

A chat ran its own agent, which did one-step work and handed everything else to a task agent through a brief: `task new` with a written prompt, a fresh work folder of its own, and flags to hand it folders, files, apps, and tabs (`--fresh`, `--folder`, `--file`, `--app`). The chat's shell was read-only and refused work it was meant to delegate. Two prompts, two shells, and a brief between them meant every non-trivial ask paid for a hand-off, and the task started without the conversation that explained it.

The question was whether one agent that does the work itself, and forks a copy of itself for slow work, could match or beat that split on pass rate while answering faster and spending fewer tokens, across the models we ship.

## Options weighed

The eval matrix ran the hand-off cases (small asks, context, ambiguity, deliverables, research, background work, a mid-job question) as arms of one suite:

| Arm | Design |
| --- | --- |
| a | The chat that briefs a task agent |
| b, v | Round-one variants that gave the task the user's words instead of a brief |
| c | One agent that does quick work and forks slow work, its prompt spliced from the chat's and the task's |
| d | One agent with no background work at all |
| e | The chat that briefs, with tasks also given the chat's background (task context) |
| f | c with fork on interrupt: when the user writes mid-turn, the harness forks the turn's work to the background |
| g | One agent whose only tasks are forks working in the chat's folder, with its own prompt and fork on interrupt |
| h | g with the forks worded as "background" work |

Then, on g, ways to get one line to the user before the first tool call:

| Arm | Design |
| --- | --- |
| g-off | Tools off on the first step of a turn |
| g-say | A `say` field on every tool |
| g-nudge | A note after the first tool results |
| g-pre | A preamble in the prompt |
| g-note | A hidden note on the first step of each turn the user typed, never stored |

## Decision

g, with g-note. The chat's agent is `instrumentAgent` (`packages/workspace/src/agents/instrument.ts`, named `instrument`). It does quick work itself with every tool: bash, files, the browser in tabs the chat holds, web search, skills, apps. `task new --name '<title>' [--tab <id>]` forks it: a task record under the chat whose settings carry `fork: true` and the chat's id as `workdir`, which inherits the chat's conversation (copied messages marked `inherited`) and works in the chat's folder (`lib/work-dir.ts`), with the chat's folders at the same paths. The `task` command keeps only `new`, `send`, `stop`, `list`, `show`, `log`, and `folder`.

Alongside it:

- Fork on interrupt (`lib/fork-on-interrupt.ts`) is always on for chats.
- Every tool call carries `activity`, a short heading for the phase of work, beside `explanation` (`tools/base.ts`).
- The first step of each turn the user typed carries `TURN_NOTE` (`lib/turn-note.ts`): one sentence to the user before any tool, then quiet until the outcome. It is placed after the cache breakpoints for that one request and never stored. Forks get none.

There is no flag, mode, or environment switch for any of it. Older records keep working: a stored baseline naming `main` or `instrument-one` is rebuilt under this agent, and a briefed task keeps its own folder, mounted read-only in its chat at `/tasks/<id>`.

## Evidence

Pass is runs where every assertion passed, out of runs with no failed model request. Times are medians in seconds from each round's `report.md`; tokens are per-run medians over every agent in the run, from `matrix.json`. "Small done" is the median finish time of the small asks; "first text" is time to the first visible text.

### Round 2: GLM 5.3 Flash on Workers AI, 20 cases, 3 trials, 240 runs

| Arm | Pass | Small done | First text (median / worst) | Median tokens | Responsiveness pass |
| --- | --- | --- | --- | --- | --- |
| a | 53/58 | 40.9 | 3.0 / 42.4 | 188,634 | 3/3 |
| c | 52/59 | 29.0 | 3.3 / 70.4 | 116,666 | 0/3 |
| d | 50/57 | 29.6 | 2.6 / 49.8 | 96,652 | 1/3 |
| e | 56/59 | 62.5 | 3.8 / 509.7 | 173,542 | 3/3 |

One agent answered small asks about 12 seconds sooner than the briefing chat for about two thirds of the tokens, but c and d did the long job in the foreground and failed the responsiveness case (the job is 200 replies with a question asked partway). Task context (e) was slowest on small asks and once took 509.7 seconds to show any text.

### Round 3: GLM 5.3 Flash (3 trials, 240 runs) and gpt-5.6-luna through OpenRouter (2 trials, 200 runs), 20 cases

| Arm | GLM pass | GLM small done | GLM worst first text | GLM responsiveness | Luna pass | Luna small done | Luna responsiveness |
| --- | --- | --- | --- | --- | --- | --- | --- |
| a | 52/60 | 71.4 | 68.8 | 1/3 | 37/39 | 26.6 | 2/2 |
| c | 54/59 | 35.0 | 85.3 | 1/3 | 37/40 | 13.8 | 2/2 |
| d | | | | | 36/40 | 14.1 | 0/2 |
| e | 54/60 | 64.9 | 113.8 | 1/3 | 36/40 | 21.0 | 2/2 |
| f | 54/60 | 40.5 | 30.6 | 3/3 | 38/40 | 13.6 | 2/2 |

Fork on interrupt (f) was the only arm to pass responsiveness 3/3 on GLM, with the lowest worst-case first text (30.6 seconds against 68.8 to 113.8). On Luna, one agent halved small-ask time against the briefing chat (13.6 to 14.1 against 26.6). d failed responsiveness again (0/2). e had the only refused `task` calls on GLM (2 of 60 runs).

### Round 4: gpt-6-luna through OpenRouter, 20 cases, 2 trials, 120 runs

| Arm | Pass | Small done | First text (median / worst) | Median tokens | Tasks started |
| --- | --- | --- | --- | --- | --- |
| a | 36/40 | 28.6 | 2.4 / 8.0 | 172,617 | 42 |
| c | 40/40 | 21.3 | 3.1 / 4.6 | 152,656 | 10 |
| f | 39/40 | 19.4 | 2.8 / 11.6 | 156,212 | 12 |

The briefing chat lost on pass rate for the first time: deliverables 5/8 against 8/8 (c) and 7/8 (f).

### Round 5: gpt-6-luna through OpenRouter, 23 cases, 2 trials, 230 runs

| Arm | Pass | Small done | First text (median / worst) | Median tokens | Responsiveness quick answer s | Interrupt-foreground pass |
| --- | --- | --- | --- | --- | --- | --- |
| a | 44/46 | 26.6 | 2.7 / 7.3 | 170,012 | 1.2, 1.9 | 2/2 |
| c | 45/46 | 18.2 | 3.1 / 6.5 | 151,952 | 1.4, 1.2 | 1/2 |
| f | 46/46 | 19.6 | 2.7 / 8.2 | 183,663 | 1.5, 3.4 | 2/2 |
| g | 46/46 | 18.8 | 2.5 / 7.0 | 128,736 | 1.4, 1.4 | 2/2 |
| h | 45/46 | 18.1 | 2.6 / 6.8 | 141,934 | 3.2, 2.9 | 2/2 |

g passed every run at the lowest token median of any arm. Its own prompt beat the spliced one (c) on tokens and on the interrupt case; the "background" wording (h) bought nothing. A second g/h run (92 runs) repeated it: g 46/46, h 45/46.

### Round 6: claude-haiku-5.5 through OpenRouter, 23 cases, 2 trials, 92 runs

| Arm | Pass | Small done | First text (median / worst) | Median tokens | Interrupt-foreground pass | Refused shell calls |
| --- | --- | --- | --- | --- | --- | --- |
| a | 41/46 | 21.4 | 3.9 / 18.6 | 219,918 | 0/2 | 28 |
| g | 44/46 | 8.9 | 7.1 / 37.2 | 142,568 | 2/2 | 13 |

On a second model family g held up: more passes, small asks in less than half the time, about two thirds of the tokens. The one regression was first text: Haiku doing the work itself went straight to tools and said nothing until it was done, which is what rounds 7 to 9 worked on.

### Rounds 7 and 8: claude-haiku-5.5 and gpt-6-luna through OpenRouter, 6 cases, 1 trial

"Text first" is the first turns of tool-using cases that wrote a line before the first tool call.

| Round | Arm | Haiku pass | Haiku text first | Haiku first text | Luna pass | Luna small done |
| --- | --- | --- | --- | --- | --- | --- |
| 7 | g | 6/6 | 1/4 | 2.9 | 5/6 | 13.0 |
| 7 | g-off | 4/6 | 4/4 | 1.6 | 6/6 | 14.5 |
| 7 | g-nudge | 6/6 | 1/4 | 2.5 | 6/6 | 10.7 |
| 7 | g-say | 6/6 | 4/4 | 1.6 | 6/6 | 12.3 |
| 8 | g | 6/6 | 1/4 | 3.1 | 6/6 | 18.8 |
| 8 | g-pre | 6/6 | 4/4 | 1.5 | 6/6 | 24.7 |
| 8 | g-note | 6/6 | 4/4 | 1.6 | 6/6 | 14.9 |
| 8 | g-say | 6/6 | 4/4 | 1.5 | 6/6 | 20.2 |

g-nudge did not move Haiku (1/4, as plain g). g-off got the line but split no-tool answers into several text parts on Haiku (4 of 11 turns) and failed 2 of 6. g-pre, g-note, and g-say all got the line on these smoke cases; g-say and g-note went on to the full run.

### Round 9: claude-haiku-5.5 and gpt-6-luna through OpenRouter, 23 cases, 3 trials per case per model, 414 runs

| Arm | Model | Pass | Small done | First text (median / worst) | Text first: first turns / later turns | Tool-using turns with more than 2 visible messages | Median tokens |
| --- | --- | --- | --- | --- | --- | --- | --- |
| g | Haiku | 68/69 | 11.3 | 6.8 / 41.4 | 4/61 / 7/64 | 1/125 (1%) | 169,218 |
| g-say | Haiku | 67/69 | 10.0 | 1.6 / 3.1 | 60/60 / 12/61 | 31/121 (26%) | 179,172 |
| g-note | Haiku | 69/69 | 10.1 | 1.7 / 15.7 | 55/60 / 63/66 | 12/126 (10%) | 145,068 |
| g | Luna | 66/69 | 18.6 | 2.6 / 50.3 | 57/60 / 61/61 | 6/121 (5%) | 135,563 |
| g-say | Luna | 67/69 | 15.1 | 2.3 / 6.7 | 60/60 / 59/60 | 5/120 (4%) | 134,685 |
| g-note | Luna | 68/69 | 19.8 | 2.6 / 5.7 | 60/60 / 60/60 | 7/120 (6%) | 139,974 |

The median tool-using turn showed 2 visible messages in every cell but plain g on Haiku (1). The quick answer in the responsiveness case came in 1.1 to 2.6 seconds in every cell, and no arm had a refused `task` call.

g-note had the most passes on both models (137/138), and on Haiku took first text from 6.8 seconds to 1.7, with the worst case from 41.4 to 15.7. g-say got the opening line on every first turn but lost it on later turns on Haiku (12/61) and produced more than two messages in a quarter of Haiku's tool-using turns, while adding a field to every tool. g-note did that at the lowest Haiku token median of the three.

## Why

- **Speed on the asks people make most.** In every round and on every model, one agent finished small asks sooner than the chat that briefs: 29.0 against 40.9 (round 2, GLM), 13.8 against 26.6 (round 3, Luna 5.6), 18.8 against 26.6 (round 5, Luna 6), 8.9 against 21.4 (round 6, Haiku).
- **No loss of quality, and fewer tokens.** g passed 46/46 on Luna 6 (round 5) and 44/46 on Haiku (round 6) against 44/46 and 41/46 for the briefing chat, at 128,736 and 142,568 median tokens against 170,012 and 219,918. A fork inherits the conversation rather than a brief, so it starts from what the user said and from a prefix the provider has already cached.
- **Background work still matters.** The arm with none (d) failed the responsiveness case in rounds 2 and 3; fork on interrupt fixed it on GLM (f, 3/3 against 1/3), so it is always on.
- **One prompt, not two.** g's own prompt matched or beat the spliced prompt (c) at fewer tokens, and with no briefed tasks there is no second agent, second shell, or read-only chat shell to keep in step.
- **The first line.** Doing the work itself made Haiku silent until done (round 6). The per-turn note fixed that on both models without a field on every tool and without storing anything, and the `activity` heading on every call gives the UI something to show while the work runs.

## Rejected

- **a, the chat that briefs a task agent.** Slower small asks in every round, more tokens, more tasks started (42 against 10 to 12 in round 4), lower pass rate on gpt-6-luna (36/40 in round 4) and Haiku (41/46 in round 6), and 0/2 on Haiku's interrupt-foreground case.
- **b and v, the task given the user's words.** Dropped after round one, whose report is not among those summarized here; the later rounds compare the remaining designs.
- **c, the spliced prompt.** Superseded by g, which matched its pass rate at fewer tokens with one prompt written for the one agent (round 5: 128,736 against 151,952).
- **d, no background.** Lowest tokens, but failed responsiveness (round 2, 1/3; round 3 Luna, 0/2).
- **e, briefed tasks given the chat's background.** Kept the hand-off cost and added to it: slowest small asks on GLM (62.5 and 64.9) and the worst first text measured (509.7 seconds, round 2).
- **f as its own arm.** Folded into g: fork on interrupt is part of the decision rather than a variant.
- **h, "background" wording.** No measurable difference from g (round 5: 45/46 against 46/46, small done 18.1 against 18.8).
- **g-off, tools off on the first step.** Split plain answers into several text parts on Haiku and lost 2 of 6 runs (round 7).
- **g-nudge, a note after the first tool results.** Too late to change Haiku's first turn (1/4, round 7).
- **g-pre, a prompt preamble.** Got the line on the smoke cases but had the slowest Luna small asks of round 8 (24.7) and was not carried to round 9; a prompt rule is read with everything else rather than where the turn starts.
- **g-say, a `say` field on every tool.** Lost the line on later Haiku turns (12/61) and showed more than two messages in 26% of Haiku's tool-using turns (round 9), for a field on every tool definition.
- **Keeping the designs behind flags.** The evals decided, and a flag keeps two prompts and two shells alive.

## What would change it

- A model we ship that fails the hand-off cases as one agent where the briefing chat passed them would reopen briefed tasks for that model.
- If forks inheriting the whole conversation start to cost more than briefs on long chats, compaction or a trimmed inheritance comes before a return to briefs.

## Final check

The same hand-off suite ran on the shipped code, with the other designs deleted: 23 cases, 1 trial per case per model, gpt-6-luna and claude-haiku-5.5 through OpenRouter, 46 runs, against round 9's g-note.

| Model | Round | Pass | Small done | Median done | First text (median / worst) | Text first: first turns / later turns | Tool-using turns with more than 2 visible messages | Median visible messages per tool-using turn | Median tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Haiku | 9, g-note | 69/69 | 10.1 | 16.9 | 1.7 / 15.7 | 55/60 / 63/66 | 12/126 (10%) | 2 | 145,068 |
| Haiku | 10 | 22/23 | 10.4 | 17.2 | 1.8 / 8.1 | 19/20 / 23/23 | 11/43 (26%) | 2 | 163,493 |
| Luna | 9, g-note | 68/69 | 19.8 | 28.8 | 2.6 / 5.7 | 60/60 / 60/60 | 7/120 (6%) | 2 | 139,974 |
| Luna | 10 | 22/23 | 15.4 | 34.7 | 2.5 / 6.3 | 20/20 / 20/20 | 1/40 (3%) | 2 | 140,782 |

The quick answer in the responsiveness case came in 1.3 (Haiku) and 1.4 seconds (Luna), the interrupted foreground job answered in 0.9 and 1.4 seconds with its work forked, and no run had a refused `task` call. The two failures were Haiku's weather page (temperatures the check could not match to the data it retrieved) and Luna's pdfs (it summarized older PDFs, the case it also lost once in round 9).

Haiku's share of chatty turns (26%) came from a handful of cases, so those cases (weather, long-work, guide, document, dictation) ran again with 2 trials each: 10/10 passed, and 4 of 38 tool-using turns (11%) showed more than two messages, in line with round 9. Luna's pdfs passed 1 of 2 more runs. Nothing regressed beyond the noise of single trials.
