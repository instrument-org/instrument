---
name: workspace-evals
description: Run, write, or read Instrument agent evals (`pnpm eval`) against real models, including chat evals that hand work to tasks. Use once an eval is the chosen check (the validate-changes skill decides that), or when adding a case under packages/workspace/evals/cases/ or reading eval-results.local.
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

The ChatGPT account, the provider most users sign in with and the cheapest one to test real models on, is configured from `APP_CHATGPT_ACCOUNT_TOKEN`. `pnpm --silent script:chatgpt-account-token` prints the token of the first account signed in to the installed app (`--email <address>` for another, `--dev` for a dev build's), so a run is `APP_CHATGPT_ACCOUNT_TOKEN=$(pnpm --silent script:chatgpt-account-token) pnpm eval run --model 'openai/gpt-5.6-sol?provider=chatgpt-account&providerConfigId=chatgpt-account' ...`. Evals name that config `chatgpt-account`; the app gives each account an id of its own, so a model URI copied from a real transcript needs its `providerConfigId` swapped. The token lasts about an hour and only the app renews it, so it does not belong in `.env`; the same token works for direct requests to `https://api.openai.com/v1/responses` with `store: false` and `stream: true`.

`run` and `report` exit non-zero when an assertion failed or a model request was refused, so a failed suite is visible without reading the output. `--json` prints the whole report as one line on stdout with all narration on stderr; the same payload is always written to `summary.json` in the results directory, which is the more reliable thing to script against. Color is emitted only to a terminal, so a piped run needs no escape-stripping.

A run stops itself at `--max-run-cost` ($2, its model requests and searches together) or `--max-run-seconds` (1800). `--max-run-tokens` caps tokens when given; without it, a 1M-token cap applies only to a run whose cost cannot be read, such as a Workers AI model, since an agent's tokens are mostly cheap cache reads. Each takes `0` to disable. Neither is a failure and both are reported apart from one: a stopped run is `Stopped`, only a refused request is `Failed`. The seconds cap is one deadline for the whole run rather than one per wait, so a case with follow-ups cannot quietly take three times the number you set.

Every run gets a home directory of its own under `$TMPDIR`, or wherever `INSTRUMENT_EVAL_HOME` points (`evals/lib/sandbox-home.ts`). This is not optional tidiness: every chat reaches the user's real home and their real `~/Documents/Instrument` without being sent either, and every task it starts reaches the same folders, so an unsandboxed suite is several agents at once holding read-write on your actual files. Both folders derive from one `$HOME` for the whole process, so chat cases want `--concurrency 1` and a separate process per model when two runs must not see each other's output.

A computer with room off its boot disk names a folder there as `INSTRUMENT_EVAL_TMPDIR` in its own `packages/workspace/.env` (`evals/lib/eval-tmpdir.ts`), and every run's temp folder, home and workspace go there. The folder has to exist: when its drive is not mounted, the run says so and uses the system's temp folder.

## Choosing models

**There is no default model set, and `--model` is required.** A list of models living in a source file is one nobody re-reads: it goes stale as providers ship, and it answers whatever question it was written for rather than the one being asked now. A default is also what an unattended agent takes, which is how a change ends up validated against models chosen by whoever last edited a constant. `pnpm eval models [pattern]` asks the configured providers what they can run today, newest first, with each row spelled the way `--model` takes it.

So the choice is yours to make per question, and yours to report: **say which models you ran and why you picked them**, in the same breath as the result. A result that does not name its models is not a result anyone can weigh.

**Workers AI is where to start.** It runs without `--paid` and every other provider is metered, so a run that spends belongs to a question that specifically needs a model only another provider has. A metered model is refused without `--paid`, because the cost of a suite is one case times one model list and lands long after the command that started it. `zai-org/glm-5.3-flash` is the model this project is usually tested against, named in the error a bare `run` produces; it is a hint rather than a default, and nothing runs it unless someone passes it.

**A Claude model runs through the Claude account, never through OpenRouter.** Point `APP_CLAUDE_CODE_PATH` at a signed-in Claude Code and name the model on that provider: `APP_CLAUDE_CODE_PATH=$HOME/.local/bin/claude pnpm eval run <cases> --model 'anthropic/claude-sonnet-5.5?provider=claude-account&providerConfigId=claude-account' --paid`. That runs on the signed-in plan, through the same harness the app uses. Without the variable there is no `claude-account` config, and the run stops with `Provider config for claude-account not found`. Claude Code keeps what each run did outside the eval home: transcripts in a folder under `~/.claude/projects/` named for the eval home, and resume records in `~/.claude/instrument-sessions/`. The run deletes both once its report is written (`evals/lib/claude-account-leftovers.ts`); a run killed before then leaves them.

The harness prints what each model resolved to and records it as `resolvedModelId` in the run's `eval-case.json`, which matters for a `--paid` run against an OpenRouter `~author/<name>-latest` alias, since "latest" is not a build anyone can identify a month later.

## Results

Results land in `eval-results.local/<timestamp>/<case>/<model>/` as `session.md` (the rendered transcript), `stats.json`, `errors.json`, `assertions.json`, and `eval-case.json`, with copies of the chat's records (`record/`), its work folder (`task/`) and its own folder under `Chats/` (`chat-folder/`). Case and model name the path and every printed line, because a seven-model run is otherwise twenty-one directories distinguished by a numeric suffix. Each run's cost says where it came from: `billed` is what the provider's responses reported charging (OpenRouter's `usage.raw`, with the upstream charge when the key is the person's own), `estimate` is the catalog price on tokens for a step that reported nothing, and searches are a separate estimate (`searchCostUSD`). A step stopped before its usage arrived is counted as unmetered rather than priced at zero.

A run of more than one case or model, or with `--repeat <n>`, runs each case of each trial on each model in a process of its own, with its own home and workspace, so no run sees the files or memories another saved. Each writes to `trial-<n>/<case>/` in the run's directory (`trial-<n>/<case>/<model>/` when the run names more than one model), and the run's `summary.json` holds every result, each with its `trial`, plus each case's min, median and max cost and tokens across trials under `spread`.

`summary.json` carries a `provenance` block so a directory can still say what it measured months later: the commit and branch, whether tracked files differed from it, and the sha256 of the system prompt each task was actually scored against (also per task, in `eval-case.json`). The dirty flag is the one to read, because measuring a prompt edit before committing it is the ordinary way a change gets scored. More than one digest in a run means the session context was rebuilt part way through and the tasks were not all scored against the same prompt. `report` omits the commit, which would describe the checkout re-scoring rather than the one that ran; the digest comes from the sessions and survives.

The workspace a run used is a temp directory of about 600 MB, most of it the runtime the app builds there, so a run removes it once its results are written. `--keep-workspace` keeps it, and a run that fails before its results are copied keeps it too; either way the run prints its path. Scoring again with `report <dir>` needs that workspace, since assertions read the app's state, the chat's folders and the run's home as the run left them, so keep it when you expect to rescore, and even then it lasts only until the OS reaps it or the storage format moves past it. What lasts is `eval-results.local`. Before each case starts, the run waits while the disk holding the temp folder has under 20 GB free, rechecking every 30 seconds, and fails after 30 minutes. Each run records its case, model, trial, session and home in that workspace when it starts (`evals/lib/run-record.ts`), and `report <dir>` reads them back, so it scores a past run against the same session and the same home the run had, whatever the app has titled the chat since.

## Chat evals

`kind: "chat"` (or `--chat` with `--prompt`) runs a case through the agent the user talks to, which does quick work itself and hands the rest to tasks with `instrument task new`, each a child session in the chat's records. Write assertions that pass either way: score what landed and what the user was told, reading the chat's own session beside its tasks'. These things differ from an ordinary case:

- The run is not over when the conversation's turn ends. If it started tasks, they are still running and the wake that carries their results back is 1.5s behind them. The harness waits for the whole tree to go quiet, so `usage` is the conversation alone and `treeUsage` is what the run actually cost.
- The harness makes the `~/Documents/Instrument` output folder the way `window.ensure` does in the app, and the chat reaches it and the home folder without being sent either. Without them it cannot read back what its own tasks wrote: measured, that is ten tool calls and 240K tokens hunting a file, against two and 96K when it can see it.
- Assertions get `childSessions()` alongside `sessions`, because the work being scored may have happened in a task rather than in the conversation.
- `finishesAs` stands in for the tasks when only the conversation's reply to a finish is being scored: each task it starts is stopped once the first turn settles, and the conversation is woken through the real wake path with the receipt and the window tabs the case scripts. It is also the only way a finish note names a window tab, since a run's tasks browse in a Chrome of their own.

`packages/workspace/scripts/chat-handoff-report.ts <workspace-dir>` prints what each task handed back and whether the wake note's ceiling cut it, which is the number to watch: a task's last message travels whole up to that ceiling, and everything past it was composed, paid for, and dropped.

`packages/workspace/evals/handoff-matrix.ts` runs the hand-off suite (`evals/cases/handoff.ts`) as a matrix of case, model, and trial, one process and home per run, and writes `matrix.json` and `report.md` with what each cost the user (pass rate, time to the first line and to done, tokens). Its header lists the models it will spend on and how it guards the OpenRouter key.
