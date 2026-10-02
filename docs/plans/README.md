# Plans

Execution plans for non-trivial work, checked in so an agent (or human) can pick them up later with full context. One Markdown file per plan.

- `active/` — plans not yet finished.
- `completed/` — finished or abandoned plans. Move them here with `Status:` updated rather than deleting, so the rationale stays legible; link the PR or commit that carried the work.

Every plan starts with a `Status:` line directly under the title, saying where the work stands and what is left. Keep it specific — "phases 1-3 landed, phase 4 not started" is worth more than "in progress" — because it is the only line most readers will check before deciding whether the rest is trustworthy. A plan that landed in full moves to `completed/`; a plan overtaken by a different design moves there too, with the status saying what replaced it.

When a plan moves, fix the links pointing at it. Sibling links inside one directory become `../active/…` or `../completed/…` across the boundary.

Wireframes are working artifacts drawn with `create-page`'s wireframe template and the Studio kit in [`.agents/wireframe-kit/`](../../.agents/wireframe-kit/KIT.md), and live outside the repository. A plan says in its own prose what a wireframe settled rather than linking one. `wireframes-*.html` beside the plans stays gitignored, so one written here by habit is never committed.

## Active

### Agent context and the model

| Plan | Status |
| --- | --- |
| [Context compaction](active/context-compaction.md) — let a task outlive the model's context window | phases 0-2 built |
| [Repeat search results](active/repeat-search-results.md) — stop paying for the same excerpt twice | proposed, unblocked |
| [Immutable session context](active/immutable-session-context.md) — append-only corrections, for cache reuse | phases 1-4 landed |
| [Session recovery from unsendable content](active/session-recovery-from-unsendable-content.md) | phases 1 and 4 landed |
| [Model request controls](active/model-request-controls.md) — reasoning effort and the rest, read from the catalog | per-task level, no UI control |
| [Degenerate stream loops](active/degenerate-stream-loops.md): detecting and ending a reply stuck repeating itself | proposed |
| [Tool-result media dedup](active/tool-result-media-dedup.md): store media once, by content hash | proposal, not started |
| [Subscription inference](active/subscription-inference.md): inference through the user's Claude and ChatGPT subscriptions | ChatGPT route landed |
| [Memory](active/memory.md): what the conversation keeps about the user | built, global only |

### The chat, the transcript, and the composer

| Plan | Status |
| --- | --- |
| [Chat surface](active/chat-surface.md) | slices 1-9 built, one open question |
| [What the classic window took with it](active/after-the-classic-window.md) | open list |
| [Grouped activities](active/grouped-activities.md) — one heading over a run of tool calls | built, headings flag off |
| [Presentation syntax](active/presentation-syntax.md) — how the agent presents files, data, and artifacts | file group built, rest proposed |
| [Shortcut table, menu bar, and guide](active/shortcut-table-menu-bar-and-guide.md) | phases 1-3 landed |
| [Chat stream turn-model refactor](active/chat-stream-turn-model-refactor.md) | partly in place, derive step not started |
| [Incremental live transcript updates](active/incremental-live-transcript-updates.md) | proposed |
| [Transcript virtualization](active/transcript-virtualization.md) | phase 0 landed |
| [Full-height transcript scrollbar](active/full-height-transcript-scrollbar.md) | proposed |
| [Edit a user message in place](active/edit-user-message-in-place.md) — rewind and rerun | proposed |
| [Semantic prompt composer](active/semantic-prompt-composer.md) | landed for skills and apps |
| [Render a file to look at it](active/render-a-file-to-look-at-it.md): letting a task look at what it made | proposed, nothing built |

### Files, folders, skills, and storage

| Plan | Status |
| --- | --- |
| [Conversation storage](active/conversation-storage.md) — conversation data the agent can read across | index and search landed, storage not started |
| [Agent-requested folder access](active/agent-requested-folder-access.md) | phase 1 landed, reduced phase 2 |
| [Legacy data migration](active/legacy-data-migration.md): bringing 1.x tasks and projects into chats | built, backfill and eval left |
| [Skills mount instead of copy](active/skills-mount-instead-of-copy.md) | step 3 copy removal left |
| [Skills from attached folders](active/skills-from-attached-folders.md) | proposed, waits on skills mount |

### Background work

| Plan | Status |
| --- | --- |
| [Background shell processes](active/background-shell-processes.md) | built, live log and cap notice open |
| [Wake on background job exit](active/wake-on-background-job-exit.md) | draft, not started |
| [Agent turn off the main thread](active/agent-turn-off-the-main-thread.md) | worker thread landed, utility process not started |

### The browser

| Plan | Status |
| --- | --- |
| [External browsers behind a flag](active/external-browser-behind-a-flag.md) — built; the checklist for turning it on | landed, flag off |
| [Agent browser ad blocking](active/agent-browser-ad-blocking.md) | draft |

### Platform and product

| Plan | Status |
| --- | --- |
| [Plugins](active/plugins.md) — the order to build it in, and how to tell whether it works | phase 1 landed as Apps |
| [Privacy-first diagnostics and feedback](active/privacy-first-diagnostics-and-feedback.md) | proposal |
| [AI usage panel](active/ai-usage-panel.md): a request log in Settings | planned, not started |
| [Reminders and Calendar app](active/mac-reminders-and-calendar-app.md): a built-in app on macOS | planned, not started |

