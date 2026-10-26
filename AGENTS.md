# Instrument Monorepo

pnpm monorepo for the Instrument desktop app platform. The public website is https://tryinstrument.com; the app talks to its API at `api.tryinstrument.com` (`staging.api.` for staging) and fetches updates from `releases.tryinstrument.com`. Neither the website nor the API lives in this repo.

- `apps/studio`: Electron desktop app (main product)
- `packages/workspace`: Core AI agents, workflow logic, and workspace management
- `packages/ai-gateway`: Model proxy (Hono app the workspace server mounts) plus the model discovery/identity library
- `packages/shared`: Types, constants, and utilities used everywhere
- `packages/typescript-config`: Shared tool config

## Product terminology

- The user talks to one agent in a **chat**, the only record, named by its `ChatId` everywhere: code, routes, RPC, events, types, and on-disk layout. A chat holds **sessions**, each a thread of messages and tool calls (`SessionId`): the chat's own conversation is the session with no parent, and a **task** is a session the chat started in the background, with the chat's session as its parent. "Task" is the word for that child session in the agent's `task` command (which names it by a per-chat handle, `t1`) and in the UI, never in storage.
- On disk, what the app keeps in a workspace is in its `.instrument/` (`workspaceLayout`), and the workspace's top level is the person's own. A chat's records live under `.instrument/chats/<id>/`: one append-only log per session per device (`<session>.<device>.jsonl`), a settings file per device (`settings.<device>.jsonl`), a state file per device (`state.<device>.json`), `blobs/`, `attachments/` (what the person sent) and `handoff-notes.md`. Its work lives on this computer, in `~/.instrument/work/<workspace>/<id>/` (`workDir`), the folder every session in it works in, tasks included; `<workspace>` is a readable name the workspace's machine folder records, so renaming or moving the workspace keeps it. A task's session header names its `parent` and the `forkedAt` message it carries on from, and its history is read as the parent's messages up to that point, then its own, never copied. A `chat.db` there is a chat an earlier build wrote, which the converter turns into records at launch. `tasks/<id>/` at the top level is only where 1.x left tasks for the layout migration to turn into chats. A topic lives under `Topics/<Name>/`, at the workspace's top level, in a `TOPIC.md`: plain YAML front matter (its `id`, its `emoji`, `color` and `about`, when it was `created`, `retired` only when it is) over the standing instructions every chat filed under it is read with. The folder is the topic's name, so renaming the folder renames the topic, and a key the build does not recognize is written back as it was found. A draft lives under `Drafts/<date>/`, at the workspace's top level, in a `DRAFT.md`: plain YAML front matter (its `id`, when it was `created` and last `updated`, the `chat` a reply goes into, the `topic` a new chat opens under, the `context` from outside its folder that goes with the message) over the person's own words. Every file or folder beside it in its folder goes with the message too, whether pasted or dropped there, the system's clutter aside, and taking one out of the composer moves it to the Trash. A draft is its `id`, never its folder name, and one folder may hold more than one `DRAFT*.md`; where those are different drafts, a file in the folder goes with a draft only when its `context` names it there. A reply waiting in a chat's box is a draft like any other, naming its chat. An app lives under `Apps/<Name>/`, at the workspace's top level, in an `APP.md`: plain YAML front matter (its `id`, and how the service is reached) over the guide, what it is for and what the work needs from it. The folder is the app's name, and its `id` is what `app` calls it by, since the credential store and the connection record are keyed by that. The workspace's skills are in `Skills/` and the person's memories in `Memory/`, both at the workspace's top level, a folder per skill and one Markdown file per memory. Each device appends what it sets about a chat to its own settings file, `settings.<device>.jsonl`, one `set` line per change, newest winning per session and field across devices: a session's title, star, archive, unread and topic, and the model every session of the chat runs on, set on the chat's own session. What a chat is comes from its logs: its own session is the one with no parent, and its start, its starting build and its last activity are read from the records. One state file per device, `state.<device>.json`, written and read by that device alone, holds where it left off (the tabs its sessions hold, each naming the task driving it, none meaning the chat, and the cards its agent is waiting on). The folders and apps granted in a chat, and what was refused there, are this computer's, in the workspace's machine folder's `permissions.json` under `chats`, and so are the folders granted under a topic, under `topics` by the topic's `id`, since every one names something on this computer (a `folders:` key in a `TOPIC.md` opens nothing), and so is the name of the chat's own folder under `Chats/` (`chat-folders.json`), found again through the chat its `CHAT.md` names when the folder is renamed. A `settings.json` beside a chat's records is from an earlier build, which the launch carries into those places and removes. Each device appends the model requests it makes, the activity log, to its own `.instrument/devices/<device>/activity/<YYYY-MM>.jsonl`, which this computer's `workspace.db` indexes. Workspace state every device changes, such as the bookmarks, is a synced store: each device appends `set` and `del` lines to its own `.instrument/devices/<device>/<domain>.jsonl` (`bookmarks.jsonl`), a key per member, newest winning per key across devices. Each device also writes its chat list whole into its own `.instrument/devices/<device>/chat-list.json`, derived from the records like `workspace.db`, for a phone to show the list from one file before it has read every chat. A chat's title, its own marks (starred, archived, unread), its topic and its model are settings. An app's connection record holds the chats waiting on its sign-in (`waitingChats`).

