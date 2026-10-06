# Findings

Durable engineering findings we keep in-repo: non-obvious issues, what we tried, and what might resolve them later. One Markdown file per finding. Link the PR, commit, or code path a finding came from so it stays tied to the code.

Start each file with a `**Status:**` line saying where the issue stands — open, resolved, contained, closed as working-as-designed — and when it was last checked. A finding whose status is stale is worse than no finding, because it is read as current.

## Index

Grouped by area; status is the short form of each file's own line.

### Agent, tools, and prompts

| Finding | Status |
| --- | --- |
| [Agent prompt surface](agent-prompt-surface-review.md) — what we measured across the system prompt and tool descriptions | open items |
| [Agent tool surface](agent-tool-surface-review.md) — gaps against three reference harnesses | partly overtaken |
| [Token cost per task](token-cost-per-task-baseline.md) — where price-weighted tokens go by source and billing type, and what would move them | open, baseline measured |
| [Tool errors that invite repair loops](tool-errors-that-invite-repair-loops.md) — an error message is an instruction, and models follow it | guidance |
| [A fetched file gets copied somewhere writable](a-fetched-file-gets-copied-somewhere-writable.md) — the destination came from which mount was writable, and one clause suppressed it | fixed, measured |
| [A 429 that is not a rate limit](a-429-that-is-not-a-rate-limit.md) — the deny page `web_fetch` threw away, and why a throttle would not have helped | fixed |
| [A fetch that succeeds and returns no content](a-fetch-that-succeeds-and-returns-no-content.md): a page that is only navigation comes back as success | open |
| [A task cannot look at what it drew](a-task-cannot-look-at-what-it-drew.md) | harness gap fixed, rasterizing open |
| [The child task prompt contradicts its brief](the-child-task-prompt-contradicts-its-brief.md) | resolved, then superseded |
| [The search backend returns more than we forwarded](search-result-fields-we-discard.md) — the lead image and site icon we dropped, and the freshness we cannot buy | fixed, with trade-offs recorded |
| [Splitting media out of tool results](multipart-tool-results-and-the-split.md) — why the rewrite exists, what it costs, how a provider gets cleared | partly retired |
| [Browsing never opens the pane](browsing-never-opens-the-pane.md) — the page the user asked to see stayed invisible | resolved in 1.x; pane state reaches only the model |
| [Local transcription engine](local-transcription-engine.md) — engine comparison, deliberately unresolved | open, unmeasured |

### Sandbox and containment

