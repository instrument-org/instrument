---
name: workspace-evals
description: Run, write, or read Instrument agent evals (`pnpm eval`) against real models, including chat evals that delegate to tasks. Use once an eval is the chosen check (the validate-changes skill decides that), or when adding a case under packages/workspace/evals/cases/ or reading eval-results.local.
---

# Workspace evals

`packages/workspace/evals/` boots the real workspace machine and runs the actual agent loop against real models. `evals/cases/` holds committed cases with assertions; `--prompt` runs a throwaway one.

The harness is the agents' own tool. Nobody runs evals by hand, so it serves whatever check you need next: when a behavior cannot be expressed as a case (a state the run never reaches, a wait it cannot script, an assertion with no helper), change the harness until it can, rather than recording the behavior as untested.

`pnpm eval` also exists at the repo root, so none of these need a `cd` first.

```bash
pnpm eval models [pattern]                        # what the providers can run today
pnpm eval list                                    # committed cases
pnpm eval run [pattern] --model cf:<id>           # run them
pnpm eval run --yes --prompt "..." --model cf:<id> # one ad-hoc case
pnpm eval report <workspace-dir>                  # re-report a past run, at no cost
```

Flags: `--model` (**required** for `run`, repeatable; `cf:<id>` means Workers AI, bare slug means OpenRouter, full model URI pins any configured provider), `--paid` (required before any metered model runs), `--effort` (`none|low|medium|high|max`, recorded on every task the run creates), `--name`, `--repeat`, `--concurrency`, `--dry-run`, `--include-context`, `--json`.

The ChatGPT plan, the provider most users sign in with and the cheapest one to test real models on, is configured from `APP_CHATGPT_PLAN_TOKEN`. `pnpm --silent script:chatgpt-plan-token` prints the token of the first account signed in to the installed app (`--email <address>` for another, `--dev` for a dev build's), so a run is `APP_CHATGPT_PLAN_TOKEN=$(pnpm --silent script:chatgpt-plan-token) pnpm eval run --model 'openai/gpt-5.6-sol?provider=chatgpt&providerConfigId=chatgpt-plan' ...`. Evals name that config `chatgpt-plan`; the app gives each account an id of its own, so a model URI copied from a real transcript needs its `providerConfigId` swapped. The token lasts about an hour and only the app renews it, so it does not belong in `.env`; the same token works for direct requests to `https://api.openai.com/v1/responses` with `store: false` and `stream: true`.

`run` and `report` exit non-zero when an assertion failed or a model request was refused, so a failed suite is visible without reading the output. `--json` prints the whole report as one line on stdout with all narration on stderr; the same payload is always written to `summary.json` in the results directory, which is the more reliable thing to script against. Color is emitted only to a terminal, so a piped run needs no escape-stripping.

A run stops itself at `--max-run-tokens` (1M) or `--max-run-seconds` (1800), both of which take `0` to disable. Neither is a failure and both are reported apart from one: a stopped run is `Stopped`, only a refused request is `Failed`. The seconds cap is one deadline for the whole run rather than one per wait, so a case with follow-ups cannot quietly take three times the number you set.

Every run gets a home directory of its own under `$TMPDIR`, or wherever `INSTRUMENT_EVAL_HOME` points (`evals/lib/sandbox-home.ts`). This is not optional tidiness: a chat attaches the user's real home and their real `~/Documents/Instrument` to its conversation and hands that workspace folder to every task it starts, so an unsandboxed suite is several agents at once holding read-write on your actual files. Both folders derive from one `$HOME` for the whole process, so chat cases want `--concurrency 1` and a separate process per model when two runs must not see each other's output.

## Choosing models

**There is no default model set, and `--model` is required.** A list of models living in a source file is one nobody re-reads: it goes stale as providers ship, and it answers whatever question it was written for rather than the one being asked now. A default is also what an unattended agent takes, which is how a change ends up validated against models chosen by whoever last edited a constant. `pnpm eval models [pattern]` asks the configured providers what they can run today, newest first, with each row spelled the way `--model` takes it.

So the choice is yours to make per question, and yours to report: **say which models you ran and why you picked them**, in the same breath as the result. A result that does not name its models is not a result anyone can weigh.

**Workers AI is where to start.** This project has Cloudflare credits sitting unused and pays per token everywhere else, so a run that spends belongs to a question that specifically needs a model only another provider has. A metered model is refused without `--paid`, because the cost of a suite is one case times one model list and lands long after the command that started it. `zai-org/glm-5.3-flash` is the model this project is usually tested against, named in the error a bare `run` produces; it is a hint rather than a default, and nothing runs it unless someone passes it.

The harness prints what each model resolved to and records it as `resolvedModelId` in the run's `eval-case.json`, which matters for a `--paid` run against an OpenRouter `~author/<name>-latest` alias, since "latest" is not a build anyone can identify a month later.

## Results

Results land in `eval-results.local/<timestamp>/<case>/<model>/` as `session.md` (the rendered transcript), `stats.json`, `errors.json`, `assertions.json`, and `eval-case.json`. Case and model name the path and every printed line, because a seven-model run is otherwise twenty-one directories distinguished by a numeric suffix. An approximate cost accompanies each run wherever the model's price is known.

`summary.json` carries a `provenance` block so a directory can still say what it measured months later: the commit and branch, whether tracked files differed from it, and the sha256 of the system prompt each task was actually scored against (also per task, in `eval-case.json`). The dirty flag is the one to read, because measuring a prompt edit before committing it is the ordinary way a change gets scored. More than one digest in a run means the session context was rebuilt part way through and the tasks were not all scored against the same prompt. `report` omits the commit, which would describe the checkout re-scoring rather than the one that ran; the digest comes from the sessions and survives.

The workspace a run used is a temp directory, so `report <dir>` is only good until the OS reaps it or the storage format moves past it. What lasts is `eval-results.local`.

## Chat evals

`kind: "chat"` (or `--chat` with `--prompt`) runs a case through the agent the user talks to, which delegates to tasks of its own. Three things differ from an ordinary case:

- The run is not over when the conversation's turn ends. That is the moment it hands work off; the tasks are still running and the wake that carries their results back is 1.5s behind them. The harness waits for the whole tree to go quiet, so `usage` is the conversation alone and `treeUsage` is what the run actually cost.
- The conversation is created with the two folders `window.ensure` gives it in the app. Without them it cannot read back what its own tasks wrote: measured, that is ten tool calls and 240K tokens hunting a file, against two and 96K when it can see it.
- Assertions get `childSessions()` alongside `sessions`, because the work being scored happened in the tasks rather than in the conversation.
- `finishesAs` stands in for the tasks when only the conversation's reply to a finish is being scored: each task it starts is stopped once the first turn settles, and the conversation is woken through the real wake path with the receipt and the window tabs the case scripts. It is also the only way a finish note names a window tab, since a run's tasks browse in a Chrome of their own.

`packages/workspace/scripts/chat-handoff-report.ts <workspace-dir>` prints what each task handed back and whether the wake note's ceiling cut it, which is the number to watch: a task's last message travels whole up to that ceiling, and everything past it was composed, paid for, and dropped.
