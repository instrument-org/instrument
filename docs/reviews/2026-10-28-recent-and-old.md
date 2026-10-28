# Recent work after the 10-27 review, old code, and churned code

Reviewed: `a6c1e8986..dedc15400` (74 commits), plus a snapshot at `dedc15400` of code last changed before 2026-10-01

Three blind readers, following `REVIEW.md`: one on the commits since the 10-27 review; one on source files last touched before October, ranked by risk (containment, file I/O on the person's data, privacy, the preload boundary, the AI gateway), looking for old code whose assumptions the 2.0 layout broke; one on the files with the most commits in the last 45 days, reading their history for recurring fixes a different structure would rule out. Every finding below was re-read at `dedc15400` by the reviewer who wrote this file and checked against `docs/decisions/`, the earlier files here, and the trailers of the commits that introduced it; none reverses a record.

## Findings

### A. Clearing old tool calls removes an app guide the agent wrote, while the request gate still counts it as handed over

- Status: fixed
- Where: [tool-result-clearing.ts:548](/packages/workspace/src/lib/tool-result-clearing.ts#L548), [tool-result-clearing.ts:103](/packages/workspace/src/lib/tool-result-clearing.ts#L103), [tool-result-clearing.ts:389](/packages/workspace/src/lib/tool-result-clearing.ts#L389), [app.ts:746](/packages/workspace/src/lib/shell-commands/app.ts#L746)
- What: `isClearable` exempts a result whose output carries `appGuides` or `browserSkill`, but `withRecordedClearing` puts every call through the clearing into `callsThrough`, and `withToolResultsCleared` stubs the long string inputs of all of them. `app guide <slug> <<'EOF' … EOF` records its hand-off with no `printed` (the model "has it in its own command"), so once that command is cleared the guide's only copy is gone from what the model sees. `appGuideHandedOver` reads the stored messages, still finds the hand-off, and the next `app request` goes out without showing the guide. This breaks the module's own rule at `:31-35` that what carries instructions is never cleared.
- Verification: traced statically.
- Fix: leave the inputs of calls whose result is not clearable out of `callsThrough`.
- History: `cd3182e1e` (#172); the PR says it was not run in the app.

### B. A long single-line command output reaches the model as nothing, under a notice that says head and tail were shown

- Status: open
- Where: [truncate-buffer.ts:53](/packages/workspace/src/lib/truncate-buffer.ts#L53), [bash.ts:544](/packages/workspace/src/tools/bash.ts#L544)
- What: `truncateMiddle` keeps whole lines only. A single line over the head budget (a `curl` of a JSON API, `cat` of a minified file) fits neither window, so the content is `[... 1 lines omitted ...]`, while `bashOutputText` prefixes `[Output truncated: showing first 10 KB and last 10 KB of …]`. The same happens to the head alone whenever the first line is over 10 KB. The spill file only partly helps, since `read_file` cuts each line at `MAX_LINE_LENGTH`.
- Verification: probe by the reader, an 84,791-character one-line JSON through the file at `dedc15400` gives `"[... 1 lines omitted ...]"`; the notice traced statically.
- Fix: when a window would be empty because of one oversized line, fill it with a byte slice (`utf8Prefix`/`utf8Suffix`), and build the notice from the bytes actually kept.
- History: `1cdc73c48` (2026-05-29); `guide-hand-off.ts:71` uses it too.

### C. Attachment names lose every non-ASCII character, in a folder the person opens

- Status: open
- Where: [sanitize-filename.ts:18](/packages/workspace/src/lib/sanitize-filename.ts#L18), [write-uploaded-attachments.ts:165](/packages/workspace/src/lib/write-uploaded-attachments.ts#L165)
- What: `会議メモ.pdf` and `Отчёт.xlsx` are stored as `file.pdf` and `file.xlsx` (then `file-1.pdf`), on disk in `Chats/<chat>/attachments/` and in the record, with the original name kept nowhere. Written when attachments were app-internal; they now sit in a folder the person browses.
- Verification: probe by the reader on those inputs.
- Fix: strip only path separators, control characters and Windows-reserved characters.
- History: `63425b8cc` (2026-02-19); the visible-folder callers came with `d1d6c1023`.

### D. On Linux every sandboxed command can make other tools' skill folders in the person's config

- Status: declined
- Where: [bwrap.ts:252](/packages/workspace/src/lib/native-sandbox/bwrap.ts#L252), [rules.ts:374](/packages/workspace/src/lib/permissions/rules.ts#L374)
- What: the loop that makes a system read-only folder inside a writable bind (meant for `Drafts/`) matches every `source: "system"` read-only rule, and the skill source roots are such rules. With `~/.config` allowed, each command `mkdir -p`s `~/.config/goose/skills`, `~/.config/opencode/skills` and the rest for tools the person never installed; with home allowed, `~/.claude/skills`, `~/.codex/skills` and so on.
- Verification: traced statically.
- Fix: limit the make-before-bind to the app's own layout folders. `7024f24c4`'s `Commits-to:` (a system read-only folder inside a writable bind is bound read-only whether or not it existed) still holds for those; skill roots that do not exist need no bind.
- History: `7024f24c4`, `Not-tested:` on the Linux test host.
- Declined because: the folders are empty and made only where the person already allowed the agent to write, so nothing is lost and no line in the threat model is crossed; the cost is clutter. Reopen if a tool treats an empty `skills/` folder as configuration, or if the person reports the folders.

### E. Deleting a skill that is not editable names the registry's folder

- Status: open
- Where: [delete-skill.ts:39](/packages/workspace/src/lib/delete-skill.ts#L39)
- What: the refusal says the skill "lives outside /skills" (`REGISTRY_FOLDER_NAMES.skills`), but editability is decided against the workspace's top-level `Skills/` (`SKILLS_FOLDER_NAME`). It also returns `TypedError.Parse` for a refusal.
- Verification: traced statically.
- Fix: name `SKILLS_FOLDER_NAME`.
- History: `29f7a3d27` (2026-07-24), before the folder moved to `Skills/` in `fc0ca921b`.

## Refactor candidates

From the churn reader; each sha cited was checked to exist and to say what it is cited for. None is a defect on its own.

### R1. The Files tab's place has three owners

- Where: [computer-page.tsx:424](/apps/studio/src/client/components/window/computer-page.tsx#L424), [file-system.tsx:1916](/apps/studio/src/client/components/extend/file-system.tsx#L1916), [files.tsx:7](/apps/studio/src/client/routes/_app/files.tsx#L7)
- What churns: the router address, ComputerPage's mirror of it, and FileSystem's own history stack drift apart on back, forward and arrivals. `846730374` (stale echo, back took two presses), `74c2cff8d` (steps kept no layout), `2b5e9c3e8` (an address with no `view` read as an arrival), `fde0a7dd3` (remount on arrival lost search), `e87f0362d` (Columns re-entry patched in the private stack). What holds it together today: `written`, `arrived`, `lastOnScreen` refs, an `openings` remount key, and two `setTimeout` writes.
- Proposed shape: a pure `nextStep(step, intent, looks) → { step, write: "push" | "replace" | "none" }`, in the style `7aa61df02` already chose for the Finder over XState; the address is the only owner, `view` is settled where an arrival comes in, FileSystem becomes controlled and reports intents.
- Size: about 150 lines plus tests; lands in three steps (extract with today's behavior, settle arrivals at entry, make FileSystem controlled).

### R2. Wakes have no single owner

- Where: [wake.ts:132](/packages/workspace/src/lib/chat/wake.ts#L132), [job-wake.ts:23](/packages/workspace/src/lib/chat/job-wake.ts#L23), [sign-in-wake.ts:17](/packages/workspace/src/lib/chat/sign-in-wake.ts#L17)
- What churns: each wake source carries its own debounce, pending count, stop handling and dedupe, fixed one copy at a time: `2adbeab10` (the job wake was not counted as on its way), `b89c43243` (note before model lookup, one path only), `acd5bcd99` (a double wake), `31a8c6e34` (a second pending map and stop set).
- Proposed shape: one `enqueueWake({ chatId, sessionId, part, key, debounceMs, stillNews })` per session (idle, debouncing, delivering), one delivery order, and one `hasWakeOnItsWay` for `chatStateOf`. Stops stay out of it, as `e1db8f3a6` rejected.
- Size: wake.ts and job-wake.ts shrink by about 350 lines for about 200 new; sources move one at a time.

### R3. "The chat settled" is re-derived by each listener

- Where: [chats.ts:297](/packages/workspace/src/lib/chat/chats.ts#L297), [retitle.ts:121](/packages/workspace/src/lib/chat/retitle.ts#L121), [agent-completion-notifications.ts:62](/apps/studio/src/electron-main/lib/agent-completion-notifications.ts#L62)
- What churns: unread, retitle and the completion notification each hear `session.done` and re-ask whether the chat works: `48ec69a28`, `2adbeab10`, `d0698ea34`, `0803aebde`.
- Proposed shape: `chats.ts` publishes `chat.settled` on the working-to-not-working edge, recomputed on `session.done` and `recordChanged`; the three listeners subscribe to it.
- Note: the reader also points to a settle with no `session.done`, a wake whose model lookup fails after its retries ([wake.ts:866](/packages/workspace/src/lib/chat/wake.ts#L866)), after which `onItsWay` only calls `recordChanged`, so unread, retitle and the notification never run. Not traced to the end; R3 would cover it either way.

Looked at and dismissed as feature growth or already restructured: `create-workspace-actor.ts` (layout moves; launch order is one list in `workspace-launch-sweeps.ts`), `machines/session.ts`, `app-window.tsx`, `_app/route.tsx`, `atoms/window.ts`, drafts and `prompt-input.tsx`, `command-menu.tsx`, Finder internals, `chat-stream.tsx`, `browser-view/manager.ts`, `create-bash-env.ts`, `shell-commands/app.ts`, `workspace-move.ts`.

## Not covered

- In the range: the task-waiting standing in `chat/standing.ts` and `chats.ts` (`60bb8e4f3`), the connect-app card (`64467ca10`), the rest of `22dee55fa` beyond `workspace-refusal.ts` and `dataless.ts`, the Excalidraw merge (`2838f1b7f`), the thumbnail queue (`f80616f3e`, `ee83cca0e`, `50ac48366`), the AI gateway's pricing parse in `cd3182e1e`; the live-region follow-up (`78d53f9ac`, `28ea8edfe`) skimmed.
- Old code: `page-editor-guest/editor/*` beyond the first 140 lines of `source.ts` (how page edits are spliced back into the person's HTML is the riskiest old code left unread), `image-preview`, `probe-media`, `background-output-buffer`, `ai-gateway/fetch-models/*`, `browser-view/{focus-guard,guest-surface,device-emulation}`, and the old renderer components and viewers.
