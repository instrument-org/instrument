# Drop the orchestrator's Activity screen

Date: 2026-09-19

Closes the open item in [plans/active/orchestrator-inbox.md](../plans/active/orchestrator-inbox.md) and the third piece of [plans/active/orchestrator-threads.md](../plans/active/orchestrator-threads.md).

## Context

Activity was one list across every thread of the 2.0 conversation: what the user asked, what the agent replied and did, tasks starting and ending, files handed over, apps and sites used, and what the window itself showed the user, newest first under day heads and gathered by thread. The workspace derived its entries on every read from the threads' messages (`orchestrator.activityLog.list`, with a live twin that re-read every thread whenever any of them changed) and stored nothing for it; the window merged in its own recents and visited pages, which it keeps for the omnibar anyway.

The screen never found a use. Its door in the window bar went in the inbox round, which left a tile on the new-tab page and the address. By then the inbox carried per thread the things Activity summarized across threads: where each stands, what it made and used, and the tasks it is working on. What remained was a flat re-listing of what the threads already say, with filters over it, on a screen nobody opened, in a prototype whose point is to test the inbox.

## Options weighed

**Keep it reachable by address only.** Take the tile off the new-tab page and leave the route. Rejected: a screen with no door is dead code that still has to be kept correct, and its tab kind, its location row, and its view note stay in every switch.

**Keep the log, hide the screen.** Leave `activityLog` in the RPC for a later surface. Rejected: nothing else reads it, the entries derive from the messages so nothing is lost by deleting the reader, and a route nobody calls is what gets stale.

**Delete it.** Chosen.

## Decision

- The Activity screen, its tile on the new-tab page, its tab kind and location row, the `activity` screen value in the view-context part, and the workspace's activity log and its two RPC routes are gone.
- The window's recents and visited pages stay: they feed the omnibar and predate Activity.
- A view-context part stored with `screen: "activity"` reads as an unknown part from here on, so a message sent while that screen was up loses its view note. Read and filtered rather than migrated, per [2026-08-11](2026-08-11-retired-parts-are-read-not-migrated.md).

## Why

The prototype's interface holds what is being tested and nothing beside it. Activity was not being tested, and what it captured did not earn its screen: every entry was already visible where it happened, and the record was only ever as good as the message parsing behind it. Since the log stored nothing, removing it costs no data and needs no cleanup; it ends the live re-reads of every thread the screen ran while open.

## What would change it

A real need for a cross-thread record, "what did Instrument do today" or a place to catch up after a day away. The entries derived from the threads' messages, so a log can be rebuilt from the same store without a migration; the rows' grammar and the day-and-thread grouping are in the history under `de8a25b08` and `18b55e1fe`.
