# Immutable session context and append-only corrections

Status: Proposed, not started.

## Problem

The harness stores the system prompt and its initial contextual companion as `session-context` messages, but `prepareModelMessages` deletes and rebuilds both after 60 minutes. The replacement can change the current date, attached folders, task tree, project context, browser guidance, and any other text assembled by the agent. Replacing an early message invalidates the cached prefix that follows it even when most of those bytes did not change.

The `load_skill` tool description also discovers and renders the current skill catalog for every request. A skill addition, edit, removal, discovery-order change, or catalog-budget change therefore changes a tool definition near the front of the request and invalidates the conversation prefix after the tool definitions.

The one-hour threshold is not a safe proxy for cache expiry. An active or intermittent session can still have reusable cached prefixes when it crosses that threshold.

## Goals

- Make the initial session context immutable for the lifetime of a session.
- Represent facts that become stale as append-only corrections on later user turns.
- Keep tool definitions byte-stable unless the harness capability itself changes.
- Reuse existing task, project, folder, browser, and workspace-skill tracking.
- Preserve compatibility with persisted sessions and in-progress tasks.
- Keep the current in-memory provider cache policy. Do not request 24-hour retention.

## Non-goals

- Watch or diff third-party skill directories.
- Refresh every dynamic fact on every turn.
- Keep the initial task tree continuously synchronized.
- Add provider routing affinity or explicit provider-specific cache breakpoints in this work.
- Guarantee a provider cache hit. This plan only removes avoidable byte changes in the request prefix.

## Current mechanisms to preserve

- `prepareModelMessages` persists two `session-context` messages and puts them before conversation history.
- User turns already render uploaded files, attached-folder changes, browser status, open pane tabs, project changes, skill mentions, and intent as contextual text parts.
- A max-step note is already carried from an assistant data part to the next user message. This is the precedent for delivering a persisted assistant-side delta without rewriting history.
- `workspace-skill-index` snapshots only the writable workspace skill directory for an agent turn and reports packages that the turn created, updated, or removed.
- `mainAgent.onFinish` already saves created and updated workspace skill names as `data-skillChanges` on the turn's last assistant message for the UI.

## Proposed message model

### Immutable baseline

Create the two `session-context` messages once, when a session first needs model input, and reuse their stored bytes thereafter. Remove the 60-minute stale-message deletion and regeneration path from `prepareModelMessages`.

The baseline should remain a startup snapshot. Its system-information date, project context, attached folders, and task layout describe the session's initial state. Text in the baseline must say when a value is a snapshot and point the model to later corrections when applicable.

Persisted sessions that already have context messages need no migration. A session with no context messages creates them once under the existing path. If an older build already replaced them, the messages present when the new behavior first runs become that session's immutable baseline.

### Append-only corrections

Facts that matter after the baseline are recorded where the change occurs and rendered after the affected conversation history. A correction states only the changed fact and explicitly supersedes the corresponding baseline fact. It never edits or removes an earlier message.

Corrections must be persisted, deterministic to render, and delivered at most once as new information. Rebuilding a request from stored messages must reproduce the same bytes. Process-local timers and reads of live state during model-message conversion are not valid correction sources.

Existing data parts remain the canonical sources for project, attached-folder, browser, and external-file changes. The implementation should not consolidate them into a regenerated context blob.

### Skill catalog

Move the budgeted `<available_skills>` catalog out of the `load_skill` description and into the initial contextual message. Keep the tool description static and teach it to consult the catalog in context, accept a qualified skill name, and return the current budgeted catalog on a not-found result as it does today.

Use the existing `data-skillChanges` part to tell the model about workspace skills created or updated by the agent. During `SessionMessage.toModelMessages`, carry the latest pending skill-change part from an assistant message into the next user message, following the max-step-note pattern. Render only the recorded names and tell the model to call `load_skill` for current instructions. Do not rescan or embed the full catalog in the delta.

Do not add watchers or snapshotting for Claude, Codex, Cursor, registry, system, or other third-party skill locations. Changes outside the existing writable workspace-skill tracking remain visible on a later not-found response or in a new session's baseline catalog.

Skill removals remain outside the first implementation because `data-skillChanges` deliberately persists only created and updated names. Supporting removals later requires an explicit product decision about UI data, model behavior, and persisted schema compatibility. It should not be inferred from a new broad scan.

### Date rollover

Store the baseline's calendar date in persisted context metadata or a dedicated data part. On the first real user turn observed on a different local date, append one deterministic date-correction part. Do not rebuild system information and do not add an hourly timer. Further turns on that date reuse the persisted correction.

This date correction can be a follow-up phase. Removing timed context replacement is valuable independently because the current prompt already describes the task tree as an initial snapshot and other mutable facts have explicit change channels.

## Implementation phases

1. Remove timed replacement from `prepareModelMessages`. Add tests proving stored session-context message IDs and model-visible bytes remain unchanged after the former 60-minute threshold and across process-style reconstruction from the store.
2. Split skill guidance from discovery output. Render the current budgeted catalog once in `mainAgent.getMessages`, make the `load_skill` description static, and retain the not-found catalog for recovery.
3. Add model rendering for existing `data-skillChanges`. Carry each persisted assistant-side delta to the next user turn once, preserve user-message fencing, and test multiple changes, replay, and a session ending before another user turn.
4. Add a persisted date-rollover correction without timers or baseline mutation.
5. Add byte-stability regression coverage over the serialized system messages, tool definitions, and historical tool results for two identical reconstructions of one stored session.

## Acceptance criteria

- Crossing 60 minutes without a relevant persisted correction changes no previously sent message or tool-definition bytes.
- Reconstructing the same persisted session twice produces identical model input through the end of stored history.
- Installing or editing a workspace skill does not change the `load_skill` definition.
- The next user turn after a recorded workspace-skill change names the changed skills and recommends loading current instructions.
- No new code watches or scans third-party skill locations between turns.
- Existing project, folder, browser, file-change, skill-mention, and max-step behavior remains intact.
- No provider option requests 24-hour cache retention.

## Risks and decisions needed before implementation

- Context compaction must retain the baseline and any still-relevant corrections, or produce a new immutable compacted baseline with an explicit boundary. Compaction must not silently rewrite the prefix of an active un-compacted session.
- A correction carried onto the next user turn is naturally ordered and cache-friendly, but the implementation must define what happens when multiple assistant turns precede that user turn.
- Moving the skill catalog changes its relative position from the tool-definition block to the contextual message. Validate skill selection across representative models before removing the dynamic description.
- Decide whether the initial skill catalog belongs in the system-role context or the contextual user-role message. The current contextual user message is the narrower change and keeps the core system prompt common across users.

## Recommended approval boundary

Approve phases 1 through 3 together. They remove the known timed invalidation, make `load_skill` static, and use only the skill tracking already in production. Treat date rollover and compaction behavior as explicit follow-ups if their persistence design would expand the first change.
