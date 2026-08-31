# Code review: the month's new machinery, audited with usage evidence

**Status:** open items only. Recorded 2026-08-29 auditing the 684 commits since 2026-08-08, plus evidence mining across 110 task databases and 206 dev boot logs; every claim below survived an adversarial verifier reading the cited code. Findings are removed from this file as they land, so what remains here is what is still true. Items closed by decision rather than by a fix are listed at the bottom so the next review does not re-derive them.

## Open findings

### Rollover drops standing-context corrections (medium, bug)

The rollover view retains only user messages under a 40k-character budget, but the append-only correction parts (`data-attachedFolderChanges`, `data-projectChanges`, `data-dateChange`, `data-skillChanges`, `data-maxSteps`) are emitted exactly once against store-side baselines, so a dropped carrier message reverts the model's beliefs to session start: it confidently uses a detached folder, a stale date, or forgets skills it created. Assistant-riding corrections (`data-skillChanges`, `data-maxSteps`) are lost unconditionally at the first rollover, since no pre-boundary assistant message is retained. The right fix is already the repo's own plan: phase 2 of `docs/plans/active/context-compaction.md` calls for a mechanically assembled current-state block (folders with effective access, working folder, date, skills) appended with the rollover notice, which is assembled live per request after the cache breakpoints, so restating state there costs no cache invalidation. Do not harvest dropped `data-*` parts instead; synthesizing from current state is simpler and cannot resurrect stale intermediate corrections.

### Gateway proxy turns upstream connection failures into opaque retried 500s (medium, bug)

`routes/provider.ts` returns `hono/proxy`'s `proxy()` with no catch and no app-level `onError`, so an `ECONNREFUSED`/DNS/TLS rejection becomes Hono's default text/plain 500, which `classify-provider-error.ts` calls transient, so the machinery retries something waiting cannot fix and the user never sees "cannot reach Ollama at localhost:11434". The proxy call also passes only `{body, headers, method}`, not `raw`, so a stopped turn does not abort the upstream request. Fix shape (verified): `onError` in `app.ts` mapping fetch rejections to a JSON body naming the provider and syscall error plus `captureException`, pass `raw` so the client abort propagates, and make the classification terminal rather than transient, or the user still sees generic transient copy.

### Spawned-app env: unmapped provider types collide on `OPENAI_API_KEY`/`OPENAI_BASE_URL` (medium, bug)

`env-for-provider-configs.ts` assigns per-config env in list order, and nine provider types (minimax, huggingface, hyperbolic, jan, lmstudio, localai, novita, openai-compatible, z-ai) all map to `OPENAI_*` via the fallback in `bundled-providers.ts`. A user with OpenAI configured who adds LM Studio gets their task app's `new OpenAI()` silently pointed at LM Studio: deterministic misrouting with no error at configuration time. Fix shape (verified): two passes over the same `Object.assign`, fallback-mapped configs first and exactly-mapped second, so a real `openai` config always owns `OPENAI_*`; `spawn-runtime.ts` is the only caller.

### Every image read persists a fresh render of the same bytes (medium, perf)

`read_file` puts the rendered bytes of an image, PDF, audio, or video into the tool part it persists, base64-encoded, on every call, and nothing dedupes. One product-images task is a 42.6MB database in which 40 `read_file` parts hold 40.2MB, with eight files read four to six times each; the seven largest databases in a recent 110-task window are all this genre. Designed in [tool-result-media-dedup.md](../plans/active/tool-result-media-dedup.md): hash the rendered bytes rather than the source file, store them once per task, and resolve at the two readers that want bytes.

### Streamed code fences re-highlight every prefix through main-process RPC (medium, perf)

`use-syntax-highlighting.ts` keys an infinite-staleTime query on the full code string, so each committed snapshot of a growing fence is a fresh entry firing a `highlightCode` RPC whose synchronous shiki pass runs on the Electron main thread; total cost is O(n^2) in committed snapshots, and stale prefix entries (key holds the full prefix) live for the default 5-minute gcTime.

