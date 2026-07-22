# Plan: semantic prompt composer

Status: deferred, not started. Revisit when user-created skills or another first-class reference type makes semantic authoring more valuable than the current textarea.

---

## Background / why

Our prompt input is currently a controlled textarea with attachment chips rendered as siblings above the textarea. That keeps the implementation simple, but it makes reference-heavy prompts noisy:

- File and folder references are plain text after insertion.
- Tool and file-card "append to prompt" actions can only append strings.
- Sent user messages display as plain text, so any future structured prompt tokens would lose their visual affordance in the transcript.

The goal is not to turn user prompts into general Markdown documents. User prompts often include literal Markdown examples, code fences, bullets, formatting instructions, or raw copied text. Rendering all user messages as Markdown can make the transcript look materially different from what the user sent.

The target is narrower: **semantic authoring**. First-class references become chips while editing and can render as chips after sending. Everything else stays text.

This probably should not lead near-term work by itself. The strongest trigger is a user-created skill/app/plugin system where users need a reliable way to reference a specific capability. File and folder mentions are useful, but they are not currently urgent enough to justify replacing the textarea on their own.

## Product direction

### Adopt

- Rich inline chips for references we understand:
  - files and folders
  - task/session references, if useful
  - user-created skills/apps/plugins, once the product has a real insertion workflow for them
- Plain-text serialization on submit. The model should continue to receive the prompt as a normal string plus the existing attachment payloads.
- Attachment chips as React UI outside the rich-text document. File uploads, image previews, and folder attachments should stay in the current attachment pipeline.
- Sent user-message rendering that recognizes only the semantic tokens we own.

### Avoid

- Full Markdown rendering for user messages.
- URL chip work in the composer MVP. URL previews are a separate link-unfurl design, not a prerequisite for semantic prompt references.
- Transforming unknown URLs into chips or links just because they look URL-shaped.
- Adding structured inline metadata to the workspace message schema before there is a concrete need.
- Making the editor own file/image attachment state.

## Current implementation to account for

- [prompt-input.tsx](/Users/mytop/code/instrument/instrument/apps/studio/src/client/components/prompt-input.tsx) owns prompt UI, model selection, attachment state, paste handling, submit validation, and textarea auto-resize.
- [prompt-value.ts](/Users/mytop/code/instrument/instrument/apps/studio/src/client/atoms/prompt-value.ts) stores drafts as strings and exposes textarea-specific focus/append helpers.
- [user-message.tsx](/Users/mytop/code/instrument/instrument/apps/studio/src/client/components/user-message.tsx) renders sent user text as plain `whitespace-pre-wrap` content with collapse/copy chrome.
- [assistant-message.tsx](/Users/mytop/code/instrument/instrument/apps/studio/src/client/components/assistant-message.tsx) already uses [SessionMarkdown](/Users/mytop/code/instrument/instrument/apps/studio/src/client/components/session-markdown.tsx) for assistant text. Reusing that wholesale for user messages is intentionally not the plan.

## Proposed architecture

### Prompt document model

Use a small rich-text editor wrapper with this logical document model:

- paragraphs and text
- inline atom nodes for known semantic tokens:
  - `fileMention`
  - `folderMention`
  - `taskMention` or `sessionMention`, only if we add the workflow
  - `skillMention`, only if skill insertion is productized

Each atom node should serialize to a plain string form:

| Token            | Serialized form                                                         |
| ---------------- | ----------------------------------------------------------------------- |
| File             | `[label](/absolute/path)` or another existing file-reference convention |
| Folder           | `[label](/absolute/path)` or explicit folder-reference convention       |
| Task/session     | `[label](instrument://...)` if we add an internal URL scheme            |
| Skill/app/plugin | `[$name](skill-or-app-id)` if needed                                    |

Keep this serializer as the boundary between rich UI and the workspace API.

### Prompt controller API

Replace textarea-specific imperative access with a controller shape:

```ts
type PromptDraftController = {
  appendText: (text: string) => void;
  clear: () => void;
  focus: () => void;
  getText: () => string;
  insertFileMention: (input: { label: string; path: string }) => void;
  insertSkillMention: (input: { id: string; label: string }) => void;
  setText: (text: string) => void;
};
```

`appendToPromptAtom` can initially call `appendText`, then grow specialized actions for file or skill insertion where callers have structured data.

Draft persistence should remain string-based at first. Hydrate the editor by parsing known serialized tokens back into atom nodes, and preserve unknown text exactly.