## UI copy

Words a person reads in the app (subheads, descriptions, empty states, toasts, dialogs) are written in conversational plain language: full sentences, said the way you would say them out loud to a friend. Keep it short, and keep the grammar. Read the line aloud, and if no one would say it that way, rewrite it.

These rules cover prose a person reads in the app and nothing else. Buttons, labels and placeholders are a word or a few ("Send", not "Stop and send what you said"). Text written for the agent (system prompts, tool descriptions, skill and environment notes) is terse and direct, written the way an agent reads best. When a full sentence and a shorter matter-of-fact one both work, take the shorter.

What to avoid:

- **Telegraphic sentences** that drop the subject or the small words to sound punchy: "Adds to what Instrument already knows." Say what does it: "Importing adds to what Instrument remembers."
- **Negative contrast**, "X, never Y" or "not X but Y", which adds emphasis by denying something nobody claimed: "Adds to your memories, never replaces them."
- **Clipped commands with a vague "it"**: "Repeat it for each AI you use."
- **Narrating the mechanism** instead of saying what the person gets: "Instrument reads it in a new chat and keeps what is worth keeping."
- **Spelling out the obvious**: a clause describing what the person can already see or would assume anyway, which makes a short line long and a little condescending. "Drag a file here to add it to this folder you're looking at" is "Drag a file here to add it."
- **Inventories** in a label, button or placeholder that list every kind of thing it covers: "Find tasks, files, people, and settings…" The results show the range; the label names the act in a few plain words. Labels, buttons and placeholders are the one place copy is not a full sentence.
- **Odd verbs** in place of everyday ones: a chat "can hold" so much, a folder "holds" your keys, a task "carries on", an app "sends back" an answer. Say has, fits, continues, or shows. Agents reach for "hold" far more often than people do, so when it turns up in your own draft, rewrite the line.

A line that works: "Importing adds to what Instrument remembers, so you can bring in memories from every AI you use."

Warm words are welcome. "Create an account to enjoy free AI usage" says "enjoy" on purpose, so a cleanup pass leaves a word like that alone.

## Local references

Never commit machine-local paths (`/Users/...`, `~/code/...`, `C:\...`) or names of sibling repos/checkouts on one dev's disk — not in code, docs, plans, commits, or PRs. Meaningless to others, goes stale when layout changes. Such pointers go in local notes, not shared history.

