# Plans

Execution plans for non-trivial work, checked in so an agent (or human) can pick them up later with full context. One Markdown file per plan.

- `active/` — plans not yet finished.
- `completed/` — finished or abandoned plans. Move them here with `Status:` updated rather than deleting, so the rationale stays legible; link the PR or commit that carried the work.

Every plan starts with a `Status:` line directly under the title, saying where the work stands and what is left. Keep it specific — "phases 1-3 landed, phase 4 not started" is worth more than "in progress" — because it is the only line most readers will check before deciding whether the rest is trustworthy. A plan that landed in full moves to `completed/`; a plan overtaken by a different design moves there too, with the status saying what replaced it.

When a plan moves, fix the links pointing at it. Sibling links inside one directory become `../active/…` or `../completed/…` across the boundary.

## Active

### Agent context and the model

| Plan | Status |
| --- | --- |
| [Context compaction](active/context-compaction.md) — let a task outlive the model's context window | proposed |
| [Repeat search results](active/repeat-search-results.md) — stop paying for the same excerpt twice | proposed |
| [Immutable session context](active/immutable-session-context.md) — append-only corrections, for cache reuse | proposed |
| [Session recovery from unsendable content](active/session-recovery-from-unsendable-content.md) | in progress |

### The transcript and the composer

| Plan | Status |
| --- | --- |
| [Grouped activities](active/grouped-activities.md) — one heading over a run of tool calls | in progress |
| [Presentation syntax](active/presentation-syntax.md) — how the agent presents files, data, and artifacts | file group built, rest proposed |
| [Shortcut table, menu bar, and guide](active/shortcut-table-menu-bar-and-guide.md) | phases 1-3 landed |
| [Chat stream turn-model refactor](active/chat-stream-turn-model-refactor.md) | proposed |
| [Incremental live transcript updates](active/incremental-live-transcript-updates.md) | proposed |
| [Full-height transcript scrollbar](active/full-height-transcript-scrollbar.md) | proposed |
| [Edit a user message in place](active/edit-user-message-in-place.md) — rewind and rerun | proposed |
| [Semantic prompt composer](active/semantic-prompt-composer.md) | deferred |

### Files, folders, and storage

| Plan | Status |
| --- | --- |
| [User-chosen working folder](active/user-chosen-working-folder.md) — folders decoupled from tasks, writable in place | proposal |
| [Conversation storage](active/conversation-storage.md) — conversation data the agent can read across | proposal |
| [Agent-requested folder access](active/agent-requested-folder-access.md) | proposal |
| [Temporary tasks](active/temporary-tasks.md) | designed |
| [Document thumbnails](active/document-thumbnails.md) | not started |

### The browser

| Plan | Status |
| --- | --- |
| [External browsers behind a flag](active/external-browser-behind-a-flag.md) — built; the checklist for turning it on | landed, flag off |
| [Lazy browser targets, and multiple tabs](active/lazy-browser-targets-and-multiple-tabs.md) | proposal |
| [Browser popups as agent-drivable tabs](active/browser-popups-as-agent-drivable-tabs.md) | proposal |
| [Agent browser ad blocking](active/agent-browser-ad-blocking.md) | draft |

### Platform and product

| Plan | Status |
| --- | --- |
| [Plugins](active/plugins.md) — the order to build it in, and how to tell whether it works | shaping |
| [Privacy-first diagnostics and feedback](active/privacy-first-diagnostics-and-feedback.md) | proposal |
| [Multi-window support](active/multi-window-support.md) | not started |

### Development, testing, and dependencies

| Plan | Status |
| --- | --- |
| [oxlint / oxfmt migration](active/oxlint-oxfmt-migration.md) | one step left |
| [Dependency upgrade sweep](active/dependency-upgrade-sweep.md) — what upstream has already fixed for us | first pass landed |
| [Dependency work behind the PR queue](active/dependency-work-behind-the-pr-queue.md) — what waits for a quiet branch | proposed |
| [Seeded test workspaces](active/seeded-test-workspaces.md) | CI step remaining |
| [Seeded workspaces on Windows](active/seeded-workspaces-on-windows.md) | helper landed, host not enrolled |
| [Driving Studio in batches](active/driving-studio-in-batches.md) | session runner landed |
| [Agent driving Studio friction](active/agent-driving-studio-friction.md) | partly addressed |
| [radashi to es-toolkit migration](active/radashi-to-es-toolkit-migration.md) | planned |
| [Radix upgrade, and whether to move to Base UI](active/radix-upgrade-and-base-ui-migration.md) | proposal |
| [React Compiler blind spots](active/react-compiler-blind-spots.md) | proposal |

## Completed

| Plan | Outcome |
| --- | --- |
| [Pane tabs and the `show` command](completed/pane-tabs-and-the-show-command.md) | landed |
| [File references without a watcher](completed/file-references-without-a-watcher.md) | landed |
| [Anchor the submitted turn](completed/anchor-the-submitted-turn.md) | landed |
| [Zooming into images to read fine detail](completed/image-zoom-for-fine-detail.md) | complete |
| [Making the image coordinate contract sound](completed/image-read-coordinate-contract.md) | complete |
| [Interactive task-file links in chat](completed/chat-file-links.md) | landed; remainder overtaken by the files fence |
| [Document viewers](completed/document-viewers.md) | complete; thumbnails split out |
| [One agent-browser command via a provider plugin](completed/agent-browser-provider-unification.md) | complete |
| [Skills in Studio](completed/skills-in-studio.md) | complete |
| [Skills browser and invocation](completed/skills-browser-and-invocation.md) | complete |
| [Skill creation flow](completed/skill-creation-flow.md) | complete |
| [Uncontrolled prompt editor](completed/uncontrolled-prompt-editor.md) | done |
| [pnpm 10 to 11 migration](completed/pnpm-11-migration.md) | complete |
| [Tool result context budgets](completed/tool-result-context-budgets.md) | complete, two of three phases; arrives with its branch |
