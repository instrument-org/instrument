# The action log

What the person did in Instrument: folders and files opened, edits saved, files moved, copied, renamed or trashed, other chats opened, pages visited and files downloaded in the app's browser, settings changed, apps signed in to or disconnected, updates installed, folders and apps allowed or refused a chat, and errors the app showed them. Only what happens in Instrument is kept. Nothing the person does in another app is, and nothing about what a page or file says.

It has four readers: the person, in Activity; the chat's agent, so "put them back" or "the weather there" resolves without the person attaching anything; a feedback report, when the person leaves its row on; and a developer debugging the app, who reads the same files beside the dev log.

## The records

Each fact is kept once, in one of three places, all on this computer, and every reader puts them together ([read.ts](../../packages/workspace/src/lib/actions/read.ts)) into one model, the `Action` union ([schema.ts](../../packages/workspace/src/lib/actions/schema.ts)). A field is a place's own name or path as the person sees it, never content.

- **The action log**, for what nothing else keeps: one JSON line per action, a file per local day, in the workspace's machine folder, `<userData>/machine/<local id>/actions/<YYYY-MM-DD>.jsonl` ([log.ts](../../packages/workspace/src/lib/actions/log.ts)). Its lines are `LoggedActionSchema`, which leaves out the kinds the other two keep; a line of one of those does not parse and is skipped.
- **The app's history**, `browser/history.db` in the same machine folder ([history-store.ts](../../apps/studio/src/electron-main/browser-view/history-store.ts)), for the pages the person visited and the files they opened. Its `visits` count only the person's own visible ones (`VISIBLE`: their visits, none an agent made, none hidden as a redirect, an error or a sign-in), and its `file_opens` say whether a file opened in one of the app's tabs or went to another app, and which, in `app`. The browser's download list, `downloads.json` beside it, keeps the files the person downloaded. The workspace reads both through `readPersonHistory` on its config, which Studio answers from the two ([person-history.ts](../../apps/studio/src/electron-main/browser-view/person-history.ts)), so the workspace never imports them.
- **The chats' permissions**, `permissions.json` in the same machine folder ([rules.ts](../../packages/workspace/src/lib/permissions/rules.ts)), for the folders and Mac apps the person allowed a chat to use from its card, or refused it: each chat's folder grants from a card, its app grants and its denials, at their `grantedAt` and `deniedAt`. A file sent with a message is a grant too, and no answer, so it is left out. The chat is named by its title as the chat list shows it, and a grant taken back is gone from Activity with it.

The machine folder never travels with the workspace, since what one computer's person did means nothing on another, and the agent's shell cannot reach it.

```jsonl
{"kind":"folder","path":"/Users/mac-user/Downloads","selected":["invoice-0931.pdf"],"at":"2026-11-05T20:02:11.120Z"}
{"kind":"move","from":"/Users/mac-user/Downloads","to":"/Users/mac-user/Documents/Archive/2023","names":["invoice-0931.pdf"],"at":"2026-11-05T20:03:40.004Z"}
```

`ActionLog` writes a line as it happens, with the day's file held open: a two-second batch would catch about one event at real rates and keep the newest one from a message sent right after it. It is bounded so a capture point stuck in a loop cannot fill the disk: a repeat of the line before within a minute is skipped, a kind writes at most 60 lines a minute, a day at most 2 MB, and the folder at most 32 MB, the oldest days going first when a day's file opens. Nothing expires by age. What a cap leaves out is written as a `capped` line. Measured on an M5 Max, a line costs 2 to 3 µs, a heavy day of 3,000 actions is about 470 KB, and reading the last 30 minutes of it about a millisecond.

`history.db` has no such settle or cap: the file screen writes a file open each time a file comes up in the tab in front, so stepping through a folder with the arrow keys, one press at a time, writes one for each file it lands on. Held down, the arrows show only the file they stop on.

## Capture

What goes in the action log goes through `recordPersonAction` in Studio's main process ([actions.ts](../../apps/studio/src/electron-main/lib/actions.ts)), which calls the workspace's `recordAction` and, in a dev build, writes the same action to the dev log with scope `Actions`. App sign-ins are the exception, below.

