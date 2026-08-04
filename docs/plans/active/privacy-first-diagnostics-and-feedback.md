# Plan: privacy-first diagnostics and feedback

Status: proposal, not started. Owner: TBD. Depends on [conversation-storage.md](conversation-storage.md) for the report payload; related to [user-chosen-working-folder.md](user-chosen-working-folder.md).

## Scope

Remove ambient telemetry from Studio. Replace it with a local diagnostics journal that never leaves the device, plus two user-invoked upload paths: a feedback report that can carry a conversation, and a sanitized crash report. Hosted API telemetry is out of scope but must not contradict the claim.

## The claim

| Tier | Sentence                                                                                          | Requires                                                                 | Cost                                              |
| ---- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------- |
| A    | "Instrument does not observe how you use the app. Nothing leaves your device unless you send it." | No analytics SDK, no install identifier, no automatic upload of any kind | No passive crash signal                           |
| B    | Tier A plus "you can turn on sanitized crash reports"                                             | Tier A plus one default-off switch with a published schema               | Small                                             |
| C    | "Anonymous telemetry, opt out any time"                                                           | Today's code                                                             | Free, and indistinguishable from every competitor |

Recommendation: **B**.

Two carve-outs to state before someone else finds them:

**Local app, not the model path.** BYOK and local-model users have a path that never touches us. Hosted-gateway users send prompts through our infrastructure by definition. A privacy page that does not separate these is false for the second group.

**"Anonymous" is the wrong word and we already use it.** FP-373 deliberately put it in the preferences UI. A stable persisted identifier is pseudonymous; a transcript is often re-identifying regardless. Use "not linked to your account". Ship this wording fix regardless of the rest.

## Current state

Nothing has been removed. Both PostHog SDKs are live and default-on.

