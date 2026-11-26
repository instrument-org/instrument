# Instrument Monorepo

pnpm monorepo for the Instrument desktop app platform. The public website is https://tryinstrument.com; the app talks to its API at `api.tryinstrument.com` (`staging.api.` for staging) and fetches updates from `releases.tryinstrument.com`. Neither the website nor the API lives in this repo.

- `apps/studio`: Electron desktop app (main product)
- `packages/workspace`: Core AI agents, workflow logic, and workspace management
- `packages/ai-gateway`: Model proxy (Hono app the workspace server mounts) plus the model discovery/identity library
- `packages/shared`: Types, constants, and utilities used everywhere
- `packages/typescript-config`: Shared tool config

## Product terminology

- The user talks to one agent in a **chat**, the only record, named by its `ChatId` everywhere: code, routes, RPC, events, types, and on-disk layout. A chat holds **sessions**, each a thread of messages and tool calls (`SessionId`): the chat's own conversation is the session with no parent, and a **task** is a session the chat started in the background, with the chat's session as its parent. "Task" is the word for that child session in the agent's `task` command (which names it by a per-chat handle, `t1`) and in the UI, never in storage.
- On disk, what the app keeps in a workspace is in its `.instrument/` (`workspaceLayout`), and the workspace's top level is the person's own. A chat's records live under `.instrument/chats/<id>/`: one append-only log per session per device (`<session>.<device>.jsonl`), a settings file per device (`settings.<device>.jsonl`), a state file per device (`state.<device>.json`), `blobs/`, `attachments/` (what the person sent) and `handoff-notes.md`. Its work lives on this computer, in `~/.instrument/work/<workspace>/<id>/` (`workDir`), the folder every session in it works in, tasks included; `<workspace>` is a readable name the workspace's machine folder records, so renaming or moving the workspace keeps it. A task's session header names its `parent` and the `forkedAt` message it carries on from, and its history is read as the parent's messages up to that point, then its own, never copied. A `chat.db` there is a chat an earlier build wrote, which the converter turns into records at launch. `tasks/<id>/` at the top level is only where 1.x left tasks for the layout migration to turn into chats. A project is a folder under `Projects/<Name>/`, at the workspace's top level, and every folder there is one. Its `AGENTS.md`, named as coding agents name a folder's instructions, is the standing instructions every chat filed under it is read with and nothing the app writes besides, so another agent may rewrite it freely; a project with none has no file. The rest of a project (its `id`, its `emoji`, `color` and `about`, when it was `created`, `retired` only when it is) is its record in the projects synced store (`projects.jsonl`, below), keyed by its id. The id is named in the folder's hidden `.instrument-project`, so it goes with the folder through a rename in a file manager or a sync that arrives ahead of the store; a folder with none yet goes by an id drawn from its name (a new project's too, so two computers agree), and a copy of a folder, which names an id an older folder has, becomes a project of its own. Any read in a running workspace writes down a missing record or id file. The folder is the project's name, so renaming the folder renames the project. Front matter an earlier build wrote into an `AGENTS.md` is taken into the store at every launch (`moveProjectFrontMatterToStore`), and a key this build does not recognize stays in the file as it was found. A build that called projects topics kept them in `Topics/<Name>/TOPIC.md`, which the launch moves into `Projects/`, and wrote `topic` where this one writes `project`, which every reader takes under either name. A draft lives under `.instrument/drafts/<date>/`, in a `DRAFT.md`, which the agent reads and never writes: plain YAML front matter (its `id`, when it was `created` and last `updated`, the `chat` a reply goes into, the `project` a new chat opens under, the `context` from outside its folder that goes with the message) over the person's own words. Every file or folder beside it in its folder goes with the message too, whether pasted or dropped there, the system's clutter aside, and taking one out of the composer moves it to the Trash. A draft is its `id`, never its folder name, and one folder may hold more than one `DRAFT*.md`; where those are different drafts, a file in the folder goes with a draft only when its `context` names it there. A reply waiting in a chat's box is a draft like any other, naming its chat. A top-level `Drafts/` is where an earlier build kept them, which every launch moves in. An app is one record in the `apps` synced store (`.instrument/devices/<device>/apps.jsonl`), keyed by its `id`, which is what `app` calls it by, since the credential store and the connection record are keyed by that: its name, its setup (how the service is reached) and its guide, what it is for and what the work needs from it. Only `instrument app` and the Apps page write one; an `Apps/` folder an earlier build kept is taken into the store at launch and sent to the Trash. The workspace's skills are in `Skills/` and the person's memories in `Memory/`, both at the workspace's top level, a folder per skill and one Markdown file per memory, its text alone: the chat a memory was learned in and when it was saved are in the memory synced store (`memory.jsonl`), keyed by the file's name, where the launch also takes the front matter an earlier build wrote (`moveMemoryFrontMatterToStore`). Each device appends what it sets about a chat to its own settings file, `settings.<device>.jsonl`, one `set` line per change, newest winning per session and field across devices: a session's title, star, archive, unread and project, and the model every session of the chat runs on, set on the chat's own session. What a chat is comes from its logs: its own session is the one with no parent, and its start, its starting build and its last activity are read from the records. One state file per device, `state.<device>.json`, written and read by that device alone, holds where it left off (the tabs its agents opened, each of which stays open until an agent or the person closes it, or the cap on tabs out of sight, archiving the chat or trashing it does). What a chat waits on the person for (a permission card, a question its agent asked with `choose`, or a sign-in card from `connect_app`) is an `ask` record in the chat's own session's log, written whole by the computer it belongs to (its `device`) with one `stage` (open, taken, waiting on the system, closed with its outcome and whether its askers were woken), and read by every device, so the card shows wherever the chat is open; any device answers it with an `answer` record in its own log, and every reader reads where it stands through one fold (`askStates`). The ask's computer alone acts: it takes the first fresh answer in log order (a question's is written onto its `choose` call; one given within ten minutes, `isFreshAsk`, so a computer coming back from sleep or a quit never acts on answers given while it was away), grants it in its own `permissions.json`, closes the ask, and wakes its askers once, each note naming the ask. A card waiting on that computer's own system prompt is answered only there, and signing in happens only on the computer that asked, whose app events settle the sign-in's rows; another device shows them as that computer last wrote them and may say Not now. The folders and apps granted in a chat, and what was refused there, are this computer's, in the workspace's machine folder's `permissions.json` under `chats`, and so are the folders granted under a project, under `projects` by the project's `id`, since every one names something on this computer (a `folders:` key in an `AGENTS.md` opens nothing). A `settings.json` beside a chat's records is from an earlier build, which the launch carries into those places and removes. Each device appends the model requests it makes, the activity log, to its own `.instrument/devices/<device>/activity/<YYYY-MM>.jsonl`, which this computer's `workspace.db` indexes. Workspace state every device changes, such as the bookmarks, is a synced store: each device appends `set` and `del` lines to its own `.instrument/devices/<device>/<domain>.jsonl` (`bookmarks.jsonl`, `projects.jsonl`, `memory.jsonl`), a key per member, newest winning per key across devices. Once a phone has used the workspace (some device's `device.json` names platform `ios`, `workspaceHasPhone`), each computer also writes its chat list whole into its own `.instrument/devices/<device>/chat-list.json`, derived from the records like `workspace.db`, for a phone to show the list from one file before it has read every chat, and its `status.json` beside it; nothing on a computer reads either. A chat's title, its own marks (starred, archived, unread), its project and its model are settings.

## UI copy

Words a person reads in the app (subheads, descriptions, empty states, toasts, dialogs, errors) read like a well-made app printed them, not like the app narrating itself. Take the phrase people already know first, and plain spoken English where there isn't one. Short is what that usually comes to and not the aim: a line no one would say or print is wrong however short it is.

In this order:

- **Cut what the screen already says.** A title or button that explains itself needs no description, and a true clause that changes nothing ("then comes right back here") goes.
- **Use the familiar phrase**: what macOS, Chrome or ChatGPT say for the same thing, or what the app's own sibling message says.
- **State what happened or what the person can do.** A status or an error can be a fragment or passive: "Thanks! Feedback submitted.", "Error sending your feedback", "Icon updated". A description is a full sentence.
- **Trust the reader with the ordinary word**: "Scale the app" over "Make the app larger or smaller". Data is stored, and a folder the app won't open is protected.
- **Keep the app a tool.** It has no "we" or "us" and doesn't keep, want or hear, and a thing has no possessions ("model limits" over "the model's limit"). The people behind it are "the Instrument team".
- **Echo the button.** A line beside Send again says "try sending again", and a link to Send feedback says "send feedback".
- **Name a concept as familiar software does**: tab, window, chat, folder, page. Never coin a noun people haven't met in software.
- **Put warmth in a word**: "Thanks!", "Please check your edits", "enjoy".

An email from a person on the team is the other voice: "Hi Sam", "we", contractions, whole sentences the way you'd talk.

These rules cover prose a person reads in the app and nothing else. Buttons, labels and placeholders are a word or a few ("Send", not "Stop and send what you said"). Text written for the agent (system prompts, tool descriptions, skill and environment notes) is terse and direct, written the way an agent reads best. When a full sentence and a shorter matter-of-fact one both work, take the shorter.

A person who misread or missed something is not helped by a longer line, since people skim: change what is shown, where it lives, or a control's label or state, and keep any copy to a small part of that.

What to avoid:

- **Telegraphic descriptions** that drop the subject or the small words to sound punchy: "Adds to what Instrument already knows." Say what does it: "Importing adds to what Instrument remembers."
- **Negative contrast**, "X, never Y" or "not X but Y", which adds emphasis by denying something nobody claimed: "Adds to your memories, never replaces them."
- **Clipped commands with a vague "it"**: "Repeat it for each AI you use."
- **Narrating the mechanism** instead of saying what the person gets: "Instrument reads it in a new chat and keeps what is worth keeping."
- **Spelling out the obvious**: a clause describing what the person can already see or would assume anyway, which makes a short line long and a little condescending. "Drag a file here to add it to this folder you're looking at" is "Drag a file here to add it."
- **Inventories** in a label, button or placeholder that list every kind of thing it covers: "Find tasks, files, people, and settings…" The results show the range; the label names the act in a few plain words. Labels, buttons and placeholders are the one place copy is not a full sentence.
- **Odd verbs** in place of everyday ones: a chat "can hold" so much, a folder "holds" your keys, a task "carries on", an app "sends back" an answer. Say has, fits, continues, or shows. Agents reach for "hold" far more often than people do, so when it turns up in your own draft, rewrite the line.

- **Software that hears, knows or is told things**: "Before each message, a chat hears what you just did." Say what goes where: "Each message you send includes a short list of what you just did here."
- **Vague nouns** standing in for the real one: "what kind of thing you did", "something like". Name it, or cut the clause.
- **A switch row's description that changes with the switch**: it reads true on or off, and the switch alone shows the state.
- **A clause another screen already says**: a caveat the send dialog or the report already covers makes this line longer and no clearer.

A line that works: "Importing adds to what Instrument remembers, so you can bring in memories from every AI you use."

Warm words are welcome. "Create an account to enjoy free AI usage" says "enjoy" on purpose, so a cleanup pass leaves a word like that alone.

## Comments

When you prove a comment wrong, fix it in the same commit.

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
- A `check:types` error listing members the file on disk does not have is a stale `apps/studio/tsconfig.tsbuildinfo` (the app config is incremental): delete it and run again.
- Scripts run as `node x.ts` with Node's type stripping. `import { type X } from` still loads the module; take a type from a module that can't load under plain node with a top-level `import type`, and give relative imports their `.ts`.
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
- `pnpm fix` — regenerates derived files a test pins (the product guide reference), then format over the whole repo and a list of spelling suggestions it leaves for you (`pnpm fix:spelling` writes them), in ~7s. Run it after editing settings, screens or shortcuts; it is also how a file the hook never saw gets formatted. `pnpm fix --lint` adds a type-aware oxlint fix across every package at full CPU, so run that one deliberately rather than in a checkout other agents are working in

`check:lint` / `fix:lint` run `oxlint --type-aware` alone, with no ESLint. The rules are deliberately few: oxlint's correctness category, the type-aware rules that catch real bugs (floating and misused promises, the `no-unsafe-*` family that keeps `any` out), import cycles, the React hook and React Compiler checks, Tailwind's unknown and conflicting classes, and the repo's own guardrails as a local plugin (`apps/studio/oxlint-rules.ts`). Nothing checks ordering or naming style; do not add rules that only ask for a different spelling of working code.

A format hook (`.claude/settings.json`, `@instrument-org/agent-hooks`) formats every file you edit (Edit, Write, or a Bash command that names it), and at Stop runs oxlint `--fix`, knip and `vitest related` over the session's files. What it cannot fix blocks the turn and comes back to you. So expect files to change after you write them, never hand-format or hand-fix auto-fixable lint (Tailwind class order included), and don't run `check:lint` to find what the hook is about to hand you.

It does not cover type errors, tests in another package that import what you edited, or a file a script writes without the command naming it; `pnpm fix` sweeps formatting, `pnpm fix --lint` the rest. Run `check:types` when a change can move types (a signature, a schema, a prop, the shape of data flowing through); skip it for className, CSS, copy and Markdown.

## Key catalog versions

`package.json` files show `"catalog:"` instead of version numbers. Real versions are in `pnpm-workspace.yaml` under `catalog:`. The ones where a stale assumption changes the code you write:

- **React** 19.3 / **react-dom** 19.3
- **TypeScript** 7.0 (the native compiler)
- **Zod** 4.x
- **Vite** 8.x (Rolldown/Oxc) / **Vitest** 5.x (browser locators and `toHaveTextContent` match exactly; `toMatchTextContent` takes a substring or RegExp)
- **AI SDK** 7.x
- **better-auth** 1.7.x
- **pnpm** 11.28.0 (`packageManager`) / **Node** >=24.22.2 (`engines`)

## Package management

- `pnpm` CLI (`install`, `add`, `remove`, `why`, etc.): outside sandbox (full permissions). pnpm links from the global store; sandbox isolation blocks that path, so the workspace no longer matches a normal local install.
- `pnpm test` / `pnpm check-and-test`: sandbox OK.

## Worktrees

- After a manual `git worktree add`, run `.claude/hooks/worktree-setup.sh <path>` (env files Studio needs, `registry/`, deps). Hooks do it only for sessions started inside a worktree or via EnterWorktree.
- A worktree Claude Code makes starts from the local `HEAD`, main's unpushed commits included. Land it with `scripts/land.sh` from inside it; its header covers the checks and `--onto`. Never push a worktree's commits straight to a shared branch on origin, which leaves the local one behind, and never discard or stash another session's uncommitted edits to get a landing through.
- A branch pushed for a pull request carries those unpushed commits too, and the repo is public: check `git rev-list --count origin/main..main` before its first push, and when main is ahead, push main first or base the branch on `origin/main`.
- After a worktree rebases (`land.sh` included), run `pnpm install` there before trusting a test or type failure: a dependency main gained shows up as `Failed to resolve import` or TS2307, not as an install error. When pnpm says "Already up to date" over a broken tree, delete `node_modules/.pnpm-workspace-state-v1.json` (and `node_modules/.package-map.json`, where there is one) and install again.
- In a checkout other sessions commit in (the primary one above all), commit by path with `scripts/commit.sh -F <message-file> <path>...` and amend your own commit with `scripts/commit.sh --amend <sha>`, never `git commit --amend`. Usage in its header.
- A green suite in a checkout other sessions edit tests their edits as well as your commit. To check a commit made there, check it out detached in a throwaway worktree (`git worktree add --detach <tmp> <sha>`, `worktree-setup.sh <tmp>`) and run `pnpm check-and-test:ci` there with `TURBO_FORCE=1`, so Turbo serves no cached pass.
- Run Studio with `studio-drive.mjs boot --purpose <purpose>` (`studio-chrome-devtools` skill), never `pnpm dev` directly: several checkouts can run at once, and the skill covers ports and disposable workspaces.

## Tests

The tests are here for the agents working in this repo: they are how a change gets checked without booting the app, and people rarely read them. So they should be fast, reliable, and able to express whatever an agent needs to check. Grow them when that helps. A test that flakes, is brittle, or slows the work down is yours to fix, rewrite, or delete, as long as no real regression is hidden in the process. When the suite itself is getting in the way, say so.

- Run one file, a directory, or a whole package **from the repo root**, with the package-relative path: `pnpm --filter @instrument-org/workspace exec vitest run [src/path/to/file.test.ts]` (`@instrument-org/studio` for `apps/studio`).
- Never `cd packages/<name> && …`: the shell keeps its working directory, so the next one fails. Where a command has to run inside a package, `cd` to its absolute path.
- Prefer `toMatchInlineSnapshot` so expected output stays visible in the test file. Generate it empty and let the run fill it in.
- Use `it.each` for repetitive cases.

## Commit messages

Load the `instrument-commit-message` skill before writing any commit message (a Claude session's first commit waits for it): it has the subject rules the `commit-msg` hook enforces and the decision trailers a commit that makes a choice ends with. A brief for a subagent that commits points at that skill rather than listing trailers or pasting example ones, which the subagent reads as required.

## Problem reports

A commit that fixes a problem report carries `Report: <fingerprint>` (`feedback:<id>`), `Report: <fingerprint> (partly)` when it leaves part open, or `Related-report: <fingerprint>` for a change that fixes nothing; one made for a teammate's Slack ask carries `Slack: <link to the thread's first message>`. Once it is on `main` the reports worker ties, resolves and replies, so nothing is resolved by hand and you never post to the thread.

Reading a report, writing back to the person who sent it, or tying a commit after the fact: `problem-reports` skill.

## Repository knowledge base

Durable, versioned docs are the system of record; prefer them over chat/history. Keep them evergreen and safe to share: leave out secrets and anything tied to one machine, person, or moment.

- `docs/README.md`: the knowledge-base index and provenance.
- `docs/architecture/` — evergreen maps of a subsystem or domain and how it layers together, edited in place as the code changes. One file per subsystem.
- `docs/findings/` — non-obvious issues, what we tried, what might resolve them later. One file per finding. There is no issue tracker outside the repo: a bug found in passing is fixed or recorded here, and a GitHub issue is opened only when asked.
- `docs/plans/` — execution plans for non-trivial work, one file per plan in one folder, each opening with `Status: open|done|superseded|dropped.` (`rg -m1 '^Status: open' docs/plans` lists the open ones). `pnpm fix` regenerates the section indexes; `pnpm check:docs` fails on a broken link, a cited path that no longer exists, or a stale index.
- `docs/follow-ups/`: checks we owe later, each with the signal to look for and a date to look. A change that ships logging, a counter or a cap to learn from later adds one in the same commit. When working in an area, check its index for a follow-up past its date.
- `docs/principles/`: the standing rules behind many decisions. Before raising a product or design question, check here; if one answers it, cite it and go.
- `docs/decisions/` — why we chose one approach over another, dated. One file per decision.
- `docs/changes/`: dated, screenshot-backed summaries of user-facing changes for design follow-up and possible changelog input.
- `docs/reviews/`: code reviews, the range each read and what came of each finding. Read before reviewing; a fix for a finding carries a `Review:` trailer.

## Additional guidance

- `.agents/skills/validate-changes/SKILL.md`: **how to check your work.** Read before concluding a change works.
- `REVIEW.md`: repo-specific code review calibration.
- `docs/architecture/README.md`: index of the subsystem maps; start at `system-overview.md`.
- `.agents/setup.md` (before the first `pnpm studio`), `.agents/env.md` (environment variables), `.agents/cloud-dev.md` (headless and CI dev).
