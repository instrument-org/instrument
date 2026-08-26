# Findings

Durable engineering findings we keep in-repo: non-obvious issues, what we tried, and what might resolve them later. One Markdown file per finding. Link the PR, commit, or code path a finding came from so it stays tied to the code.

Start each file with a `**Status:**` line saying where the issue stands — open, resolved, contained, closed as working-as-designed — and when it was last checked. A finding whose status is stale is worse than no finding, because it is read as current.

## Index

Grouped by area; status is the short form of each file's own line.

### Agent, tools, and prompts

| Finding | Status |
| --- | --- |
| [Agent prompt surface](agent-prompt-surface-review.md) — what we measured across the system prompt and tool descriptions | open items |
| [Agent tool surface](agent-tool-surface-review.md) — gaps against three reference harnesses | open items |
| [Tool errors that invite repair loops](tool-errors-that-invite-repair-loops.md) — an error message is an instruction, and models follow it | guidance |
| [Splitting media out of tool results](multipart-tool-results-and-the-split.md) — why the rewrite exists, what it costs, how a provider gets cleared | partly retired |
| [Browsing never opens the pane](browsing-never-opens-the-pane.md) — the page the user asked to see stayed invisible | resolved |
| [Local transcription engine](local-transcription-engine.md) — engine comparison, deliberately unresolved | open, unmeasured |

### Sandbox and containment

| Finding | Status |
| --- | --- |
| [Code review 2026-07 to 08](code-review-2026-07-to-08.md) — guards over real binaries and mounts that do not hold | one finding + three nits open |
| [Private-dir masking is not a boundary](private-dir-masking-is-not-a-boundary.md) — the mask stops the shell, not native interpreters | open, known gap |
| [The loopback block is curl-only](loopback-block-is-curl-only.md) — same shape, different command | open, working as designed |
| [The asset origin is open to any local reader](asset-origin-is-open-to-any-local-reader.md) — bounded today, unbounded under a user-chosen folder | open, no mitigation |
| [macOS Command Line Tools dialog](macos-command-line-tools-dialog.md) — a Python skill popped the system installer | resolved |

### The agent browser and the in-app browser

| Finding | Status |
| --- | --- |
| [Orphaned agent-browser daemons](agent-browser-orphaned-daemons.md) — fingerprint mismatch plus an upstream shutdown deadlock | partly fixed |
| [`download` never restores download behavior](agent-browser-download-behavior-not-reset.md) | open |
| [Snapshot refs die on the idle timeout](agent-browser-ref-map-idle-ttl.md) | open |
| [App reload destroys every task browser](app-reload-destroys-the-task-browser.md) | contained |
| [CDP keyboard input follows window focus](cdp-keyboard-input-follows-window-focus.md) | mitigated by a focus gate |
| [The guest's raster surface is capped at 1.3x the window](browser-guest-raster-cap.md) — larger than the window works, past the cap it crops invisibly | open, measured on three platforms |
| [Device/viewport emulation is not safe](in-app-browser-device-emulation.md) | closed, rejected |
| [Full-page screenshots are not supported](in-app-browser-full-page-screenshots.md) | open, workaround in place |
| [HTML artifacts: in-iframe navigation](html-artifact-iframe-navigation.md) | open, minimal reset shipped |

### Renderer and layout

| Finding | Status |
| --- | --- |
| [CSS zoom: rect px vs layout px](css-zoom-rect-vs-layout-px.md) — the mismatch that breaks scroll and virtualization at zoom != 1 | guidance |
| [Leaking z-index stacks](leaking-z-index-stacks.md) | resolved; rule stands |
| [The transcript column jumps while a turn runs](transcript-column-jumps-while-a-turn-runs.md) | open, instrumented not diagnosed |
| [What marks a renderer hidden](electron-page-visibility.md) — and what does not | resolved, guidance |
| [Task file links resolve at render time](task-file-links-resolve-at-render-time.md) | resolved |
| [Task attention state must be persisted](task-attention-state-persistence.md) — not derived from live status | open, design guidance |

### App lifecycle and platform

| Finding | Status |
| --- | --- |
| [Quit teardown can livelock](quit-teardown-can-livelock-the-app.md) — and every guard on that path is blind to it | open |
| [A quit confirmation outlives the window](quit-confirmation-outlives-the-window.md) — Windows/Linux ordering | resolved, guidance |
| [An update check un-stages the macOS build](update-check-un-stages-the-macos-build.md) | resolved |
| [Main log retention and transport](main-log-retention-and-transport.md) | partly addressed |
| [Windows long paths in the task directory](windows-long-paths.md) | open |
| [A watchman probe froze boot on Windows](windows-watchman-probe-freezes-boot.md) | resolved |
| [Preview.app declares no text types](preview-app-declares-no-text-types.md) | closed, working as designed |
| [The file-open cache is sized for a vanished cost](file-open-cache-is-sized-for-a-vanished-cost.md) | open, deliberate |
| [The task list ordered itself by file mtime](task-list-order-followed-file-mtimes.md) — so reading a task counted as changing it | fixed |
| [Connector authentication notes](connector-authentication-technical-notes.md) | reference |

### Model and context

| Finding | Status |
| --- | --- |
| [Character budgets are a token proxy](character-budgets-are-a-token-proxy.md) — and moving to tokens buys less than it looks like | open question |
| [Prompt cache provider affinity and breakpoints](prompt-cache-provider-affinity-and-breakpoints.md) | open |
| [ChatGPT citation markers in model output](chatgpt-citation-markers-in-model-output.md) — the fix costs more than the bug | known, not fixed |

### Build, test, and development

| Finding | Status |
| --- | --- |
| [Test suites re-evaluate module graphs](test-suite-module-evaluation-cost.md) — where the time actually goes | all four fixes landed |
| [TypeScript 7 (tsgo) dual package](typescript-7-native-preview-dual-package.md) | open, waiting on upstream |
| [Why the spell checker is `typos`](spelling-check-cost-versus-signal.md) — and not cspell | resolved |
| [A dev rebuild wipes the live main bundle](dev-rebuild-wipes-live-main-bundle.md) | open |
| [Driving Studio over CDP: what makes it flaky](driving-studio-for-ui-capture.md) | partly addressed |