- **File actions and saves**: the RPC interceptor beside `breadcrumbRPC` maps a successful call of an allowlisted route to its action ([person-actions.ts](../../apps/studio/src/electron-main/rpc/person-actions.ts)): rename, move, copy, duplicate, trash, new folder and a save (`files.write`). These routes are called only from the person's own window.
- **App sign-ins** that go through or fail are recorded by the workspace's `appChanged` ([changed.ts](../../packages/workspace/src/lib/apps/changed.ts)), where the chat already hears of them under the app's own name. A **disconnect** is recorded by Studio's `apps.disconnect` route, the person's own, by the app's name, since the agent can disconnect an app through the same `disconnectApp`.
- **An update installed**: the launch compares the running version with the machine's `lastLaunchedVersion` (`checkRecentVersionBump`), and any difference is recorded once, in the first workspace to start.
- **Settings** the person changes, by label and value in words.
- **The window**, over one raw IPC channel rather than oRPC, which would fill the breadcrumb ring: the screen in front once it has settled for 1.5 s, a folder with its selection, another chat, or one of the app's own screens ([screen-action.ts](../../apps/studio/src/client/components/window/screen-action.ts)); and each error or warning toast ([toast.tsx](../../apps/studio/src/client/lib/toast.tsx)). Main checks each report against the log's schema and takes only those kinds, only from the app window.

Pages and files are written to `history.db` by the history recorder, for the person's own visits and an agent's alike ([history-recorder.ts](../../apps/studio/src/electron-main/browser-view/history-recorder.ts)), and by `recordFileOpen`, from the file screen and the routes that hand a file to another app. A download the person saves goes on the browser's download list, which keeps the last 1,000 finished and shows the newest 100 in its popover; Activity reads it as where the file landed and the address it came from without its query ([download-list.ts](../../apps/studio/src/electron-main/browser-view/download-list.ts)). Permission answers are written to `permissions.json` where the ask is taken. None of them writes the action log.

## What the chat's agent gets

Each message the person types in a chat's own session carries an `actions` part ([actions-part.ts](../../packages/workspace/src/lib/actions/actions-part.ts)): the kinds of things done since their last message there, at most 30 minutes back and eight rows, consecutive repeats merged, with no name, path, title or address. A row's kind is the action's own, or for an app or a permission what was done with it (`app-signed-in`, `permission-refused-folder`). Reading the chat the message is in, what a cap left out, and the app's own screens are left out. The chat's records store only that, so a synced chat and a report carry no names from the record. Its note ([actions-model-text.ts](../../packages/workspace/src/model-text/notes/actions-model-text.ts)) follows the note of what was on screen:

```
Background, not something they sent: what the user did in this app before this message, oldest first, without names. `instrument activity` gives the names and paths, for when their words point at one of these.
- 6m ago · moved 3 files
- 2m ago · read another chat
```

`instrument activity` ([activity.ts](../../packages/workspace/src/lib/capabilities/activity.ts)) lists the record with names and paths, for a chat and its tasks: `--since`, `--grep`, `--limit`, `--json`. A chat row names that chat's records folder, so the agent can open it. Why the note carries kinds and the command the names: [the decision](../decisions/2026-11-05-the-chat-hears-kinds-not-names.md).

The command also lists the AI requests chats made among what the person did, a chat turn to a row: the chat by its title and records folder, the purpose, the models, how many requests, how long from the first to the end of the last, and each error a request failed with. Requests gather into turns by `gatherTurns` ([turns.ts](../../packages/workspace/src/lib/activity/turns.ts)), the rule Activity uses too: one chat and session while each request follows the next within five minutes with nothing the person did in between, a chat's own request with no session (naming it) joining the turn it came in.

The person's `shareActionsWithChats` preference, through `mayShareActions` on the workspace config, turns both the note and the command off. The record is kept either way, for the person and for reports.

## Keeping a history

