# Model text

Text written for the chat's agent to read lives here, one module per piece, in a folder named for when the model reads it. The code that decides whether and where a piece is said stays with the feature; what it says is here.

A provider caches the request prefix, so changing a byte of anything in this folder misses that cache for every chat on its next turn. `model-text-bytes.test.ts` pins all of it in one snapshot, and `tools/tool-definitions.test.ts` pins the tool definitions. A snapshot change is a change to what the model reads: make it on purpose, in a commit that says so. `model-text-home.test.ts` fails when a `*-model-text.ts` module lands outside this folder.

## When the model reads each piece

### `system-prompt.ts`: once, at the front of every request

- `systemPrompt`: the agent's system prompt, the same in a chat and every task it forks and on every computer. Read by `agents/instrument.ts`.
- `pythonBaseText`: the context message's line on the packages `python` starts with, once the base is installed.

### `context/`: the session's context message, written once at its baseline and resent byte for byte

- `context-message.ts`: `getSystemInfoText` (the computer, the shell, the date and time zone), `getUserText` (who is signed in), `networkText` (what reaches the network), `FOLDERS_INTRO` and `NO_FOLDERS_TEXT` (the folders list's opening, or the line in its place). Assembled by `getMessages` in `agents/instrument.ts`.
- `build-folders-text.ts`: `buildFoldersText`, the list of folders the chat reaches.
- `available-skills-context.ts`: `buildAvailableSkillsContext` and `renderAvailableSkillsContext`, the skills catalog (budgeted by `lib/skill-catalog.ts`).
- `environment-model-text.ts`: the computer's facts inside the system information (`folderVariablesText`, `computerToolsText`, `platformGuidance`, `timeZoneRegion`), and `environmentChangeModelNote`, the note on a later message when one of them changed.

### `notes/`: a stored data part, rendered onto the message it is on at every request that carries that message

Rendered by `SessionMessage.toModelMessages` (`schemas/session/message.ts`), or by `lib/state-notes.ts` for a standing picture. Each is wrapped by `systemNote` (`system-note.ts`).

On a message the user sent:

- `asks-model-text.ts`: `asksModelNote`, the places in a file the user marked and what to change at each.
- `browser-status-model-text.ts`: `browserStatusModelNote`, the tabs the session holds and where each stands.
- `date-change-model-text.ts`: `dateChangeModelNote`, the new date on the first message of a later day.
- `folder-changes-model-text.ts`: `folderChangesModelNote`, folders the chat gained or lost since it was last told.
- `memory-model-text.ts`: `memoryModelNote`, what the agent remembers of the user, whole once and then what changed.
- `message-gap-model-text.ts`: `messageGapModelNote`, how long the user was away before this message.
- `model-change-model-text.ts`: `modelChangeModelNote`, the model the user switched to; `runningModelText` is the context message's model line.
- `project-model-text.ts`: `projectModelNote`, the project the chat is filed under.
- `setup-news-model-text.ts`: `setupNewsModelNote`, skills another chat, the person or a program changed.
- `view-context-model-text.ts`: `viewContextModelNote`, what was on screen when the message was sent.
- `workspace-instructions-model-text.ts`: `workspaceInstructionsModelNote`, the workspace's `AGENTS.md`.
- `background-processes-model-text.ts`: `backgroundProcessesModelNote`, what the session still has running at the start of a turn.

On a message with no text that wakes a session, or starts a task:

- `task-event-model-text.ts`: `taskEventModelNote`, tasks that finished a turn since the chat last heard.
- `job-event-model-text.ts`: `jobEventModelNote`, background processes that ended while the session was idle.
- `app-event-model-text.ts`: `appEventModelNote`, an app the user signed in to, declined or disconnected outside the conversation.
- `permission-answer-model-text.ts`: `permissionAnswerModelNote`, the user's answer to a card the work raised.
- `question-answer-model-text.ts`: `questionAnswerModelNote`, the user's answer to a `choose` card.
- `sign-in-progress-model-text.ts`: `signInProgressLine`, where each app on a sign-in card stands, inside the two notes above; `signInsSettled` is its test.
- `signed-in-model-text.ts`: `signedInModelNote`, the person signed in to Instrument while the session waited.
- `page-takeover-model-text.ts`: `pageTakeoverModelNote`, a page the user took over (a note that starts no turn) or gave back.
- `from-chat-model-text.ts`: `fromChatModelText`, what the chat wrote to a task: its assignment, or a later message.
- `hand-off-model-text.ts`: `withHandOffCalls` and `withHandOffResults`, a task's assignment read as the result of the call that started it.
- `branched-from-model-text.ts`: `branchedFromModelNote`, the chat a branch was copied from and where its things are.

Carried from an assistant message to the next user message:

- `max-steps-model-text.ts`: `maxStepsModelNote`, the previous run stopped at the step limit.
- `output-limit-model-text.ts`: `outputLimitModelNote`, the previous run was cut off at the output limit again and again.
- `skill-changes-model-text.ts`: `skillChangesModelNote`, skills the turn created or updated.

In place of a tool call's result:

- `stopped-tool-call-model-text.ts`: `withStoppedToolCallModelText` (a call the user or the chat stopped) and `withUnansweredToolCallResult` (a call that never returned).

### `request/`: said for one request only, after the cache breakpoints, never stored

Added by `lib/prepare-model-messages.ts` and `logic/llm-request.ts` through `transientNote`, which records each in the session's `data-requestNote` parts.

- `turn-notes.ts`: `TURN_NOTE`, on the first step of a turn the user typed; `LENGTH_NOTE`, on the step that continues a reply cut off at the output limit. Picked by `turnNoteFor` (`lib/turn-note.ts`).
- `context-rollover-notice.ts`: `contextRolloverNotice`, on every request after the window rolled over, with the handoff notes or the summary.
- `context-budget-notice.ts`: `contextBudgetNotice`, while the context window is running out.

### `commands/`: a shell command's description in the bash tool's definition, and what a command prints

- `instrument-command.ts`, `app-command.ts`, `memory-command.ts`, `task-command.ts`, `window-command.ts`, `x-command.ts`: each `instrument` subcommand's name, description and summary, read in the bash tool's description and the system prompt. `app-command.ts` and `window-command.ts` also hold what a task's shell prints when it refuses the chat's forms (`APPS_ARE_THE_CHATS`, `APP_SETUP_IS_THE_CHATS`, `WAITING_IS_THE_CHATS`, `WINDOW_IS_THE_CHATS`).
- `ignored-builds-note.ts`: `ignoredBuildsNote`, after a `pnpm` install that skipped build scripts.
- `package-scope-note.ts`: `packageScopeNote`, after Node stopped because the sandbox refused it a `package.json` above the script.

### `guides/`: printed by a command when the agent asks for it

- `agent-browser-guide.ts`: `agentBrowserGuide`, the browser guide, Instrument's addendum over the core guide in `agent-browser-core-guide.generated.ts` (written by `pnpm --filter @instrument-org/workspace script:refresh-agent-browser-guide` from the installed `agent-browser`).
- `mac-app-guide.ts`: `macAppGuide`, the guide `instrument app` prints for one of the Mac's own apps.

## Model text that lives elsewhere

- Tool definitions: each tool's description and input schema in `src/tools/`, one definition per tool, pinned by `tools/tool-definitions.test.ts`. The bash tool's description is assembled in `lib/create-bash-env.ts` from the command descriptions above and the descriptors that sit with their own command (`lib/shell-commands/agent-browser.ts`, `node.ts`, `pnpm.ts`, `pip.ts`, `python.ts`, `uv.ts`, `git.ts`, `rg.ts`, `ffmpeg.ts`, `ffprobe.ts`, `du.ts`, `background-job-commands.ts`, `validate-skill.ts`).
- What a command or a capability prints, refusals included, written where it fails or finishes: `lib/capabilities/` (`apps.ts`, `apps-setup.ts`, `window.ts`, `x.ts`, `memory.ts`, `task/`, `role-refusals.ts`), `lib/shell-commands/`, `lib/permissions/`, `lib/chat/asks.ts`.
- Notes assembled with the check that raises them: `lib/end-of-turn-checks.ts`, `lib/chat/mid-turn.ts`, `lib/chat-app-changes.ts`, `lib/apps/context.ts` (the context message's apps section), `lib/skill-catalog.ts`, `lib/normalize-model-images.ts`, `lib/limit-model-images.ts`, `lib/price-step-summary.ts`, the tool-call error texts in `constants.ts`, and the dictation note in `schemas/session/message.ts`.
- A system skill's reference: `lib/records/records-guide.ts`, which generates the `chat-history` skill's `records.md`.
- Prompts for a side model, not the chat's agent: `lib/generate-title-from-user-message.ts` and the decision model (`lib/decision-model.ts`).
