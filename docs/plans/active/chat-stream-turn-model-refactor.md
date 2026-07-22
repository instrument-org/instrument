# Plan: chat stream turn-model refactor

Status: proposed, not started. Prompted by the MessageScroller adoption, which wants clean per-turn rows, and by upcoming work to collapse tool/reasoning activity between assistant runs. Do this as a fast-follow to the scroller work, not folded into it.

---

## Background / why

`chat-stream.tsx` renders the transcript by flattening every message _and every part_ into a single `chatElements` array in one large `useMemo` loop, then special-casing structure inline as it goes:

- tool-run boundaries that span message boundaries (`toolBoundaryMap`),
- per-message chrome (assistant logo/wordmark, attachments, project-context note, error rows),
- consecutive-assistant grouping for the footer (`lastFooterIndex`, `visibleAssistantContentCount`),
- planning indicator and continue-button chrome appended after the loop.

It works, but it is hard to reason about and hard to extend. Every new concept (a new tool card, a new marker, collapsing) means threading more state through that one loop. It is also why the scroller integration is fragile: because the flattened output adds/removes several top-level nodes per turn as `isAgentRunning` flips, the streamed DOM churns in staggered mutations, and the library's "is this a new turn?" heuristic misfires. We currently work around that with an explicit anchor call; a cleaner structure removes the need.

## Proposed architecture

Adopt the shape most mature chat renderers converge on: **raw items → derived render groups → one row per turn.** Three stages, each pure and independently testable.

1. **Raw source of truth: `turn.items[]`.** Keep the message/part data as the source of truth. An `item` is a discriminated union on `.type` (`user-message`, `assistant-message`, `reasoning`, `tool-call`, `web-search`, `error`, `context`, …). Streaming deltas mutate this array (append while in-progress, upsert-by-id otherwise). Nothing else is hand-maintained.

2. **Pure `deriveRenderGroups(items)`.** A memoized function folds items into heterogeneous _units_ with a second discriminator `.kind` (`entry`, `tool-group`, `collapsed-activity`, …). The two current headaches become generic folds here instead of ad-hoc loop state:
   - "consecutive assistant grouping" → merge-consecutive-same-kind,
   - "tool-run boundaries" → find the `assistant-message` indices and treat each gap between them as one collapsible activity slice. Activity before the first assistant message and after the last is the same slice shape (a leading/trailing gap), so no item is dropped; derivation tests cover both edges as well as the middle.

3. **Render = one row per turn, unit → component registry.** Replace the giant inline branch with a `kind → component` map. Each turn is one stable row (one `MessageScrollerItem`, keyed by turn id); units inside it are keyed by `type:id`. The data pipeline and the React tree stay decoupled: rows are thin.

### Collapsing (the upcoming work this unlocks)

- Model "collapse the activity between two assistant messages" as a single `collapsed-activity` unit carrying a `summary` counts struct (commands run, files edited, searches, tool calls, and their `running*` variants). The live slice stays expanded while its turn is in progress; closed slices collapse to the summary row. This one unit replaces the per-message footer/logo bookkeeping.
- Add an orthogonal, persisted `detailLevel` enum (e.g. `prose` / `commands` / `execution`) as an **input to the derive step**, not a branch inside renderers, so how aggressively we collapse is one knob.
- Collapse long text bodies by **measurement** (`scrollHeight` vs `lineCount × lineHeight` → `collapsed | expanded | uncollapsible`) rather than a hardcoded truncation rule, which suits our rich markdown/code content.

## Why now

- **Fixes the scroller fragility at the root.** Stable per-turn rows whose innards change without adding/removing top-level nodes let the scroller's native new-turn anchoring work. We already dropped the explicit per-turn anchor (verified live); before leaning harder on native anchoring, lock the behavior down with scroll regression tests: initial bottom positioning, streaming follow, release after the user scrolls up, and rapid session changes. The "anchor the new turn near the top, then follow as it reaches the bottom" behavior also becomes tractable once the transcript stops churning on every turn.
- **It is the natural home for the collapsing roadmap.** The `collapsed-activity` unit + `detailLevel` is exactly the model that upcoming between-run collapsing needs, and it is much cheaper to build on a clean pipeline than to bolt onto the current loop.

## Non-goals

- **No custom virtualization.** MessageScroller already owns scrolling and anchoring and stays fast into the thousands of turns. Keep the data pipeline; do not build a virtualizer.
- Not a visual redesign. Rows should render the same components they render today; this is a structural refactor of how we get from data to elements.

## Suggested migration path (incremental)

1. Introduce the `turn` / `item` / `unit` types and a pure `deriveRenderGroups` next to the current renderer. Unit-test it against the existing `presetSessions` fixtures with `toMatchInlineSnapshot`.
2. Swap `ChatStream`'s inner loop to render `units` via the `kind → component` registry, one `MessageScrollerItem` per turn. Delete the flatten / tool-boundary / footer special-casing. Verify against the same fixtures and the debug chat-stream route.
3. Layer collapsing + `detailLevel` onto the unit model.

## Open questions

- Where does the turn boundary come from — do we synthesize `turn` objects from the existing message stream, or is there a better upstream source in the session store?
- How do reasoning and multi-agent/sub-agent streams (nested `ChatStream`) fit the unit model — a nested pipeline, or a dedicated unit kind?
- Persisted `detailLevel`: per-task, per-session, or global setting?
