# The month's new machinery

Reviewed: `3332d9cde..a4da0fd04`

Asked to audit the 684 commits since 2026-08-08, concentrating on the renderer, the agent loop machinery and usage evidence (the prior review, `2026-08-12-guards-over-binaries-and-mounts`, had covered containment). Evidence was mined from 110 task databases and 206 dev boot logs, and every claim survived an adversarial verifier reading the cited code. Recorded 2026-08-31 with only the open items; findings fixed between the audit and that day were never written down and are not listed here. F was dropped from the record later, once moot. H to AB were near-misses and open questions, not filed as findings at the time. AC and AD were declined on 2026-08-31; AE to AH were refuted on verification.

## Findings

### A. A rollover drops standing-context corrections

- Status: fixed `8cec69ccc`
- Where: [apply-context-rollover.ts:39](/packages/workspace/src/lib/apply-context-rollover.ts#L39)
- What: the rollover view keeps only user messages under a 40k-character budget, but folder, project, date, skill and max-steps corrections were emitted once as parts on a carrier message, so a dropped carrier reverted the model to session-start beliefs; assistant-riding corrections were lost at the first rollover.
- Note: a rollover now writes a fresh baseline from current state, and what a session was last told is read from its history after that baseline. Not traced for every correction kind.

### B. The gateway proxy turns upstream connection failures into retried opaque 500s

- Status: open
- Where: [provider.ts:58-62](/packages/ai-gateway/src/routes/provider.ts#L58-L62), [classify-provider-error.ts:275-277](/packages/workspace/src/lib/classify-provider-error.ts#L275-L277)
- What: a refused connection, DNS or TLS failure in `proxy()` became Hono's text 500, classified transient and retried, so the person never saw "cannot reach Ollama at localhost:11434"; and the proxy passes no `raw`, so stopping a turn does not abort the upstream request.
- Note: `eeffd5c6d` added an `onError` that answers with the cause in a JSON body. At HEAD the proxy still passes no `raw`, and the 500 still classifies transient.

### C. Spawned apps' unmapped provider types collide on `OPENAI_API_KEY`/`OPENAI_BASE_URL`

- Status: superseded `7006cb89a`
- Where: `env-for-provider-configs.ts:45-46`, [bundled-providers.ts:171](/packages/ai-gateway/src/lib/bundled-providers.ts#L171)
- What: nine provider types fell back to `OPENAI_*` and were assigned in list order, so adding LM Studio after OpenAI silently pointed a task app's `new OpenAI()` at LM Studio. The app runtime was deleted.

### D. Every media read persists a fresh copy of the same bytes

- Status: fixed `4a4af7b36`
- Where: [read-file.ts:176](/packages/workspace/src/tools/read-file.ts#L176)
- What: `read_file` stored rendered image, PDF, audio and video bytes as base64 in every tool part with no dedup; one task was a 42.6MB database, 40.2MB of it 40 `read_file` parts over eight files.
- Note: tool bytes now go to hash-named blobs beside the chat's records, so identical renders are stored once per chat. `docs/plans/tool-result-media-dedup.md` still reads "not started".

### E. Streamed code fences re-highlight every prefix through main-process RPC

- Status: open
- Where: [use-syntax-highlighting.ts:38-52](/apps/studio/src/client/hooks/use-syntax-highlighting.ts#L38-L52)
- What: the query is keyed on the full code string with infinite `staleTime`, so each committed snapshot of a growing fence fires a synchronous shiki pass on the Electron main thread, O(n^2) over a stream, and stale prefixes live for the default gcTime. The common case is a fence in a streaming reply, which `remend()` renders from its first line. Fix shape (verified): throttle inside the hook to about 300ms with a trailing edge, keeping `placeholderData`; do not gate on `isStreaming`. Unchanged at HEAD.

### F. Native-shim guards give wrong-remedy errors for `/project` paths

- Status: superseded `2286b3b96`
- Where: [utils.ts:22-30](/packages/workspace/src/lib/shell-commands/utils.ts#L22-L30)
- What: guards knew only `/task` and `/mnt`, so `python /project/script.py` was told to use a task-relative path, `show /project/report.html` was told the path was outside the shared folders, and `git -C /project` ran against the quarantine. The `/project` mount was removed.

### G. Per-task disk use is unbounded and invisible

- Status: open
- Where: [storage-section.tsx:33](/apps/studio/src/client/components/settings/storage-section.tsx#L33)
- What: a dev workspace of 635 tasks held 6.5GB with no hard links (virtualenvs 2.5GB, `node_modules` 1.7GB, legacy browser profiles 0.9GB), plus a separate 1.5GB uv cache the venvs do not link to. Storage settings show no sizes and the only reclaim is deleting a task. Cheapest steps: sizes in Storage and the delete dialog, then an opt-in clear of regenerable folders.
- Note: work folders have moved to per-chat folders since; still no sizes or reclaim at HEAD.

### H. A checkout finished in the browser returns to a window that only focuses

- Status: open
- Where: [index.ts:283-285](/apps/studio/src/electron-main/index.ts#L283-L285)
- What: `handleDeepLink` ignored its URL, so a checkout returning through an `instrument://` link showed no confirmation and refreshed nothing.
- Note: since `47502aea1` a deep link opens the screen it names. Whether checkout returns through one is decided by the API, which this repo cannot see.

### I. Browser presence churns on every switch

- Status: open
- Where: [index.ts:189](/packages/workspace/src/machines/workspace/index.ts#L189), [index.ts:359](/packages/workspace/src/machines/workspace/index.ts#L359)
- What: one session logged 268 release-then-reacquire pairs about 1ms apart, one per task switch, the most frequent event in the logs; the cost to the webview pool was never measured.
- Note: an open question, not a confirmed defect. Presence is keyed by tab at HEAD; churn not re-measured.

### J. Parallel tool calls in a step run one at a time

- Status: fixed `aeb22a5ff`
- Where: [agent.ts:456](/packages/workspace/src/machines/agent.ts#L456)
- What: eight parallel web searches ran in sequence and took over a minute before the person stopped the task. Consecutive read-only calls now run at once.

### K. The task app's console pipeline has no consumer

- Status: superseded `7006cb89a`
- Where: `index.ts:120`, `error-overlay.tsx:35`
- What: the task app was the top document, so `window.parent === window` and every console message was posted to itself; "Open console" did nothing and each console call paid a `JSON.stringify`. The app runtime was deleted.

### L. Two gaps the dangling-tool-call sweep does not cover

- Status: open
- Where: [agent.ts:505](/packages/workspace/src/machines/agent.ts#L505) at `4c2bb8b43`
- What: the sweep runs only when a run could have stranded something, so an interactive call whose fire-and-forget `updatePart` fails is not repaired, nor is a part left `input-streaming` by a provider that sends `tool-input-start` and then ends the stream cleanly (`llm-request.ts` still captures an exception for that one).
- Note: the sweep landed after the reviewed head (`d9bed1568`, `4c2bb8b43`). At HEAD it also takes arriving parts and a `partsLeftBehind` guard (`d9c6e2ccb`), and writes go through chat records; whether both gaps remain was not re-verified.

### M. agent-browser loops on a poisoned HTTP/2 connection and fails screenshots into missing folders

- Status: open
- Where: upstream `agent-browser`, outside this repo
- What: one task retried `ERR_HTTP2_SERVER_REFUSED_STREAM` six times unchanged (a fresh-connection retry inside agent-browser would end the loop), and `screenshot` fails when the target's parent folder does not exist (upstream could create it).
- Note: not re-checked against the current agent-browser build.

### N. web_fetch's "Response too large" names no remedy

- Status: open
- Where: [web-fetch.ts:464](/packages/workspace/src/tools/web-fetch.ts#L464)
- What: the error says only the size, though `curl -L -o` plus the document skills handle it, so the agent retries the same call. One sentence fixes it. Unchanged at HEAD.

### O. `fetchCredits` has no timeout

- Status: open
- Where: [fetch-credits.ts:35](/packages/ai-gateway/src/lib/providers/fetch-credits.ts#L35)
- What: OpenRouter key verification uses a raw `fetch`, so it can hang toward undici's ~5-minute default while every other metadata fetch is bounded at 15s by `fetchJson`. Unchanged at HEAD.

### P. Workers AI model discovery timeouts surface as a dev exception banner

- Status: fixed `46907479c`
- Where: [fetch-json.ts:24](/packages/ai-gateway/src/lib/fetch-json.ts#L24)
- What: discovery hits the 15s bound in normal use; the dedupe and disk-cache fallback keep the turn working, but the reported exception is the banner people would report.
- Note: the fix stops reporting a fetch that hit its own timeout. Not seen in the running app; how often discovery still times out was not measured.

### Q. A folder-changes docblock says session context is rebuilt at most hourly

- Status: superseded `6984bd6d3`
- Where: [attached-folder-changes.ts:20](/packages/workspace/src/lib/folder-changes.ts#L20)
- What: stale since session context became immutable. The file was deleted when grants replaced attachments.

### R. The rollover's session save can lose a title written at the same moment

- Status: open
- Where: [prepare-model-messages.ts:118-130](/packages/workspace/src/lib/prepare-model-messages.ts#L118-L130)
- What: the rollover saves the whole session row it read, and the async title generator can write between the read and the save; the store had no read-modify-write for sessions.
- Note: at HEAD chat records write only what differs from the session as read at write time, which narrows the window; a title set between the rollover's read and its save may still be written back. Not re-verified.

### S. A tiny window re-rolls every four assistant turns

- Status: declined
- Where: [apply-context-rollover.ts:56](/packages/workspace/src/lib/apply-context-rollover.ts#L56)
- What: a window whose baseline plus 40k retained characters still overflows rolls over again each time four assistant turns accumulate, with cost as the symptom.
- Declined because: the four-turn floor is the deliberate bound on resetting a window that cannot fit, documented at the constant; revisit if windows that small become a supported setup.

### T. Nothing consumes the context-overflow classification for a reactive rollover

- Status: fixed `a142b09b0`
- Where: [classify-provider-error.ts:24](/packages/workspace/src/lib/classify-provider-error.ts#L24)
- What: a provider refusing a request for size was classified but never answered with a rollover.
- Note: `contextOverflowNeedsRollover` landed on 2026-08-30, a day before the review was recorded, so this claim was already stale when written.

### U. `SESSION_CONTEXT_VERSION` is a manual bump

- Status: open
- Where: [prepare-model-messages.ts:41](/packages/workspace/src/lib/prepare-model-messages.ts#L41)
- What: a change to what `getMessages` writes that lands without a bump leaves existing sessions on the old baseline. A test pinning a digest of the output to the constant would make the bump unforgettable. At HEAD the constant lives in `session-baseline.ts` and a missed bump reaches old chats at their next rollover; still no such test.

### V. Two dev instances share one application-data folder

- Status: open
- Where: `register-telemetry.ts:31`, [model-cache.ts:70-77](/apps/studio/src/electron-main/stores/machine/model-cache.ts#L70-L77)
- What: dev only. The `app.lock` non-graceful-exit detector read the other instance's live lock, `diskModelCache`'s read-modify-write is last-writer-wins across processes, and every `conf` store leaves a `.tmp-` file when killed mid-write.
- Note: the lock half was fixed in `2c47cdab0` (the marker records its pid and a live other process is skipped). The model cache is unchanged; the `conf` leftovers were not re-checked.

### W. `--transcript-room` inherits into the reasoning fold's narrow scroller

- Status: open
- Where: [globals.css:554-558](/apps/studio/src/client/styles/globals.css#L554-L558)
- What: the property is registered `inherits: true`, so a wide table inside the reasoning fold likely takes the full pane width and bleeds past its clip.
- Note: needs a visual check; still `inherits: true` at HEAD.

### X. Mermaid's retry budget never resets after a success

- Status: open
- Where: [mermaid-diagram.tsx:45](/apps/studio/src/client/components/mermaid-diagram.tsx#L45), [mermaid-diagram.tsx:86](/apps/studio/src/client/components/mermaid-diagram.tsx#L86)
- What: `attempt` only grows, so a diagram that recovered once has fewer retries left for the next failure. Unchanged at HEAD.

### Y. The browser find bar keeps the previous session's query

- Status: open
- Where: [use-browser-find.ts:36](/apps/studio/src/client/hooks/use-browser-find.ts#L36)
- What: switching sessions left the last search in the bar.
- Note: at HEAD the bar is per tab and clears on navigation, and opening an empty bar fills in the last search on purpose, as a browser does. Whether a switch still carries a stale query was not checked.

### Z. The live usage summary re-reads the whole chat per change batch

- Status: open
- Where: [index.ts:705-725](/packages/workspace/src/rpc/routes/chat/index.ts#L705-L725)
- What: every batch of changed messages re-reads every message of every session. Mounts only in developer mode. Same shape at HEAD in `rpc/routes/chat/index.ts`.

### AA. Session replay writes cloned messages with one shared `createdAt`

- Status: superseded `e44f9aafe`
- Where: `session-replay.ts:177-188`
- What: every replayed message got the same timestamp, which falsified forensic timelines and mimicked a stranded-parts bug during mining. Session replay was deleted; the seeder rebases timestamps by offset.

### AB. A Google 429 reporting a quota of 0 is retried like a rate limit

- Status: open
- Where: [classify-provider-error.ts:116-117](/packages/workspace/src/lib/classify-provider-error.ts#L116-L117)
- What: a permanent zero quota is retried three times. Harmless at three attempts; worth fixing if backoff grows. No special case at HEAD.

### AC. The session machine drops a message sent while an actor is live

- Status: not a defect
- Where: [session.ts:380-386](/packages/workspace/src/machines/session.ts#L380-L386), [session.ts:544-590](/packages/workspace/src/machines/session.ts#L544-L590)
- What: a session actor saved only one queued message, so a message added while the actor was live was dropped.
- Note: no longer reachable. The prompt-queue flag is gone; a person sends any number of messages at any moment, each interrupting the turn. `addMessage` appends every message to `queuedMessages` and steers each into a live agent, and `agent.consumedSteer` removes only the ones the agent took, so none is dropped. Checked at `5b380b711`.

### AD. Tool-part `updatePart` calls discard their Results

- Status: declined
- Where: [run-tool-call.ts:40](/packages/workspace/src/lib/run-tool-call.ts#L40), [run-tool-call.ts:84-117](/packages/workspace/src/lib/run-tool-call.ts#L84-L117), [run-tool-call.ts:144](/packages/workspace/src/lib/run-tool-call.ts#L144)
- What: the `Store.updatePart` calls across the tool lifecycle await a neverthrow Result and drop it, so a failed write is silent.
- Declined because: hardening every call site is overkill for a failure never observed; revisit if write failures show up in real evidence.
- Note: `Store` and `task.db` were replaced by chat records, but the same pattern remains at HEAD in `ChatWrites.updatePart` calls in `run-tool-call.ts`.

### AE. Exception autocapture ships unredacted paths

- Status: not a defect
- Where: `telemetry.ts:83`
- What: refuted on verification. The analytics client was removed in `2c47cdab0`.

### AF. Context-overflow errors are retried verbatim

- Status: not a defect
- Where: [classify-provider-error.ts:24](/packages/workspace/src/lib/classify-provider-error.ts#L24)
- What: refuted on verification: usage is recorded per step and re-checked per request.

### AG. A file dropped outside a drop region sends its path to telemetry

- Status: not a defect
- Where: [file-drop-region.tsx:141](/apps/studio/src/client/components/file-drop-region.tsx#L141)
- What: refuted on verification.

### AH. Quit-time `close --all` starts orphan agent-browser daemons

- Status: not a defect
- Where: [create-workspace-actor.ts:373](/apps/studio/src/electron-main/lib/create-workspace-actor.ts#L373)
- What: refuted on verification.