The same goes for a real computer's or account's name (a hostname, a login, a person's home folder): where a test, fixture, doc or wireframe needs one, use a generic name that says what it is, `mac-user`, `windows-user`, `linux-user`, and in prose say "the Windows test host".

Sources outside this repo are reachable by name instead: `agent-reference.json` (shared) and `agent-reference.local.json` (gitignored, where machine paths go) declare them, and `agent-reference status` lists them.

## Plans and usage

Plans, pricing, and usage limits belong to the API, which enforces them and records why. In this repo, treat them as answers the server gives rather than re-deciding them: build what the app does with them, and keep code, docs, and commits about that behavior.

## Registry Submodule

**NEVER edit `registry/`.** It is the `instrument-org/skills` git submodule. Read freely; do not create, edit, or delete files there.

Move its pin with `pnpm scripts:update-registry`, which takes the skills repo's pushed `main`. A pin to a skills commit that is not pushed yet breaks every checkout, CI's included, so the `pre-push` hook in `.githooks/` (set up by `pnpm install`) refuses a push carrying one.

## TypeScript

- Avoid casts. Prefer `satisfies`; use `as` only for genuinely different types (e.g. unknown payloads), and say why.
- Reuse existing types/interfaces rather than redefining per file. Prefer short inline non-exported types.
- Use `radashi` for common lodash-style functions.
- `tsc` is TypeScript 7, the native compiler; run it through `check:types` (below) or lean on built-in diagnostics. `typescript` 7 has no compiler JS API, so a tool that needs one cannot use it.

## Tailwind

Tailwind v4 scale utilities (`pt-17`, `gap-11`, `w-17`, etc.) are valid (4px x n). Prefer them over arbitrary `[...]` values.

## Zod

Prefer `z.output` over `z.infer` for type inference.

## React

- React Compiler is set up for Studio, so basic `memo`, `useMemo`, and `useCallback` are unnecessary.
- Avoid interfaces for component props; use inline types.

## Monorepo checks (Turbo)

Run lint/types from **repo root** through Turbo for caching. Avoid package-loop `cd` for `check:lint` / `check:types`. `turbo` is not always on PATH; use `pnpm exec turbo run …` (or root scripts that invoke turbo).

- `pnpm exec turbo run check:types check:lint` — all packages, or `--filter=@instrument-org/{workspace,studio}` for one
- `pnpm check-and-test` — full local check (includes spelling, format, etc.)
- `pnpm check-and-test:ci` — what CI runs (drops format/spelling, adds `check:packages:dedupe`, so it is not a strict subset). Formatting is deliberately not a merge gate: `pnpm fix` applies it unattended, so holding types, lint, build, and tests red behind a blank line costs more than the blank line does
- `pnpm turbo:fix:lint` — fix lint
- `pnpm fix` — regenerates derived files a test pins (the product guide reference), then spelling + format over the whole repo, in ~7s. Run it after editing settings, screens or shortcuts; it is also how a file the hook never saw gets formatted. `pnpm fix --lint` adds a type-aware oxlint fix across every package at full CPU, so run that one deliberately rather than in a checkout other agents are working in

`check:lint` / `fix:lint` run `oxlint --type-aware` alone, with no ESLint. The rules are deliberately few: oxlint's correctness category, the type-aware rules that catch real bugs (floating and misused promises, the `no-unsafe-*` family that keeps `any` out), import cycles, the React hook and React Compiler checks, Tailwind's unknown and conflicting classes, and the repo's own guardrails as a local plugin (`apps/studio/oxlint-rules.ts`). Nothing checks ordering or naming style; do not add rules that only ask for a different spelling of working code.

A format hook (`.claude/settings.json`, `@instrument-org/agent-hooks`) runs oxfmt on every file you Edit/Write, then oxfmt + `oxlint --type-aware --fix` on Stop over the files that session edited, and runs `vitest related` over them in each one's package (the `test:ci` projects, capped at 60s). Any error oxlint could not fix, and any related test that fails, blocks the turn and comes back to you to fix in context. So: expect files to change after you write them, never hand-format or hand-fix auto-fixable lint (including Tailwind class order), and don't run `check:lint` proactively to find what the hook is about to hand you anyway.

What the hook does not cover: type errors, tests in another package that import what you edited, and any file written by something other than Edit/Write (a heredoc or `sed -i` is untracked, so it is neither formatted nor linted); `pnpm fix` sweeps the tree for the formatting, `pnpm fix --lint` for the rest. Run `check:types` yourself when a change can move types: a signature, a schema, a prop, the shape of data flowing through. Skip it when a change cannot: className and CSS edits, copy, Markdown.

## Key catalog versions

`package.json` files show `"catalog:"` instead of version numbers. Real versions are in `pnpm-workspace.yaml` under `catalog:`. The ones where a stale assumption changes the code you write:

- **React** 19.3 / **react-dom** 19.3
- **TypeScript** 7.0 (the native compiler)
- **Zod** 4.x
- **Vite** 8.x (Rolldown/Oxc) / **Vitest** 5.x (browser locators and `toHaveTextContent` match exactly; `toMatchTextContent` takes a substring or RegExp)
- **AI SDK** 7.x
- **better-auth** 1.7.x
- **pnpm** 11.28.0 (`packageManager`) / **Node** >=24.22.0 (`engines`)

## Package management

- `pnpm` CLI (`install`, `add`, `remove`, `why`, etc.): outside sandbox (full permissions). pnpm links from the global store; sandbox isolation blocks that path, so the workspace no longer matches a normal local install.
- `pnpm test` / `pnpm check-and-test`: sandbox OK.

## Worktrees

After a manual `git worktree add`, run `.claude/hooks/worktree-setup.sh <path-to-worktree>`: copies the gitignored env files (required to boot Studio), inits `registry/`, installs deps. Idempotent. Hooks do this automatically only for sessions started inside a worktree or via EnterWorktree.

A worktree Claude Code makes (`claude -w`, a subagent's `isolation: worktree`) starts from the local `HEAD`, so it has main's unpushed commits. Land one with `scripts/land.sh` from inside it: it rebases the branch onto the local main, lists the `Commits-to:` contracts of the commits whose lines the branch changes, runs types and lint for what changed, knip over the whole repo, the related tests for what changed and the tests marked `// land: every landing` (ones that read source as text, which `vitest related` cannot trace), fast-forwards main in the primary checkout, and removes the worktree and its branch. When main moves during the checks it rebases and checks again, and it waits for another session's uncommitted edits to files the branch changes; those are that session's work, so never discard or stash them to get a landing through.

To commit by path in a checkout other sessions commit in too (the primary one above all), use `scripts/commit.sh -F <message-file> <path>...` rather than a hand-built private index. It takes new and deleted files, `<path>=<copy>` for part of a file's edits, and moves the branch only if no other commit landed while it built, so it never undoes one.

Multiple worktrees can run Studio at once: dev skips the single-instance lock, and the servers an instance binds fall back past the ports another one holds. Start one with `studio-drive.mjs boot --purpose <purpose>` (`studio-chrome-devtools` skill) rather than `pnpm dev` directly, so a checkout that already has an instance reuses it and the CDP port comes from the checkout path instead of from a guess. They all share one dev userData dir, so two instances are also two writers of one set of preferences and one workspace; `boot --purpose <purpose> --workspace <fixture>` gets a disposable one instead.

## Tests

The tests are here for the agents working in this repo: they are how a change gets checked without booting the app, and people rarely read them. So they should be fast, reliable, and able to express whatever an agent needs to check. Grow them when that helps. A test that flakes, is brittle, or slows the work down is yours to fix, rewrite, or delete, as long as no real regression is hidden in the process. When the suite itself is getting in the way, say so.

- Run one file, a directory, or a whole package **from the repo root**, with the package-relative path: `pnpm --filter @instrument-org/workspace exec vitest run [src/path/to/file.test.ts]` (`@instrument-org/studio` for `apps/studio`).
- Do not reach for `cd packages/<name> && …`. An agent shell keeps its working directory between commands, so the second such command in a session resolves against `packages/workspace/packages/workspace` and dies on "no such file or directory", and with `&&` the rest of the chain is skipped silently. `--filter` is idempotent across calls and is the same shape whether you run one file or the package. Where a command genuinely has to run inside a package, `cd` to its absolute path.
- Prefer `toMatchInlineSnapshot` so expected output stays visible in the test file. Generate it empty and let the run fill it in.
- Use `it.each` for repetitive cases.

## Commit trailers

A commit that makes a choice ends with decision trailers, so the reasoning outlives the session that held it: `Rejected: <alternative> | <reason>`, `Commits-to: <contract later code must keep>`, `Not-tested: <what was not checked>`, `Related: <sha>`, `Follow-up: docs/follow-ups/<file>.md` on a commit that installs logging or another signal to look at later, and `Tested:` only for checks beyond the unit suites. Each line must make sense to a reader who never saw the session; leave one out rather than pad it. A commit that makes no choice carries none. Vocabulary and examples: `instrument-commit-message` skill. A brief for a subagent that commits points at that skill rather than listing trailers or pasting example ones, which the subagent reads as required.

## Repository knowledge base

Durable, versioned docs are the system of record; prefer them over chat/history. Keep them evergreen and safe to share: leave out secrets and anything tied to one machine, person, or moment.

- `docs/README.md`: the knowledge-base index and provenance.
- `docs/architecture/` — evergreen maps of a subsystem or domain and how it layers together, edited in place as the code changes. One file per subsystem.
- `docs/findings/` — non-obvious issues, what we tried, what might resolve them later. One file per finding.
- `docs/plans/` — execution plans for non-trivial work (`active/` vs `completed/`). One file per plan.
- `docs/follow-ups/`: checks we owe later, each with the signal to look for and a date to look. A change that ships logging, a counter or a cap to learn from later adds one in the same commit. When working in an area, check its index for a follow-up past its date.
- `docs/decisions/` — why we chose one approach over another, dated. One file per decision.
- `docs/changes/`: dated, screenshot-backed summaries of user-facing changes for design follow-up and possible changelog input.
- `docs/reviews/`: code reviews, the range each read and what came of each finding. Read before reviewing; a fix for a finding carries a `Review:` trailer.

## Additional guidance

- `REVIEW.md` — Repo-specific code review calibration.
- `.agents/skills/validate-changes/SKILL.md` — **How to check your work.** The ways to run this product (sandbox shell, real agent across models, the app), what each one can and cannot tell you, and which to reach for. Read this before concluding a change works.
- `.agents/skills/instrument-commit-message/SKILL.md` — This repo's commit scopes and real examples from the history.
- `.agents/setup.md` — Prerequisites before the first `pnpm studio`.
- `.agents/env.md` — Environment variables for Studio and workspace.
- `docs/architecture/system-overview.md` — Top-level map: packages/layering, main-vs-renderer runtime topology, on-disk layout, and how an agent turn flows. Start here.
- `docs/architecture/ai-gateway.md` — Model access: the mounted provider-proxy Hono app plus the model-discovery/identity library consumed by workspace and studio.
- `docs/architecture/agent-sandbox.md` — How agent tools are contained (the Permissions rules, path-scoped file I/O, the just-bash filesystem, agent-browser allowlist, real-binary escape hatches under Seatbelt on macOS and bubblewrap on Linux).
- `docs/architecture/native-and-builtin-commands.md`: Which shell commands run as real programs (uutils, rg, git, the interpreters, the PATH) and which as just-bash builtins, per platform; the uutils table is generated from `shell-commands/native-text.ts`.
- `docs/architecture/bash-sandbox-mounts-and-native-binaries.md` — How the folders a chat reaches are mounted at their real paths, the nested-mount collapse, and known just-bash quirks.
- `docs/architecture/just-bash-upstream.md` — Which `just-bash` build we consume, every patch and agent-facing workaround we carry because of an upstream gap, what has to be true before each can go, and our open upstream PRs. Read before adding a prompt line that steers the agent around sandbox behavior.
- `docs/architecture/in-app-browser.md` — The in-app browser the user, a chat, and its tasks share: the renderer-owned `<webview>` pool, paint-host vs visible, the CDP path from `agent-browser` to the guest, files opening at their `file://` address, and what the panel may do that the agent may not.
- `docs/architecture/background-processes.md` — What happens to a `bash` command that outlives its `yieldMs`: the promotion rule, the `jobs`/`fg`/`kill` command surface, who owns a running process and what ends one, and the caps.
- `docs/architecture/responsive-layout.md` — Why viewport breakpoints are the wrong proxy for layout width in Studio (UI zoom + resizable sidebar), the `@container/app-content` shell container, and the unit rules for sizing portalled content under zoom.
- `docs/architecture/auto-updater.md` — How Studio finds, stages, and installs a build: the pure-reducer / port-seam / wiring split, channel selection, and why the build offered and the build installed can diverge.
- `docs/architecture/releasing.md`: Where a build comes from and where it goes: cutting a tag, what it starts, where the artifacts land, the draft release, and the notes.
- `docs/architecture/mac-native-bridge.md`: The Mac bridge: the in-process module and the helper process behind `lib/mac-native.ts`, which one a capability belongs in, and how to add one.
- `.agents/cloud-dev.md` — Headless/CI dev: `NO_SANDBOX`, the CDP port default, Xvfb, and build approvals.
- `apps/studio/AGENTS.md` — Electron deps vs devDeps, React 19 + TanStack Router + oRPC patterns, where client/main/RPC code lives.
- `packages/workspace/AGENTS.md` — RPC routes, tools/agents layout, workspace server, XState machines, Result + Zod tool conventions.
