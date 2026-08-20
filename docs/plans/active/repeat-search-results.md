# Stop paying for the same search result twice

Status: **proposed, not started**. Owner: TBD. Depends on [context compaction](context-compaction.md) for the reason in "Interaction with rollover".

## Problem

A research session searches several times around one topic, and the backend ranks the same pages into more than one of those searches. Every repeat arrives as a full excerpt, is stored, and is replayed on every later turn.

Measured over one production research session that issued 13 searches:

- 178,640 characters of excerpt text, roughly 42,500 tokens, about half the window it ended up occupying.
- 43,055 of those characters, 24.1%, were byte-identical to text already in the window.
- 10 of 53 distinct URLs came back more than once. One repository README arrived four separate times, in four different searches.
- The queries that produced them were near-duplicates by construction: a bare topic query, a `site:` query against the vendor docs, and a `site:` query against the community forum all ranked the same pages.

This is the cheapest context in the window to recover, because nothing is lost by removing it. A [character budget](../completed/tool-result-context-budgets.md) shortens passages the model has not read yet; deduplication removes bytes it has already been shown.

## Goal

An excerpt whose URL has already been shown in this session does not spend the window a second time, and the model can still see that the source was ranked again.

### Success criteria

- A source URL repeated across searches contributes its excerpt text once.
- The repeat still appears in its search's ranking, with title, URL, and position intact. Rank is information the search is reporting, and dropping the row would hide that the page ranked twice.
- The model is told where the omitted text is, and the pointer is true at the moment it is read.
- Full output stays persisted. Only the model-visible form changes.
- No result message is dropped and no tool-call pairing breaks.
- Sessions recorded before the change benefit on replay.

## Where it can go

`WebSearch.toModelOutput` receives `{ input, output, toolCallId }` and nothing else, so a tool transform cannot see what an earlier search already showed. `SessionMessage.toModelMessages` hands parts to the AI SDK, which invokes `toModelOutput` per part, so there is no injection point inside that walk either.

The workable seam is a pass in [prepare-model-messages.ts](../../../packages/workspace/src/lib/prepare-model-messages.ts) over `SessionMessage.WithParts[]`, before `toModelMessages`. At that point a `web_search` part still carries structured `results.sources[]` with a `url` on each, so the pass can walk oldest to newest, track seen URLs, and hand `toModelOutput` a copied part whose repeat sources carry a pointer instead of a body. Copy, never mutate: the stored part is what the transcript and the UI read.

Doing it by re-parsing rendered text after `toModelMessages` is the wrong seam. The rendered form is inside a nonce-bounded block, and a pass that edits that text has to reproduce the boundary exactly or every message after it reads as quoted page content.

## Interaction with rollover

A pointer to an earlier excerpt is only true while the earlier excerpt is still being sent. [Context compaction](context-compaction.md) stops sending everything before a boundary, so a first occurrence can fall outside the window while the pointer to it stays behind. That turns a recoverable duplicate into content the model cannot reach at all.

So the seen-URL set has to be built from the messages that survive the rollover, not from every message in the session. This is the reason the two are sequenced: build this on top of a window whose contents are already decided, not beside it.

## The hazard this shares with the reverted aggregate

The pass runs on every replay, so an excerpt the model read whole on one turn becomes a pointer on a later one. Dropping the always-on per-step budget (`workspace: drop the always-on per-step tool-result budget`) named exactly that behavior as one of the three things that made a fixed budget not worth its cost, alongside a result the model had already quoted becoming unreachable.

Deduplication is a better trade than that budget was, because the removed bytes are still in the window under a different tool call rather than gone. It is not automatically an acceptable one. Whichever direction is taken has to be deliberate:

- Only deduplicate against occurrences that are still in the window, which is what the rollover interaction already forces.
- Keep the pointer specific enough to be followed: name the query or the position of the search that carried the full text, not just "shown earlier".
- Consider deduplicating only on the turn a search runs, freezing the result afterwards, so no replay ever shortens what the model has read. This costs the repair of existing sessions, which is a real loss and should be weighed rather than assumed away.

## Scope

Search excerpts only.

The same page can also enter the window through `web_fetch` and through `agent-browser`, and neither is in scope. A fetch is an explicit request for a page the agent decided it needs, so suppressing it would be overriding a deliberate act rather than removing an accident of ranking. Browser output arrives as command stdout with no structured URL attached to the text, so there is nothing to key on without parsing, and the agent frequently wants the same page again after acting on it. If a later audit shows repeat fetches are a real cost, that is its own finding with its own evidence.

## Validation

1. Unit tests over the pass: no repeats, one repeat, a repeat inside the same search, a repeat whose first occurrence is outside the rollover boundary, and a summary-shaped result that has no per-source text to omit.
2. Assert the rendered ranking still names every source, including deduplicated ones.
3. Assert the persisted parts are unchanged after a pass runs.
4. Replay a recorded session with known repeats and confirm the model-visible character count drops by the measured duplicate share.
5. Run the focused Workspace tests, then Workspace types and lint through Turbo.

## Related

- [Tool result context budgets](../completed/tool-result-context-budgets.md) bounds a single search. This removes what two searches paid for twice; the two are independent and compose.
- [Context compaction](context-compaction.md) decides which messages are in the window at all, which this pass has to read before it can be correct.