### Development, testing, and dependencies

| Plan | Status |
| --- | --- |
| [Dependency upgrade sweep](active/dependency-upgrade-sweep.md) — what upstream has already fixed for us | first pass landed, electron/execa/dugite left |
| [Dependency work behind the PR queue](active/dependency-work-behind-the-pr-queue.md) — what waits for a quiet branch | AI SDK done, rest not started |
| [Seeded test workspaces](active/seeded-test-workspaces.md) | CI step remaining |
| [Seeded workspaces on Windows](active/seeded-workspaces-on-windows.md) | helper landed, host not enrolled |
| [Driving Studio in batches](active/driving-studio-in-batches.md) | runner and one recipe landed |
| [Agent driving Studio friction](active/agent-driving-studio-friction.md) | largely addressed |
| [radashi to es-toolkit migration](active/radashi-to-es-toolkit-migration.md) | planned, not started |
| [Radix upgrade, and whether to move to Base UI](active/radix-upgrade-and-base-ui-migration.md) | proposal, not started |
| [React Compiler blind spots](active/react-compiler-blind-spots.md) | proposal, not started |

## Completed

| Plan | Outcome |
| --- | --- |
| [The Instrument 2.0 orchestrator spike](completed/instrument-2-0-prototype.md) | became the 2.0 app |
| [Apps in the 2.0 prototype](completed/instrument-2-0-apps.md) | landed |
| [Threads, topics, and activity](completed/orchestrator-threads.md) | landed, then overtaken |
| [The inbox](completed/orchestrator-inbox.md): the 2.0 chat pane shaped like mail | landed, then overtaken |
| [Split the orchestrator route component](completed/orchestrator-route-split.md) | landed |
| [Rename threads to chats](completed/threads-to-chats-rename.md) | landed |
| [Chats as folders that own their tasks](completed/chat-folders.md) | landed |
| [Chat list index](completed/chat-list-index.md): a workspace index the chat list reads from | stage A landed |
| [Find chats and tasks from the omnibar](completed/chat-search-in-the-omnibar.md) | not built, superseded |
| [App-level tabs](completed/app-level-tabs.md) | landed |
| [The floating chat](completed/the-floating-chat.md) | landed |
| [Switchable workspaces](completed/switchable-workspaces.md) | landed |
| [Multiple top-level app windows](completed/multi-window-support.md) | not built, overtaken by 2.0 |
| [Temporary tasks](completed/temporary-tasks.md) | not built, overtaken by 2.0 |
| [Folders decoupled from tasks](completed/user-chosen-working-folder.md) | overtaken by 2.0 folders |
| [Validate the inspector](completed/inspector-validation.md) | complete |
| [Agent browsing across several tabs](completed/agent-browser-multiple-tabs.md) — a chat's task holds several of the chat's tabs; the conversation's `tab` command | landed, cursor dropped |
| [One browser abstraction, many tabs](completed/one-browser-many-tabs.md) | superseded |
| [Lazy browser targets, and multiple tabs](completed/lazy-browser-targets-and-multiple-tabs.md) | superseded |
| [Browser popups as agent-drivable tabs](completed/browser-popups-as-agent-drivable-tabs.md) | not built; the starting point for popups |
| [Sandboxed script runtimes as the default](completed/sandboxed-script-runtimes.md) — `python` reads attached folders in place, `python-native` is the escape hatch, `js-exec` beside `node` | landed |
| [Pane tabs and the `show` command](completed/pane-tabs-and-the-show-command.md) | landed |
| [File references without a watcher](completed/file-references-without-a-watcher.md) | landed |
| [Anchor the submitted turn](completed/anchor-the-submitted-turn.md) | landed |
| [Block-split markdown](completed/block-split-markdown.md): a streaming reply reparses itself once per chunk | landed, phase 5 dropped |
| [Zooming into images to read fine detail](completed/image-zoom-for-fine-detail.md) | complete |
| [Making the image coordinate contract sound](completed/image-read-coordinate-contract.md) | complete |
| [Interactive task-file links in chat](completed/chat-file-links.md) | landed; remainder overtaken by the files fence |
| [Document viewers](completed/document-viewers.md) | complete; thumbnails split out |
| [Document thumbnails](completed/document-thumbnails.md) | overtaken by system thumbnails |
| [One agent-browser command via a provider plugin](completed/agent-browser-provider-unification.md) | complete |
| [Skills in Studio](completed/skills-in-studio.md) | complete |
| [Skills browser and invocation](completed/skills-browser-and-invocation.md) | complete |
| [Skill creation flow](completed/skill-creation-flow.md) | complete |
| [Skill catalog weighting](completed/skill-catalog-weighting.md) | complete for the code half |
| [Idea skills eval](completed/idea-skills-eval.md) | superseded by create-page |
| [Uncontrolled prompt editor](completed/uncontrolled-prompt-editor.md) | done |
| [oxlint / oxfmt migration](completed/oxlint-oxfmt-migration.md) | complete, ESLint gone |
| [pnpm 10 to 11 migration](completed/pnpm-11-migration.md) | complete |
| [Tool result context budgets](completed/tool-result-context-budgets.md) | complete, two of three phases |
