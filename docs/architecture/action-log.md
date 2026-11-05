# The action log

The action log is what the person did in Instrument: folders and files opened, edits saved, files moved, copied, renamed or trashed, other chats read, pages visited and files downloaded in the app's browser, settings changed, failed app sign-ins, and errors the app showed them. Only what happens in Instrument is recorded. Nothing the person does in another app is, and nothing about what a page or file says.

It has three readers: the chat's agent, so "put them back" or "the weather there" resolves without the person attaching anything; a feedback report, when the person leaves its row on; and a developer debugging the app, who reads the same files beside the dev log.

## The files

One JSON line per action, a file per local day, in the workspace's machine folder: `<userData>/machine/<local id>/actions/<YYYY-MM-DD>.jsonl` ([log.ts](../../packages/workspace/src/lib/actions/log.ts)). The machine folder never travels with the workspace, since what one computer's person did means nothing on another, and the agent's shell cannot reach it.

```jsonl
{"kind":"folder","path":"/Users/mac-user/Downloads","selected":["invoice-0931.pdf"],"at":"2026-11-05T20:02:11.120Z"}
{"kind":"move","from":"/Users/mac-user/Downloads","to":"/Users/mac-user/Documents/Archive/2023","names":["invoice-0931.pdf"],"at":"2026-11-05T20:03:40.004Z"}
```

The kinds are in [schema.ts](../../packages/workspace/src/lib/actions/schema.ts). A field is a place's own name or path as the person sees it, never content.

`ActionLog` writes a line as it happens, with the day's file held open: a two-second batch would catch about one event at real rates and keep the newest one from a message sent right after it. It is bounded so a capture point stuck in a loop cannot fill the disk: a repeat of the line before within a minute is skipped, a kind writes at most 60 lines a minute, a day at most 2 MB, and the folder keeps 14 days and 32 MB, swept when a day's file opens. What a cap leaves out is written as a `capped` line. Measured on an M5 Max, a line costs 2 to 3 µs, a heavy day of 3,000 actions is about 470 KB, and reading the last 30 minutes of it about a millisecond.

## Capture

Everything goes through `recordPersonAction` in Studio's main process ([actions.ts](../../apps/studio/src/electron-main/lib/actions.ts)), which calls the workspace's `recordAction` and, in a dev build, writes the same action to the dev log with scope `Actions`.

- **File actions and saves**: the RPC interceptor beside `breadcrumbRPC` maps a successful call of an allowlisted route to its action ([person-actions.ts](../../apps/studio/src/electron-main/rpc/person-actions.ts)): rename, move, copy, duplicate, trash, new folder, a save (`files.write`) and opening a file in another app. These routes are called only from the person's own window.
- **Pages and downloads**: the history recorder reports the person's own visits, never an agent's, once a page has a title or finished loading ([history-recorder.ts](../../apps/studio/src/electron-main/browser-view/history-recorder.ts)); a download the person saved is recorded where it landed, its address without its query ([downloads.ts](../../apps/studio/src/electron-main/browser-view/downloads.ts)).
- **App sign-ins** that fail, from `settleConnection` ([app-connection.ts](../../apps/studio/src/electron-main/lib/app-connection.ts)), and **settings** the person changes, by label and value in words.
- **The window**, over one raw IPC channel rather than oRPC, which would fill the breadcrumb ring: the screen in front once it has settled for 1.5 s, a folder with its selection, a file, another chat, or one of the app's own screens ([screen-action.ts](../../apps/studio/src/client/components/window/screen-action.ts)); and each error or warning toast ([toast.tsx](../../apps/studio/src/client/lib/toast.tsx)). Main checks each report against the schema and takes only those kinds, only from the app window.

## What the chat's agent gets

Each message the person types in a chat's own session carries an `actions` part ([actions-part.ts](../../packages/workspace/src/lib/actions/actions-part.ts)): the kinds of things done since their last message there, at most 30 minutes back and eight rows, consecutive repeats merged, with no name, path, title or address. The chat's records store only that, so a synced chat and a report carry no names from the log. Its note ([actions-model-text.ts](../../packages/workspace/src/lib/actions-model-text.ts)) follows the note of what was on screen:

```
Background, not something they sent: what the user did in this app before this message, oldest first, without names. `instrument activity` gives the names and paths, for when their words point at one of these.
- 6m ago · moved 3 files
- 2m ago · read another chat
```

`instrument activity` ([activity.ts](../../packages/workspace/src/lib/capabilities/activity.ts)) lists the log with names and paths, for a chat and its tasks: `--since`, `--grep`, `--limit`, `--json`. A chat row names that chat's records folder, so the agent can open it. Why the note carries kinds and the command the names: [the decision](../decisions/2026-11-05-the-chat-hears-kinds-not-names.md).

The person's `shareActionsWithChats` preference, through `mayShareActions` on the workspace config, turns both off. The log is kept either way, for reports.

## Reports

The feedback dialog offers the 30 minutes before it opened as a row, "What you did in the app", the one row with a switch to leave it out, since it is about more than the chat or error being reported ([feedback-dialog.tsx](../../apps/studio/src/client/components/studio-modals/feedback-dialog.tsx)). It is sent as `diagnostics/actions.jsonl`, through the report's redactor like everything else ([problem-reports.ts](../../apps/studio/src/electron-main/lib/problem-reports.ts)).

## Checks

- `packages/workspace/evals/cases/activity-context.ts` scores what the agent does with the note and the command: the cases it should resolve, the ones it should leave alone, and the ones where the log points the wrong way.
- The log, the note's selection and words, the command's output, each capture point's mapping and the report row have unit tests beside them.
