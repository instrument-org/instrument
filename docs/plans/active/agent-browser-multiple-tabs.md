# Agent browsing across several tabs

Status: in progress. Phases 1 through 3 landed; the visible cursor (4) is next. Supersedes [one-browser-many-tabs.md](./one-browser-many-tabs.md), [lazy-browser-targets-and-multiple-tabs.md](./lazy-browser-targets-and-multiple-tabs.md) and [browser-popups-as-agent-drivable-tabs.md](./browser-popups-as-agent-drivable-tabs.md), which were written for the 1.x task page and its single browser panel. Their analysis of the CDP bridge and of popups still holds and is cited below; their identity migration and tab-strip phases are already done by the 2.0 window.

## Goal

A task drives a browser the way a person does: several tabs at once, opening a new one while leaving the last where it was, switching between them, closing what it is done with. The orchestrator can hand a task more than one of the chat's tabs. Every page an agent touches is a real tab of its chat, listed with the rest, and none of them is ever brought in front of the user on the agent's account.

An agent that does not care about tabs keeps working exactly as it does today, with no tab argument on any command.

## Where things stand

- **One page per task, enforced at three layers.** Task state holds one `browserTargetId` ([task-state.ts](../../../packages/workspace/src/schemas/task-state.ts)). `task new --tab` and `task tab` take one id ([task.ts](../../../packages/workspace/src/lib/shell-commands/task.ts)). The [CDP bridge](../../../packages/workspace/src/logic/server/routes/cdp-bridge.ts) serves agent-browser a single page and fakes the `Target.*` domain: `getTargets` returns a list of one, and `createTarget` navigates the one page instead of making another.
- **The skill says so.** The agent-browser skill states that the browser exposes one page target, and the tab commands were removed from it deliberately (registry decision `2026-08-04-drop-tab-guidance-until-multi-page-support.md`, removal in registry commit `5484f2a`).
- **The tab commands are not refused.** `tab`, `window` and `click --new-tab` are absent from the wrapper's `BLOCKED_SUBCOMMANDS` ([agent-browser.ts](../../../packages/workspace/src/lib/shell-commands/agent-browser.ts)). Against the bridge, `tab new <url>` navigates the task's one page, which is often the user's own visible tab, and reports success.
- **Multiple tabs today means multiple tasks.** The orchestrator opens N tabs with `open` and starts one task per tab. That works and stays useful, but no single task can work across two pages.
- **What 2.0 already provides.** Every window tab is its own browser target, `(windowId, tabSessionId)`, whose `ses_…` id the orchestrator already hands around. Tabs are grouped per chat (the thread's session id is the tab group). `openPage` in [open.ts](../../../packages/workspace/src/lib/shell-commands/open.ts) asks the window for a tab in a given chat and gets its id back ([use-openers.ts](../../../apps/studio/src/client/components/orchestrator/use-openers.ts)). Every guest, handed or task-owned, uses the one workspace browser profile (`getBrowserSessionDir`), so moving a task's browser into the tab list changes no cookies.
- **agent-browser is current.** We ship 0.38.1, the latest on npm. Its tab model is the one we want to expose: stable `t1`/`t2` ids never reused within a session, `tab new --label <name>`, CDP target ids accepted anywhere a tab ref is (`tab <targetId>`), and `--pin-tab`, under which tabs opened by others never take over a session's active tab. Commands go to the active tab, so an agent that never names a tab is unaffected.

## The model

A tab belongs to a chat. A task **holds** a set of that chat's tabs:

- tabs the orchestrator **handed** it, with `--tab` at `task new` or `task tab --add` later;
- tabs it **opened** itself, with `tab new`, `click --new-tab`, or its first browser command when it was handed none.

A task sees and drives only the tabs it holds, never the rest of the chat's or the window's. Holding is not exclusive: the orchestrator decides who gets which tab, and handing a tab another running task holds is allowed with a warning, since sometimes that is the intent.

Every held tab is a real entry in the chat's tab list, whoever opened it. Opening one never selects it, never reveals the pane, and never takes focus; it renders as a paint-host guest until the user picks it from the list. The user watching is optional and always their move.

When a task finishes, the tabs it opened stay open in the chat, and it stops holding everything. The orchestrator's note lists them like any other tab, so a follow-up task can be handed one by id.

## Design

### 1. Handover: the `task` command

- `task new --tab <id>` becomes repeatable. The first `--tab` is the task's starting active tab.
- `task tab <task> --add <id>...`, `--remove <id>...`, `--none`, the same shape as `task folder`. `task tab <task> <id>` keeps meaning "hold exactly this one".
- `resolveTab` keeps its checks (a live tab of the window, not a local file) and gains a warning line when another running task holds the tab.
- `task show` prints every held tab, marking which the task opened.
- Task state: `browserTargetId` becomes `browserTabs: { id: BrowserTargetId; openedBy: "handed" | "task" }[]`, with no read of the old field.
- `--tab` takes tab ids only, never a URL: a URL form would invite opening a second copy of a page the user already has, where handing over the existing tab was meant. A new page needs no handover, since the task opens it in the chat itself.
- The orchestrator's prompt: `--tab` may be repeated, and one task working across several pages beats one task per page when the pages are one job (compare these, fill this form from that page). Independent jobs still fan out.

### 2. The bridge serves a browser, not a page

This is the real work. agent-browser's tab machinery (`Target.setDiscoverTargets`, `setAutoAttach` with `flatten` and `waitForDebuggerOnStart`, `attachToTarget`, `Runtime.runIfWaitingForDebugger`, and the `tab` subcommands built on them) expects a browser-level endpoint. Our provider plugin ([agent-browser-plugin.ts](../../../packages/workspace/src/lib/agent-browser-plugin.ts)) already answers `directPage: false`, so agent-browser already speaks browser-level `Target.*` to the connection; the bridge answers those calls with a one-page fiction. The change is to answer them truthfully over a set of pages.

- **A task-scoped browser endpoint.** `/cdp/task/<taskId>` (alongside the existing page path) presents the task's held tabs as the whole browser. The plugin returns it instead of one tab's page URL.
- **Target ids are tab ids.** The `targetId` agent-browser sees for a window tab is the tab's `ses_…` id, so `agent-browser tab ses_…` works with the id the brief named, and `tab list --json` reports ids the orchestrator recognizes. The bridge maps them to the encoded `BrowserTargetId` internally.
- **`Target.*` over the held set, and nothing else.**
  - `getTargets` and `setDiscoverTargets` report held tabs; `targetCreated`, `targetInfoChanged` and `targetDestroyed` follow the set as it changes, including the user closing a tab.
  - `setAutoAttach` / `attachToTarget` give each held tab its own flat `sessionId`. The bridge multiplexes each tab's Electron debugger onto the one connection, tagging events with that tab's session and routing commands by it. The per-target gates the bridge applies today (the closed-file gate, withheld events, teardown resets) apply per tab session unchanged.
  - `createTarget` asks the window, through the `openPage` path, for a new tab in the task's chat with a background disposition, waits for its id, adds it to the held set as `openedBy: "task"`, then announces it. Electron does not pause a new target for the debugger, so the bridge attaches first and answers `runIfWaitingForDebugger` as a no-op, as the popup plan worked out.
  - `closeTarget` closes a tab the task opened, and releases a tab it was handed without closing it: the user's tab is not the agent's to close.
  - `activateTarget` changes only which tab agent-browser treats as active. It never selects the tab in the window.
- **A tab cap per task** (8 to start). `createTarget` past it is refused with a CDP error that names the cap and says to close a tab first.
- **No `--pin-tab`.** A pinned session with no saved binding opens a fresh tab on its first connect instead of adopting the tab it was handed, so the wrapper leaves pinning off. The user switching the visible tab never moves a task's active tab anyway, since nothing here selects a tab for the agent. The cost: agent-browser makes a tab it discovers mid-run the active one, so a tab handed over while the task is connected becomes where its next command lands. The hand-over is always the conversation's deliberate act, with a message saying why, and `tab list` shows the change.
- **Restoring before calling a tab closed.** After a launch the window makes a tab's guest again only when the tab is next shown. A task's held tab without a guest is asked back through the window (`restore`) before the task is told it is closed, so a restart does not lose the task its pages.
- **A task with no tab yet is connected all the same.** agent-browser asks a browser with no pages for one, which the endpoint opens as a tab of the chat; the wrapper opens nothing ahead of it.

### 3. Every agent page is a listed tab

- The window's open path gains a background disposition: add the tab to the named chat's group, unselected, pane untouched, as a paint-host guest. Agent-created tabs always use it. The orchestrator's `open` keeps showing what it opens, since putting something on screen is that command's purpose.
- A task with no handed tab no longer gets a private guest outside the list. Its first browser command creates a background tab in its chat (the chat whose folder holds the task, via the chat record's `chatSessionId`), and that tab is its first held tab. The eval harness, which has no window, keeps its windowless target.
- A tab that was never navigated (a bare `tab new`) stays out of the strip until it loads something, so an agent opening and immediately navigating does not flash a blank entry.
- Agent activity on a tab is visible in the list without bringing it forward: the tab carries the working indicator the chat already shows for a running task, attributed to that task.

### 4. The visible cursor

agent-browser 0.38 added a visible cursor (#1808, timing fix #1869): an animated pointer with a click ripple, painted in an isolated world under a closed shadow root, inert and absent from accessibility snapshots. It is also reached only through `record start --cursor` and removed when recording stops, so today it appears in recordings and not while the user watches a tab.

We want it on whenever an agent drives a tab, using upstream's implementation rather than one of our own:

- **Preferred:** an upstream change that makes the cursor a session option independent of recording (`--cursor` on the session, or an `AGENT_BROWSER_CURSOR` environment variable), which the wrapper then always sets. Drafted through the `pull-requests` skill.
- **Until it lands, or if declined:** the bridge installs upstream's `recording-cursor.js` itself on each held tab when the agent attaches, and removes it on detach, the same way agent-browser does during a recording. Apache-2.0, carried with attribution, and deleted once the upstream option ships.
- Pair it with upstream's `--input-mode human` (curved, eased pointer paths, also 0.38) so the pointer moves rather than jumps. Human-mode timing slows input; measure the cost per click before making it the default.

Open question, to settle when the cursor lands: screenshots taken while the overlay is mounted include it, as they do during an upstream recording. That is probably harmless and arguably useful to a model, but check it does not make a model read the pointer as page content.

### 5. Skill

The agent-browser skill lives in the skills repo (never edited through `registry/`). Restore the tab guidance from registry commit `5484f2a`, rewritten from "unavailable" to what the commands do here:

- commands act on the active tab, and a task handed several tabs starts on the first;
- `tab new --label <name> <url>` to open a page while keeping the current one, `tab <label|id>` to switch, refs are per tab so snapshot after switching, `tab close` when done;
- the tabs a task holds are real tabs of the user's chat and stay after the task finishes, so close scratch tabs and leave result pages open;
- a handed tab is the user's: work in it, never close it.

Replace the "one page target" line. Supersede the 2026-08-04 decision with a new one in the skills repo.

### 6. Popups

Out of scope here, and unblocked by it. Once a task holds several tabs, a page's `window.open` can become another held tab. The hosting question the popup plan raised (an opener-preserving popup must be a main-process `WebContentsView`, not a `<webview>` guest) still stands and gets its own plan.

## Phasing

Pre-GA with two users, so every phase breaks what it replaces outright: no compatibility reads, no interim flags, no second path kept alive beside the new one. The order follows the evidence, not the size of the work.

1. **Every task browser is a listed tab, and the orchestrator stops opening pages for tasks.** First because it fixes an observed failure (see Evidence) and is the precondition for the rest.
   - The background disposition on the window's open path (section 3).
   - A task in a chat has no browser outside that chat's tab list: its first browser command creates a background tab in the chat, which becomes its tab. The private per-task target (`createTarget` keyed by task and session, hosted as a guest nobody lists) goes for chat tasks; the eval harness keeps its windowless target, and a task no chat owns keeps the old path until the 1.x task page is removed.
   - Orchestrator prompt: work on a new page is a task with the URL in its brief, which opens the page itself in the chat; `--tab <id>` is only for a page already open. `open` is for showing the user something, never a step in handing work over. When the user asks to watch, `open` runs first and `--tab` takes the id it printed in a later command, never the same one. The "open the page, then start the task on the tab, in one reply" line goes.
   - Refuse `tab`, `window` and `--new-tab` in the wrapper until phase 2 lands, since `tab new` currently navigates the task's one page, which may be the user's.
1b. **The orchestrator's `tab` command.** One noun for everything the chat's tab strip holds (pages, files, folders, app screens), singular like `task`, `chat`, `app` and `memory`, and the orchestrator's alone: tasks reach their own tabs through agent-browser. `open` is removed.
   - `tab open <url|path>...` opens a tab and shows it; `tab replace <id> <url|path>` changes what a tab shows; `tab close <id>...` closes tabs; `tab show <id>` brings an open tab forward rather than opening a second copy. The note on each message stays the listing, with each tab's id and, for a tab a running task holds, which task.
   - Explicit verbs on ids rather than a declared layout: a model reliably closes or replaces a named tab, and less reliably restates a whole window without dropping something.
   - A tab a running task holds can still be closed or replaced, since the user may ask for exactly that. The command says which task held it, and the task learns it on its next browser command as agent-browser's `tab_gone`, with the reason, never by acting on a page it did not expect.
   - The prompt: close only what the user asked to close or what the conversation itself opened; never replace a page mid sign-in or a file with unsaved edits; show a task's page only when the user asks to watch.
   - Evals: tidy up the tabs; show what a task produced; a follow-up about a page already open (`tab show` or a handover, not a second copy); close tabs a running task holds. Read for tabs opened twice, closed unasked, or shown unasked.
2. **Several tabs per task.** The bridge's task-scoped browser endpoint, the cap, pin-tab, `createTarget` through the window, and the handover (repeatable `--tab`, `task tab --add/--remove/--none`, `browserTabs` replacing `browserTargetId` with no read of the old field, `task show`, the orchestrator's multi-page guidance) land together, and the phase 1 refusal is deleted. Validate agent-browser's own `tab` surface against the endpoint end to end before the skill mentions it.
3. **Skill.** The rewritten tab guidance, plus dropping the rule that links are followed by opening a URL from `snapshot -i --urls` (SKILL.md, "one page target" paragraph): it dates from `_blank` links going nowhere, which [blank-target-links-are-dead-clicks](../../findings/blank-target-links-are-dead-clicks.md) fixed, and it is why agents type URLs instead of clicking. Supersede the 2026-08-04 registry decision. Then the evals below.
4. **Visible cursor.** Upstream option first, bridge-installed overlay only if upstream declines; human input mode if the timing holds. No failure depends on it, so it follows the work that has one.

When this lands, the three superseded plans move to `completed/` with a `Status:` line pointing here.

## Evidence

Two orchestrator runs on beta.31, both `auto` served by gpt-6-luna:

- **Three pages, one color each.** `open` with three URLs in one command, then three `task new --tab <id>` in the next. Each task ran `get url` and one `eval`, 13 to 17 seconds, no errors. The fan-out works when the order is right.
- **Jar, then five linked pages.** `open` and `task new` in the same bash command, so the brief was written before the tab id existed ("tab id will be provided by the open command") and `--tab` was never passed. The task got a private browser outside the tab list, spent a step on `agent-browser --help`, opened Jar where the user could not see it, and stopped, saying it had no tab. A retry with `--tab` worked in 22 seconds, following links by typing each URL rather than clicking. Under phase 1 the first task alone would have succeeded, visibly, as a tab in the chat.

## Validation

Unit tests show that the bridge answers correctly, not that models use tabs well. Per [validate-changes](../../../.agents/skills/validate-changes/SKILL.md):

- **Regression:** the existing single-page browser evals before and after phase 2, across models. The single-tab path should be command for command identical.
- **New tasks:** a handful that genuinely need several pages (compare two product pages, fill a form on one site from data on another, research across several results keeping each open). Read the transcripts for tab confusion: acting on the wrong tab, stale refs after a switch, opening tabs it never uses, closing a handed tab.
- **In the app, after phase 1:** "go to Wikipedia's Jar page, then five pages from there" becomes one task whose tab appears in the chat unselected, with no `open` from the orchestrator.
- **In the app, after phase 2:** a task handed three tabs by the orchestrator plus one it opens itself; all four listed in the chat, none brought forward, the cursor visible when the user selects one, the opened tab still there after the task finishes.

## Risks

- **Multiplexing debuggers on one connection** is where the bridge can go subtly wrong: an event tagged with the wrong session sends agent-browser's ref map to the wrong page. The per-tab gates must key on the session, not the connection.
- **Tab sprawl in the user's chat.** The cap bounds it per task; the skill asks for scratch tabs to be closed. Watch the evals for models that open a tab per link.
- **Human input mode slows every click.** Measure before defaulting it on.
- **Holding is not exclusive.** Two tasks on one tab overwrite each other's work. The warning makes it visible; the orchestrator's prompt is what prevents it.

## Open questions

- Should a finished task's opened tabs be marked in the list as what it left behind, or look like any other tab?
- Does `task tab --remove` on a tab the task opened close it, or just stop holding it? Leaning: stop holding, leave it open, same as finishing.