- [preferences.ts:9-11](../../../apps/studio/src/electron-main/stores/preferences.ts#L9-L11) defaults `enableUsageMetrics` to on for every install except when `ELECTRON_USE_NEW_USER_FOLDER=true`, a dev flag.
- [telemetry.ts](../../../apps/studio/src/client/lib/telemetry.ts) calls `posthog.init` and subscribes to the opt-out preference afterward. [main-window.tsx](../../../apps/studio/src/client/components/main-window.tsx) calls `capturePageView` on mount, so init happens at window open for opted-out users. Init fetches remote config from the PostHog host, and `capture_exceptions: true` loads the autocapture extension from a PostHog asset URL.
- [telemetry.ts](../../../apps/studio/src/electron-main/lib/telemetry.ts) constructs the Node client at module load with `enableExceptionAutocapture: true`, before any preference is read.
- [index.html:8-15](../../../apps/studio/src/index.html#L8-L15) permits `https://*.posthog.com` in `connect-src`, `script-src`, and `style-src`.
- [app-state.ts:18](../../../apps/studio/src/electron-main/stores/app-state.ts#L18) persists a stable `telemetryId` sent as `distinctId` on every server event.
- [telemetry.ts](../../../packages/shared/src/types/telemetry.ts) permits raw model-search queries and external URLs, and an exception property bag carrying `rpc_path`, `session_id`, `message_id`, `tool_call_id`, `machine_state`.

**Removal is a four-file change.** There are 38 event and 54 exception call sites, but none touch PostHog. `CaptureEventFunction` and `CaptureExceptionFunction` are already injected into workspace ([types.ts:111-112](../../../packages/workspace/src/types.ts#L111-L112)) and ai-gateway ([types.ts:7](../../../packages/ai-gateway/src/types.ts#L7)). Only Studio binds them to PostHog. Swapping the sink is a constructor argument, so there is no reason to delete the event catalog on the way out.

**Diagnostics seed.** [server-exceptions.ts](../../../apps/studio/src/electron-main/lib/server-exceptions.ts) is an unbounded in-memory array, developer-mode only, populated only when telemetry is off.

**Timing seed.** [boot-timing.ts](../../../apps/studio/src/electron-main/lib/boot-timing.ts) wraps each step of main-process boot and logs its duration through electron-log, so a packaged build's `main.log` says which step a slow launch spent its time in. A formatted string, not a record, and the only timing anywhere in the app.

**No feedback UI.** [nav-support.tsx](../../../apps/studio/src/client/components/nav-support.tsx) is an external link. FP-653 "Conversation quality rating" was cancelled.

## What the storage change does to this

[user-chosen-working-folder.md](user-chosen-working-folder.md) and [conversation-storage.md](conversation-storage.md) change the payload this plan uploads. Four consequences:

1. **There is no task folder to submit.** Tasks stop owning a directory, and the folder a task points at is the user's own, full of files we did not create. Zipping it is off the table. [export-task-zip.ts](../../../packages/workspace/src/lib/export-task-zip.ts) is not the primitive for this after all; it becomes an export feature, not a reporting one.
2. **A conversation becomes one append-only file.** Under option D that file plus a byte range from the index _is_ the report payload. No archive walk, no multi-artifact manifest, and the zip-bomb and traversal surface drops out of the common case.
3. **The superset risk sharpens.** The transcript already contains every file the agent read, every screenshot, every browser page, every command's output. With a writable user-chosen folder those are the user's real documents rather than sandbox copies. "Thumbs up sends the thread" reads to a user like sending a chat and behaves like sending a working folder.
4. **The journal should match the conversation format.** Append-only plain text in application data, same delete story, same inspect story, rebuildable index. Do not introduce a second storage idiom for diagnostics.

Two things this makes newly claimable, and both are stronger than anything telemetry removal buys on its own: conversations are readable files the user can grep and delete, and we write no hidden state into the user's folder ([user-chosen-working-folder.md](user-chosen-working-folder.md) keeps our state in application data).

One decision moves here from [conversation-storage.md](conversation-storage.md): whether the agent gets raw read access to the user's whole conversation history. That plan correctly flags it as a privacy posture decision rather than a storage one. It belongs to this plan.

## Design

### Local diagnostics journal

Keep the event catalog, retarget the sink. Bind a `DiagnosticsSink` to the two capture types in Studio's four binding files; workspace and ai-gateway do not change.

- Append-only, in application data, bounded by size and age, same format as conversation storage.
- Sanitize on write, not on send: home and task roots become placeholders, URL query and fragment dropped, known secret and key formats matched, prompts, model output, tool payloads and file contents excluded.
- Two catalog fields change shape rather than move: `model_picker.searched.query` becomes had-results, `external_link.clicked.external_url` becomes an origin category. Both are tolerable locally and indefensible uploaded, and one schema for both is worth the loss.
- Diagnostics screen: inspect, copy, export, delete. Absorbs the dev-mode exception store.

### Timing and stalls

The journal as scoped records what happened and what threw. Neither answers "it froze on launch", which is both the most common report and the one ambient telemetry was always worst at: no exception is raised, no event in the catalog measures it, and the signal that would settle it is a duration nobody recorded. Spans are the third record type, alongside events and exceptions: a name, a duration, and a small typed payload.

Instrument the thread that owns the window first. A slow renderer costs a frame; a slow main process makes the OS paint "Not Responding" over an app that is still starting, and the two are indistinguishable to the user reporting it. Boot steps, the workspace layout migration, session load, task open, and agent turn latency split by model call versus tool execution all belong here.

A main-thread stall watchdog is the general form and worth more than any individual span: a timer that expects to fire every N ms and records its overshoot catches blocking work nobody thought to wrap, which is most of it. It is content-free and costs a timer.

Spans are the cheapest records to defend. Durations, step names, and counts carry no user content, which puts them in the small set of things a report can attach by default, and they are often diagnostic on their own, so a report carrying nothing else is still worth receiving. Bound them like the rest of the journal: one stall record per boot is free, a span per frame is a second product.

FP-1223 is the precedent, and it argues for the watchdog over hand-placed spans. A Windows-only twelve-second main-process freeze at launch, present across several releases, with PostHog running the whole time and reporting nothing: no exception, no event, no duration. The cause was a dependency probing for an optional tool by shelling out, on the thread that owns the window. Boot-step timing did not find it and would not have, because the subscribe that blocked runs from an RPC route the renderer calls once the window is open rather than from the launch sequence someone thought to wrap. That is the argument: spans only measure what a person already suspected, and a stall watchdog needs nobody to have guessed the location. Removing telemetry costs nothing here because telemetry never answered this class of question; what does is timing the user already has on disk and a report path that can carry it.

### Feedback report

Opening any feedback surface sends nothing. Entry points: sidebar button replacing the external link, per-message thumbs, task outcome rating, "Report this problem" on error banners and failed tool calls, command palette.

**Thumbs sends the whole thread**, gated on a first-run disclosure that shows the actual payload and is remembered per user. After that, one click plus a receipt with view and delete. Message-scoped reports are usually unactionable because the cause is upstream in the thread; the guard is the preview, not a narrower default. Message-level and task-level ratings stay separate.

Attachment defaults: rating and app version on; thread on for a thumbs report with range selection available; sanitized diagnostics preselected for an error report, off otherwise; tool payloads, files, screenshots, minidumps off with per-item selection.

Identity: unlinked, random report ID, optional contact field stored apart from content, receipt carrying a deletion token.

Redaction is defense in depth and must never be described as a guarantee. The preview is the authority.

### Crash reports

Electron Crashpad with `uploadToServer: false`. Minidumps stay local. On next launch, show the crash with a readable summary and an optional manual attachment.

Separate default-off setting, "Automatically share sanitized exception reports", not "usage metrics". Versioned allowlist: fingerprint, sanitized stack, app version, coarse OS and architecture, subsystem and RPC route, state-machine state, counts, timing, random per-report ID. Readable before opting in. No conversation content, no task or session identifiers, no stable install identifier. Minidumps stay manual until real dumps are audited for path, memory, URL, and content exposure.

### Ingestion

Bundle built in main, redacted locally, previewed, then `POST /feedback/intents` returns a report ID and a short-lived single-object upload URL. Upload to a private R2 quarantine bucket. An event notification feeds a queue; the processor verifies checksum and schema, enforces size limits, rejects traversal and unsupported types, scans, and writes a sanitized derivative to a separate bucket with its own access policy. Worker logs carry report ID, status, byte count, coarse error code.

Retention: raw 30 days, sanitized 90, rejected deleted promptly, derived fixtures only when deliberately promoted. R2 lifecycle rules, not procedure.

Triage automation reads only the sanitized derivative, holds no production credentials, cannot message users or publish, treats content as evidence rather than instructions, and requires human approval before any issue, PR, or merge. A submitted transcript is an adversarial prompt-injection payload.

### Hosted API

Today it attaches account identity, email, URL, user agent, country, and Cloudflare request identifiers to events. Defensible for billing, abuse, and support; indefensible if the privacy page implies otherwise. Needs its own published policy and a property allowlist. Prompts, outputs, tool payloads, and uploaded reports stay out of it.

## Sequencing

**Phase 0, next release.** Default `enableUsageMetrics` off. Apply opt-out before `posthog.init` in both processes. Disable exception autocapture in both. Remove remote script loading. Add a cold-start network test. Fix the "anonymous" wording.

**Phase 1.** `DiagnosticsSink` and journal. Span records, with the boot steps retargeted off electron-log and the main-thread stall watchdog added. Rebind the four Studio files. Reshape the two leaky catalog fields. Remove `posthog-js`, `posthog-node`, the CSP allowances, the env validation in [validate-env.ts](../../../apps/studio/validate-env.ts) and [electron.vite.config.ts:151](../../../apps/studio/electron.vite.config.ts#L151), and the persisted `telemetryId`. Diagnostics UI. Published egress registry. Offline local-model integration test.

**Phase 2.** Report composer, thumbs with first-run disclosure, task rating, "Report this problem". Bundle, redaction, preview, upload, receipt, deletion token, lifecycle.

**Phase 3.** Crashpad with upload disabled, pending-crash UI, manual submission, the default-off sanitized exception setting.

**Phase 4.** Quarantine queue, sanitized derivatives, dedup fingerprints, isolated triage, human approval gate, promotion into evals.

Phase 0 and 1 are independent of the storage work. **Phase 2 is not**: built against per-task SQLite it gets built twice, and the bundle shape differs (archive walk versus one file plus a byte range). Either schedule Phase 2 after [conversation-storage.md](conversation-storage.md) phase 4, or build it against the storage seam introduced in that plan's phase 2. Phase 1 alone earns the claim, so the marketing push does not have to wait for Phase 2.

## Decisions

1. Tier A or B. Recommendation: B.
2. Keep the event catalog locally, or delete it. Recommendation: keep, given the injection seam already exists.
3. Thumbs scope. Recommendation: whole thread behind a first-run payload disclosure.
4. Whether submitted threads can become eval fixtures. Blocks Phase 2 consent copy. Unresolved.
5. Whether the agent gets raw read access to the user's conversation history. Moved here from [conversation-storage.md](conversation-storage.md). Unresolved.
6. Retention. Recommendation: 30 raw / 90 sanitized.
7. Whether spans attach to every report by default rather than only to error reports. Recommendation: yes, they carry no content and are frequently the whole answer.
8. Encryption. TLS plus private R2 for MVP, client-side envelope encryption after.
9. Whether the marketing push waits for Phase 1. It has to: the claim is already being made informally in beta conversations while the code ships default-on PostHog.

## Acceptance criteria

- [ ] A fresh install makes no analytics request and creates no stable analytics identifier.
- [ ] PostHog domains and scripts are absent from the bundle and the CSP.
- [ ] A local-model-only workflow completes with the network unavailable.
- [ ] Opening or dismissing any feedback surface sends nothing.
- [ ] The previewed manifest, byte counts, and hashes match the uploaded bundle exactly.
- [ ] Unselected transcript ranges, files, tool payloads, screenshots, and diagnostics are absent server-side.
- [ ] A default report carries no account, user, installation, task, session, or message identifier.
- [ ] Automatic exception sharing is off on a fresh install and sends only the documented allowlist when on.
- [ ] A launch slower than its budget leaves a named step and duration in the journal, and a main-thread stall leaves an overshoot record.
- [ ] A report carrying only spans contains no path, identifier, or user content.
- [ ] Revoking consent stops future uploads; deleting removes pending local reports.
- [ ] A sent report can be deleted with its receipt token and no account.
- [ ] Raw R2 objects are private, access-controlled, and lifecycle-deleted.
- [ ] Worker logs contain no payload, token, header, or identifying object key.
- [ ] Malformed archives, oversized expansions, path traversal, and unsafe media are rejected.
- [ ] Prompt-injection fixtures in a submitted transcript cannot trigger messaging, issue creation, PR creation, credential use, or merge.
- [ ] Hosted API events contain no prompt, output, or raw report content.
- [ ] Published privacy documentation matches an automated egress inventory and states the hosted-model carve-out.