The person's `keepHistory` preference ("Keep a history" in Settings › Activity) stops every writer at once, through `mayKeepHistory` on the workspace config and `keepsHistory()` in Studio: the action log (`recordAction`), the history's visits (the tab recorder's `keeping`), its file opens (`recordFileOpen`), and the AI request log (`insertActivity`). What is already kept stays unless the person ticks the stop dialog's box, which clears it all. The address field's suggestions and Files › Recents stop moving with it, since they read the same history. The download list keeps working, as the browser's own list of files saved, so a download made while the history is off still shows in Activity.

## Activity

Activity is a screen of its own, `/activity` ([activity-page.tsx](../../apps/studio/src/client/components/activity/activity-page.tsx)), opened from the clock button beside the bell (which turns a new tab into Activity rather than opening another), from Activity in the command menu when searched for, from Show Activity (⌘Y, Ctrl+H elsewhere) in the History menu, and from the browser's History submenu, which opens it at `?show=pages`. Its filter (`show`: pages, files, chats or AI requests) and search (`q`) are its address, each change replacing it, so a link can open it narrowed and Back skips the typing. On Activity the clock button goes back to its start. It lists the person's activity and the AI requests chats made in one timeline, newest first, a card per day and a line per thing. Each log is paged on its own (`actions.list`, which reads the three records newest first only as far as the page reaches, and the workspace's `activity.list`), both read up to when the page opened, and the list shows only as far back as the one that has loaded least, so a later page never lands above a row already shown ([activity-timeline.ts](../../apps/studio/src/client/components/activity/activity-timeline.ts)). What happened since is read on its own every five seconds while the tab is up, and goes on top. The filter and search narrow what is loaded, and the list reads further while it is short. The requests of one turn are one row.

A row names its thing and what was done with it on one line, with a page's icon, a file's by its kind, or the chat's mark for an AI row, whose model wears its maker's mark. A click shows its details in a card beside the list ([activity-details.tsx](../../apps/studio/src/client/components/activity/activity-details.tsx)), drawn as Files' Info card is: a file or folder shows Files' own Info about it (`PathInfo`), other rows their facts in the same rows, then the other times it was opened (`activity.openings`), and for an AI row its requests, each opening what was recorded about it. Open goes where the row's place is: Files for a file or folder, Settings at the setting changed, the release notes for an update. A double click opens it, and its menu (⋮ or a right click) opens it elsewhere, searches More from its site, folder or chat, and removes it. Rows ticked are removed together. Removing (`activity.remove`) takes a page's visits or a file's opens with the repeats the row stood for, a download off the download list, a line from the action log, and the AI requests this computer made; a permission answered is the chat's rule and stays.

The page's ⋮ has Clear activity…, Export CSV of what the filter shows (both in one file for All, [activity-csv.ts](../../apps/studio/src/electron-main/lib/activity-csv.ts)), and Activity settings, which opens Settings › Activity: Keep a history, Chats can see this, and Clear activity ([activity-section.tsx](../../apps/studio/src/client/components/settings/activity-section.tsx)).

## Clearing

Clear activity… opens a dialog modeled on Clear browsing data ([clear-activity-dialog.tsx](../../apps/studio/src/client/components/activity/clear-activity-dialog.tsx)): a time range from the browsing-data ranges, and two boxes, each with how much the range holds, from `activity.summary` ([activity.ts](../../apps/studio/src/electron-main/rpc/routes/activity.ts)).

- **What you did in Instrument** clears the range from all three records but the permissions, which are rules rather than history and stay until the person changes them in Settings › Permissions: the action log (`ActionLog.clear(since)`, which deletes the days wholly in the range and writes the day it starts in again with its earlier lines, synchronously so no action recorded meanwhile lands in a file being taken away), the history's visits (`clear(since)`, which takes the address field's suggestions with them), its file opens (`clearFileOpens(since)`, which takes Files › Recents) and the download list's finished downloads (`clearDownloads(since)`, which takes them off the downloads popover).
- **AI requests** clears only this computer's requests (`clearOwnActivity`, [store.ts](../../packages/workspace/src/lib/activity/store.ts)): it writes this device's month files in the workspace again without them and deletes their rows from `workspace.db`, forgetting how far it read those files so the index reads them afresh. Another device's files are that device's alone to write and stay as they are.

## Reports

The feedback dialog offers the 30 minutes before it opened as a row, "Your activity", the one row with a switch to leave it out, since it is about more than the chat or error being reported ([feedback-dialog.tsx](../../apps/studio/src/client/components/studio-modals/feedback-dialog.tsx)). It is sent as `diagnostics/actions.jsonl`, the three records together, through the report's redactor like everything else ([problem-reports.ts](../../apps/studio/src/electron-main/lib/problem-reports.ts)).

## Checks

- `packages/workspace/evals/cases/activity-context.ts` scores what the agent does with the note and the command: the cases it should resolve, the ones it should leave alone, and the ones where the record points the wrong way. Its pages and files are seeded into a history the harness answers `readPersonHistory` from.
- `packages/workspace/evals/cases/ai-requests.ts` asks about the requests behind a chat: why an answer was slow, why another chat failed, which model answered.
- The log, the merged reader, clearing each record, the note's selection and words, the command's output, each capture point's mapping, the rows' words and the report row have unit tests beside them.