Worth stating plainly because it decides the priority: the common case is a fenced code block inside a streaming assistant message, which is visible by default. `markdown.tsx` runs `remend()` to close unterminated fences, so a growing fence renders through `CodeBlock` from its first line, with no tool card expanded and no file open. The `ToolBash` and file-viewer paths are the rarer ones.

Do not gate on `isStreaming` or debounce-until-stable: `placeholderData` keeps streamed code visibly highlighted today, and both would regress that. Fix shape (verified): throttle inside the hook (new highlight input at most every ~300ms while changing, trailing edge included), which keeps the display seamless and cuts the RPC rate roughly 10x; `ToolBash` and `FileToolCard` need the same treatment; moving shiki off the main thread is the durable fix but larger.

### Native-shim guards give wrong-remedy errors for `/project` paths (medium, usability)

The system prompt tells the agent the project folder is mounted at `/project`, but every native-binary guard knows only `/task` and `/mnt`: `python /project/script.py` is told to "use a task-relative path" (impossible for a project file, and the copy-first remedy the `/mnt` branch gives is withheld), `show /project/report.html` claims the path is outside the folders the user shared (false), `git -C /project` runs against the quarantine, and `git clone <url> /project/tools` silently lands in a phantom directory. This is the exact repair-loop shape `tool-errors-that-invite-repair-loops.md` measured. Scope the fix to `/project` (the prompt already teaches the `/skills` copy workflow, and PR #102 makes `/skills` natively resolvable): generalize the copy-first branch to any non-task mount, give git a pre-spawn answer including clone/worktree/init targets, and fix `show`'s message.

### Task directory growth is unbounded and invisible (medium, usability)

Nothing bounds or surfaces per-task disk use, and the growth is real rather than an artifact of shared storage. Measured on a dev workspace of 635 tasks: 6.5GB, across 130,552 files of which **zero** have a link count above one, so nothing is hard-linked to a package store or shared between tasks. Python virtualenvs under `work/.venv` are the largest category at 2.5GB, ahead of `work/node_modules` at 1.7GB, with 879MB of legacy per-task `.instrument/browser-session` profiles and 179MB of legacy `.instrument/screenshots` behind them. A separate 1.5GB `uv/cache` sits in the application data directory that the task venvs do not link to, so those packages are stored at least twice and the application owns closer to 8GB than to 6.5GB.

The packaged app shares this path; the Storage settings tab shows no sizes and the only reclamation is whole-task trash. Cheapest steps (verified): per-task sizes in the Storage tab and delete dialog (async, cached; a full walk takes seconds), then an opt-in cache-clear for regenerable `work/node_modules`, `work/.venv`, and `work/tmp` of idle tasks. A boot-time sweep of the legacy browser-session directories is safe and reclaims ~0.9GB here; the legacy screenshots are not safe to sweep, since task databases store direct path references to them (`migrate-workspace-layout.ts`).

## Near-misses and open questions

Worth knowing, not filed as findings. Each was verified as described.

- **Checkout deep link:** `handleDeepLink` ignores the URL entirely and only focuses the window; the `/checkout` client route was deleted when checkout moved to the external browser. If the platform API's Stripe `success_url` still points at `instrument://`, a paying user returns to a silently focused window with no confirmation and no entitlement refresh. Needs confirming against the platform API, which this repo cannot see.
- **Browser presence churn:** `acquireBrowserPresence`/`releaseBrowserPresence` reached 268 release-then-reacquire pairs within ~1ms each in a single session, one per task switch, the highest-frequency event in the log corpus. Nobody has measured what a round trip costs the webview pool.
- **Parallel tool batches execute sequentially** (`agent.ts` TODO already notes it). The cost is real: 8 parallel web searches serialized cost one task over a minute before the user gave up and stopped.
- **Shim console pipeline has no consumer:** the task app is the top document in the webview, so `window.parent === window` and every console-interception message lands on itself; the recovery overlay's "Open console" button is a no-op and every console call in a task app pays a JSON.stringify for nothing. Wire it to a real consumer or delete it.
- **Two gaps the dangling-tool-call sweep deliberately does not cover**, both following from its guard, which runs the sweep only when a run could have stranded something: an interactive tool call whose fire-and-forget `updatePart` write fails leaves a part the sweep no longer repairs, and a tool part left `input-streaming` by a provider that sends `tool-input-start` and then ends the stream cleanly is likewise not repaired. `llm-request.ts` still captures an exception for the second, so it stays visible.
- **agent-browser friction from task mining:** a poisoned HTTP/2 guest connection made one task retry `ERR_HTTP2_SERVER_REFUSED_STREAM` six times with no change in approach (a fresh-connection retry inside agent-browser would eat the loop); `screenshot` fails when the target's parent directory does not exist (upstream could `mkdir -p`).
- **web-fetch's "Response too large" error names no remedy** though one exists (`curl -L -o` plus the document skills); one sentence would prevent identical retries.
- **`fetchCredits` uses raw fetch with no timeout**, so OpenRouter key verification can hang toward undici's ~5-minute default while every other metadata fetch is bounded at 15s by `fetchJson`.
- **Model discovery for Cloudflare Workers AI times out in normal use**, surfacing as a Server Exception banner in dev. The dedupe and disk-cache fallback work as designed, so the turn is unaffected, but the banner is the one users would report.
- **Rollover residuals:** `attached-folder-changes.ts`'s docblock still says session context "is rebuilt at most hourly" (stale since immutability landed); the rollover `saveSession` has a microseconds-wide lost-update window against the async title generator (Store has no read-modify-write for sessions); a tiny window whose baseline plus 40k retained characters still overflows re-rolls every 4 assistant turns by design, cost being the symptom; the reactive rollover trigger on a classified context-overflow error is planned (context-compaction phase 4) but nothing consumes the classification yet.
- **`SESSION_CONTEXT_VERSION` is a manual bump:** a `getMessages` change landing without one silently strands existing sessions on the old baseline. A test pinning the output digest to the constant would make the bump unforgettable.
- **Dev-only:** two Studio instances share one application-data directory, so the `app.lock` non-graceful-exit detector reads the other instance's live lock, and `diskModelCache`'s read-modify-write is cross-process last-writer-wins. Every `conf`-backed store leaves a `.tmp-` orphan when the writer is killed mid-write, which only manifests under dev hard-relaunch.
- **Renderer neighborhood:** `--transcript-room` is registered `inherits: true`, so a wide table inside the reasoning fold's narrow scroller inherits the full pane width and likely bleeds past its clip (needs visual verification); `MermaidDiagram`'s retry budget ratchets and never resets after success; the browser find bar keeps the previous session's query across a session switch; `task.live.usageSummary` re-reads every message of every session per changed-message batch but only mounts behind developer mode.
- **Session replay and fixture tooling writes cloned messages with one shared `createdAt`**, which makes forensic timelines lie and mimicked a stranded-parts bug during mining.
- **Google free-tier 429s with a permanent quota of 0 are retried** like any rate limit; fine at 3 attempts, worth remembering if backoff grows.

## Closed by decision, not by a fix

So the next review does not re-derive them: the session machine saving only one queued message per actor (a message sent while an actor is live is dropped) is accepted because message queuing sits behind an unsupported feature flag, so the path is not reachable in the product; and hardening the tool-lifecycle `Store.updatePart` calls against silently discarded write failures was declined as overkill. Also refuted on verification, for the record: PostHog exception autocapture shipping unredacted paths; context-overflow errors being retried verbatim (usage is recorded per step and re-checked per request); a file dropped outside a drop region sending its path to telemetry; quit-time `close --all` starting orphan daemons; and prompt-cache affinity being newly cheap.

## Related

- `docs/plans/active/context-compaction.md`: phases 2 and 4 are the designed homes for the rollover findings above.
- `docs/plans/active/tool-result-media-dedup.md`: the design for the media-bloat finding.
- `docs/findings/tool-errors-that-invite-repair-loops.md`: the rule the `/project` guard finding is measured against.
- `docs/findings/code-review-2026-07-to-08.md`: the prior audit; its scope note is why this one concentrated on the renderer, the loop machinery, and usage evidence.
