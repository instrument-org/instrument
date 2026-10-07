# Plan: notices behind a bell in the window bar

Status: proposed, not started. The bell is the chosen direction; nothing is built.

Things the app needs a person to know about turn up in places nobody checks. Chats whose folders cannot be read are listed in Settings > Storage (FP-1333) and vanish from Chat without a word. Error reporting's default, "Prompt me" (FP-1322), needs somewhere to ask. This plan gives them one place: a bell in the window bar's right corner, with a count and a short list.

## The shape

- **A bell in `WindowCorner`** (`apps/studio/src/client/components/window/window-bar.tsx`), always present so the spot is learned before anything needs it. Quiet with nothing waiting; a brand count when something does. The bar stays the same width however many notices pile up.
- **One popover list, "Notices".** Each notice is a row: a kind icon, a title, one line, its own actions, and an x to dismiss. Rows that ask for an answer sit above rows that only inform. A few rows, not a history.
- **The list explains; the fix lives where it already does.** A row's action opens the place that owns the problem (Settings > Storage for damaged chats), so the bell never grows its own trash button or settings.
- **Dismissed stays dismissed, until something new.** Dismissal is remembered per item, so a dismissed set of damaged chats does not come back, but a new one raises the bell again and its row says what is new ("1 more chat can't be opened").
- **Windows:** the bell and Update sit just inside the minimize, maximize and close buttons (`window-controls.tsx`), and the list hangs from the bell rather than from the window's edge.

Rejected: a pill per notice beside Update. Four at once ate the room of two tabs, had no stable order, and read as rough.

## What stays out

- **Update** keeps its own pill outside the bell (`UpdateStatusIndicator`). Missing an update is too costly to risk it sitting behind the same count as everything else.
- **Usage limits** (FP-1320's warnings near a limit) probably stay out too, though that is not settled.
- **Unread chats** stay the inbox's dots. Counting them in the bell as well would make it a second inbox.

## What goes in

Settled enough to build first:

- **Chats that can't be opened.** `storage.invalidFolders.list` already reports them with a reason. Raise a row when the scan finds folders the person has not dismissed; Review opens Settings > Storage, and trashing there clears the row.
- **Error reports**, when reporting is set to Prompt me (FP-1322). The row asks; Send report opens a sheet showing exactly what is sent, with a "send without asking" checkbox that is the Always setting. Dismissing does not lose the report: Settings lists recent reports, sent or not, beside the Ask me / Always / Never choice, so one can be sent later. In developer mode the same sheet carries the stack, which replaces the red dev-only count (`ServerExceptionsIndicator`). What a report carries and how it is sanitized is [privacy-first-diagnostics-and-feedback.md](privacy-first-diagnostics-and-feedback.md)'s to decide; this plan only covers where it asks.

Speculative, to try:

- **Chats that finished or need you, while the inbox is off screen** (in Files, Browser, Apps). A chat waiting on an answer and one that just finished each get a row; opening the chat clears it. Back in Chat the inbox's dots carry it. The colors (amber for needs you, brand green for finished, following the inbox's dots) are a first guess to experiment with.
- **Providers that stopped working.** `gateway.models.list` returns `errors` per provider config, which today surface only inside the model picker's panel when someone opens it. A provider whose key was revoked or whose list fails to load is a candidate row, opening Settings > Providers.
- **Apps that lost their connection.** A connected app whose OAuth grant fails (a revoked refresh token, `packages/workspace/src/lib/apps/mcp/oauth-provider.ts`) currently fails at the next call. A row could say so before the agent trips on it.
- **A signed-out ChatGPT account**, if the plan's token stops refreshing.
- **What's new in the product**, rarely if ever. Easy to abuse, so only with care.

The test for a candidate: something the person would want to know about, that is not visible where they are, and that has a place to go fix it.

## Open questions

- Where dismissals are stored (app preferences or the workspace) and what identifies "the same" notice: a folder name, an error's fingerprint, a provider config id.
- Whether the error-report history belongs under General or its own section, and how long it keeps reports.
- Whether a notice ever raises anything louder than the count (a first-boot modal for errors was floated in FP-1322).