| Finding | Status |
| --- | --- |
| [Code review 2026-07 to 08](code-review-2026-07-to-08.md) — guards over real binaries and mounts that do not hold | one finding + three nits open |
| [Code review 2026-08-29](code-review-2026-08-29.md): the month's new machinery, audited with usage evidence | open items; one moot |
| [Private-dir masking is not a boundary](private-dir-masking-is-not-a-boundary.md) — the mask stops the shell, not native interpreters | open, known gap |
| [The WASM Python aborts at exit on some install paths](the-wasm-python-aborts-at-exit-on-some-install-paths.md) — the worker's own path length decides whether finalization survives; pinned, offered upstream as #423 to #425 | contained; pin merged upstream |
| [The loopback block is curl-only](loopback-block-is-curl-only.md) — same shape, different command | open, working as designed |
| [The asset origin was open to any local reader](asset-origin-is-open-to-any-local-reader.md) — unauthenticated, wildcard-CORS loopback origin keyed by a guessable task id | moot, origin removed |
| [macOS Command Line Tools dialog](macos-command-line-tools-dialog.md) — a Python skill popped the system installer | resolved |
| [What the orchestrator can reach](orchestrator-file-access-model.md) — whether the conversation should read the whole disk, and why read and write have to come apart first | open question, nothing built |
| [Electron reads an app's archive as a folder](electron-reads-asar-archives-as-folders.md) — `du` counted every Electron app's `app.asar` twice; `ls`, `find` and This Mac still see a folder | `du` fixed, rest open |
| [The macOS folder ask holds a listing, not a write](macos-folder-ask-holds-listings-not-writes.md) | worked around in `task new` |
| [EPERM on a symlink reads as a macOS denial](eperm-on-a-symlink-reads-as-a-macos-denial.md) | resolved |

### The agent browser and the in-app browser

| Finding | Status |
| --- | --- |
| [An entitlement that signs, notarizes, and will not launch](an-entitlement-that-notarizes-and-will-not-launch.md) — team-scoped entitlements need an embedded provisioning profile; every gate passes and launchd still refuses | resolved, entitlement re-landed |
| [What refuses the in-app browser](what-refuses-the-in-app-browser.md) — the standing register: identity, escalation ladder, and where each known refusal stands | standing |
| [Orphaned agent-browser daemons](agent-browser-orphaned-daemons.md) — fingerprint mismatch plus an upstream shutdown deadlock | partly fixed |
| [`download` never restores download behavior](agent-browser-download-behavior-not-reset.md) | open upstream, contained |
| [Snapshot refs die on the idle timeout](agent-browser-ref-map-idle-ttl.md) | fixed |
| [Agent clicks land where the element was](agent-clicks-land-where-the-element-was.md) | worked around, open upstream |
| [`open` returned before the page had loaded](open-returns-before-the-page-loads.md) — the bridge answered `Page.navigate` on commit, so `open` returned onto a document still parsing | fixed, measured |
| [App reload destroys every in-app browser page](app-reload-destroys-the-in-app-browser.md) | contained |
| [`target=_blank` links are dead clicks](blank-target-links-are-dead-clicks.md) — the open is denied before a tab exists, so nothing happens and nothing says so | fixed; real tabs for the person |
| [CDP keyboard input follows window focus](cdp-keyboard-input-follows-window-focus.md) | mitigated by focus reclaim |
| [The guest's raster surface is capped at 1.3x the viewport](browser-guest-raster-cap.md) — Blink's compositing rect; past it captures crop invisibly | open, traced to source |
| [A browser guest as a scaled-down live tile](browser-guest-as-a-scaled-tile.md) | verified, not built |
| [The browser guest stacks under the renderer's own layers](browser-guest-stacks-under-the-renderer.md) — a draft window, a menu, and a second guest all draw over it; the reflex of hiding it dates from the native view | verified; dialogs park the page |
| [Device/viewport emulation is not safe](in-app-browser-device-emulation.md) | superseded; the guest is resized instead |
| [Full-page screenshots are not supported](in-app-browser-full-page-screenshots.md) | open, workaround in place |
| [HTML artifacts: in-iframe navigation](html-artifact-iframe-navigation.md) | moot, iframe removed |
| [WebMCP readiness](webmcp-agent-browser-readiness.md) — calling a third-party site's own tools; probed, blocked on Electron 44 | open, not implemented |
| [A bare Chrome identity is what Google refuses](a-bare-chrome-identity-is-what-google-refuses.md) — the token strip meant to make the browser look ordinary is what got it blocked | fixed |
| [The client hints are ours, not Chromium's](browser-client-hints-are-ours-not-chromium-s.md) — Electron emits none, so the header identity is entirely what we write | brand mismatch fixed |
| [What the in-app browser reports about itself](in-app-browser-self-report.md) — every difference from a real Chrome, measured side by side; identity and languages fixed, and the 429 that prompted it refuses client shape rather than counting requests | partly fixed |

### Renderer and layout

| Finding | Status |
| --- | --- |
| [CSS zoom: rect px vs layout px](css-zoom-rect-vs-layout-px.md) — the mismatch that breaks scroll and virtualization at zoom != 1 | guidance |
| [Leaking z-index stacks](leaking-z-index-stacks.md) | resolved; rule stands |
| [The transcript column jumps while a turn runs](transcript-column-jumps-while-a-turn-runs.md) | open, instrumented not diagnosed |
| [Wide tables widen the transcript](wide-tables-widen-the-transcript.md) — a Markdown table with nowhere to scroll takes the conversation with it | resolved |
| [Markdown that is mostly tables](markdown-that-is-mostly-tables.md) — two quadratic parses cost twenty seconds on a 2 MB file, and why `content-visibility` was rejected | fixed; the DOM is what is left |
| [What marks a renderer hidden](electron-page-visibility.md) — and what does not | resolved, guidance |
| [Task file links resolve at render time](task-file-links-resolve-at-render-time.md) | resolved |
| [Task attention state must be persisted](task-attention-state-persistence.md) — not derived from live status | moot, unread marks removed |

### App lifecycle and platform

| Finding | Status |
| --- | --- |
| [Quit teardown can livelock](quit-teardown-can-livelock-the-app.md) — and every guard on that path is blind to it | open; seen twice, stage pinned, loop unknown |
| [A quit confirmation outlives the window](quit-confirmation-outlives-the-window.md) — Windows/Linux ordering | resolved, guidance |
| [An update check un-stages the macOS build](update-check-un-stages-the-macos-build.md) | resolved |
| [A deb update can leave the package unconfigured](deb-update-left-the-package-unconfigured.md) | fixed, verified |
| [Dragging a file out does not cross from XWayland to Wayland](drag-out-does-not-cross-xwayland.md) — the ozone pin, why dropping it did not take, and what it cost | fixed |
| [Main log retention and transport](main-log-retention-and-transport.md) | partly addressed |
| [Windows long paths in the task directory](windows-long-paths.md) | partly fixed |
| [A watchman probe froze boot on Windows](windows-watchman-probe-freezes-boot.md) | resolved |
| [The agent's filesystem work stalls the window](agent-filesystem-work-stalls-the-window.md) — not by blocking it; the freeze is filesystem latency for everything else on the thread | contained, shell off main |
| [A dictated paste lands the old clipboard](dictated-paste-lost-to-a-status-poll.md) — a two-second poll read every filed task's whole transcript on the thread a paste waits on | fixed, measured |
| [Preview.app declares no text types](preview-app-declares-no-text-types.md) | closed, working as designed |
| [The file-open cache is sized for a vanished cost](file-open-cache-is-sized-for-a-vanished-cost.md) | open, deliberate |
| [The task list ordered itself by file mtime](task-list-order-followed-file-mtimes.md) — so reading a task counted as changing it | fixed |
| [Connector authentication notes](connector-authentication-technical-notes.md) | reference, partly overtaken by apps |

### Model and context

| Finding | Status |
| --- | --- |
| [Character budgets are a token proxy](character-budgets-are-a-token-proxy.md) — and moving to tokens buys less than it looks like | open question |
| [Prompt cache provider affinity and breakpoints](prompt-cache-provider-affinity-and-breakpoints.md) | open |
| [ChatGPT citation markers in model output](chatgpt-citation-markers-in-model-output.md) — the fix costs more than the bug | known, not fixed |
| [A ChatGPT plan cannot generate images](chatgpt-plan-cannot-generate-images.md): the plan route refuses it, so a plan-only user has no image tool | known, upstream |
| [Reasoning effort at the provider default](reasoning-effort-at-the-provider-default.md) — what the level we never set spends, costs, and delays | measured; superseded in part |
| [Reasoning effort was never connected](reasoning-effort-was-never-connected.md) | fixed |
| [Which Workers AI models can run the product](which-workers-ai-models-can-run-the-product.md) | measured |
| [Non-Anthropic models get no cache breakpoints](non-anthropic-models-get-no-cache-breakpoints.md) | resolved, no change |
| [A reply that arrives twice](a-reply-that-arrives-twice.md) — a GPT-5 `commentary` and `final_answer` with the same words, flattened by OpenRouter's chat bridge; what proved it and what the Responses route needed | fixed |

### Build, test, and development

| Finding | Status |
| --- | --- |
| [Test suites re-evaluate module graphs](test-suite-module-evaluation-cost.md) — where the time actually goes | all four fixes landed |
| [TypeScript 7 (tsgo) dual package](typescript-7-native-preview-dual-package.md) | open, ESLint consumers gone |
| [Why the spell checker is `typos`](spelling-check-cost-versus-signal.md) — and not cspell | resolved |
| [A dev rebuild wipes the live main bundle](dev-rebuild-wipes-live-main-bundle.md) | fixed |
| [Driving Studio over CDP: what makes it flaky](driving-studio-for-ui-capture.md) | partly addressed |
| [A driven chord opens the About panel](a-driven-chord-opens-the-about-panel.md) — a keycode macOS reads as another key, landing on the one menu item carrying no key equivalent | fixed |