### Paste behavior

Preserve existing paste behavior:

- images/files on the clipboard attach as files
- very large pasted text becomes a text-file attachment
- ordinary text inserts into the prompt

Do not add URL-specific behavior in the initial composer. Generic URL treatment needs a separate design because good previews require either fetching page metadata, service-specific parsing, or authenticated connector-backed unfurling. Without that, shortening a URL into a chip risks hiding information without adding much confidence.

### User-message rendering

Do not render sent user messages through the full Markdown stack.

Instead, add a lightweight semantic-token renderer that:

- preserves whitespace and plain text
- recognizes only known serialized chip forms
- renders known file/folder/task/skill tokens as compact chips
- leaves unsupported Markdown and unknown URLs as text
- keeps copy behavior copying the raw submitted text

This gives transcript continuity without making prompts look like formatted documents.

## Implementation phases

### Phase 1: token renderer for user messages

1. Add a small parser for known serialized prompt tokens.
2. Render matching spans/chips inside `UserMessage`.
3. Preserve collapse behavior, hover metadata, and raw copy.
4. Add focused tests for:
   - unknown URL as plain text
   - Markdown bullets as plain text
   - file/path token as chip
   - skill/app token as chip, once the source workflow exists
   - raw copy unchanged

This phase is useful once there is at least one source workflow that emits semantic tokens. Until then, it is mostly infrastructure.

### Phase 2: rich editor behind existing `PromptInput`

1. Add the editor/controller wrapper.
2. Keep current `PromptInput` props and submit payload shape.
3. Keep attachments as sibling React UI.
4. Replace textarea auto-resize/focus logic with editor equivalents.
5. Update `promptDraftRefAtom` or replace it with a controller atom.
6. Keep draft storage string-based.
7. Add tests for submit serialization, focus, clear, append, paste files, large paste, and Enter vs Shift+Enter.

### Phase 3: semantic insertion workflows

1. Add structured insert calls from file cards, task file rows, and tool cards.
2. Add file/folder mention search if there is a clear UX entry point.
3. Add skill/app/plugin mentions only after their user-facing workflow is defined.

### Later: URL unfurls and chips

Treat URL handling as a separate product track from semantic prompt references.

Options to evaluate:

- Plain URL display: preserve exactly what the user pasted.
- Lightweight display-only shortening: show host/path compactly, but keep the raw URL on copy and hover. This does not require fetching.
- Unauthenticated metadata fetch: crawl the page title or Open Graph metadata. This adds privacy, latency, and failure-mode questions.
- Connector-backed unfurling: use authenticated integrations to resolve private links. This is more trustworthy, but depends on connectors that do not exist yet.

Do not block the composer on this. A Slack-like unfurl experience is valuable, but it is closer to a link-preview system than to the core rich prompt editor.

### Phase 4: polish and rollout

1. Gate the rich composer behind a feature flag while keeping the textarea fallback.
2. Dogfood with prompt drafts, file attachments, image paste, browser toggle, project selection, and task follow-up flows.
3. Remove the fallback after the editor has covered the existing textarea behavior.

## Open decisions

1. Editor library: ProseMirror directly vs a thin wrapper library. Direct ProseMirror gives maximum control over atom serialization and minimal abstraction drift, but costs more setup code.
2. Internal token URLs: decide whether task/session/skill tokens need URL-like schemes or should remain plain text until we have concrete routing.
3. URL strategy: decide later whether URLs stay raw text, get display-only shortening, or become fetched/connector-backed previews.
4. File token click behavior in user messages: preview, reveal, open in editor, or menu.

## Risks

- Editor focus and selection bugs can be high-friction because the current app assumes textarea refs in several places.
- Rich editing can break dictation, IME composition, or Enter handling if not tested explicitly.
- Overeager parsing can make prompts less trustworthy. Unknown text must stay unknown text.
- Reusing full Markdown rendering for user messages would be simpler, but it works against the product goal of preserving user intent.

## Verification

- Unit tests for token parsing and serialization.
- Component tests for `UserMessage` rendering and raw copy behavior.
- Prompt input tests for submit, clear, focus, append, paste, and keyboard behavior.
- Manual smoke in Studio:
  - new task prompt
  - task follow-up prompt
  - project prompt
  - file/folder attach by picker
  - file/folder attach by drag/drop
  - image paste
  - large text paste
  - unknown URL paste
