# Interactive task-file links in chat

Status: **active (blocked on prerequisite)**
Owner: TBD
Prerequisite: **the `worktree-open-in-native-app` branch must merge to `main` first**, so the
right-click menu can include native "Open in {App}" / "Open with". Do not start until then.

## Problem

When the agent hands the user a produced file, it writes an ordinary Markdown link, e.g.:

```md
[Download the redacted image](output/redacted_x.png)
```

This is exactly what the main agent prompt tells it to do -- "clickable Markdown links for
paths" ([main.ts:152](../../../packages/workspace/src/agents/main.ts#L152)) and `output/` files
are "shown to the user inline with previews"
([main.ts:190](../../../packages/workspace/src/agents/main.ts#L190)).

But the renderer does not honor it. [markdown.tsx:139-143](../../../apps/studio/src/client/components/markdown.tsx#L139-L143)
routes every non-`#` link to `ExternalLink`, whose RPC input schema is `z.url()`
([external-link.tsx:56](../../../apps/studio/src/client/components/external-link.tsx#L56),
[utils.ts openExternalLink](../../../apps/studio/src/electron-main/rpc/routes/utils.ts)). A
task-relative path like `output/redacted_x.png` is not a URL, so the mutation rejects and the
link silently degrades to "path copied to clipboard + error toast."

Images are partially handled: [markdown.tsx:175-186](../../../apps/studio/src/client/components/markdown.tsx#L175-L186)
resolves `./`/`../` against `assetBaseUrl` and a click opens a preview -- but a _bare_
`output/...` (no `./`) is not resolved even for images.

## Goal

Make agent-written references to task files first-class, interactive objects in chat:

1. **Explicit links** (`[label](output/x.png)`) render as an interactive **file chip** (file-type
   icon + filename).
2. **Bare paths** the agent mentions in prose (`output/x.png`) auto-link to the same chip when
   they resolve to a real task file -- so the agent rarely needs explicit link syntax.
3. **Left-click** opens the file in the right-hand artifact panel (the existing "Open in panel").
4. **Right-click** opens a context menu of the usual file actions (Open in {App}, Open with,
   Download, Reveal in Finder, Copy, Add to chat).
5. Missing/hallucinated paths degrade gracefully to plain text -- never a broken action.

### Success criteria

- The transcript link above renders as a chip and opens `redacted_x.png` in the artifact panel on
  click.
- Right-clicking the chip offers Download / Reveal / Copy / Add-to-chat / Open-in-{App} and
  performs each correctly.
- A bare `output/redacted_x.png` typed in prose (no `[]()`) auto-links to the same chip.
- A path that is not a real task file renders as ordinary text, no error toast.
- `![](output/x.png)` (bare image path) also resolves.

## Current building blocks (reuse, don't rebuild)

- **Open-in-panel** is already solved: tool cards set
  `search.artifactPanel = { filePath, modifiedAt, type: "file" }`
  ([tool-generate-image.tsx:134-148](../../../apps/studio/src/client/components/message-part/tool-generate-image.tsx#L134-L148)),
  rendering the right-hand `FileViewer`
  ([task/view.tsx](../../../apps/studio/src/client/components/task/view.tsx),
  [file-viewer.tsx](../../../apps/studio/src/client/components/file-viewer.tsx): image pan/zoom,
  md, sandboxed HTML, code, PDF, video, audio). Schema:
  [artifact-panel.ts](../../../apps/studio/src/client/schemas/artifact-panel.ts) (note it
  `transform`s `filePath` through `normalizeTaskFilePath` and rejects `..`).
- **File actions menu**: `FileActionsMenuItems`
  ([file-actions-menu.tsx:67-161](../../../apps/studio/src/client/components/file-actions-menu.tsx#L67-L161))
  -- Add-to-chat / Copy / Download / Reveal, gated by `useFileActionVisibility`
  ([use-file-action-visibility.ts](../../../apps/studio/src/client/hooks/use-file-action-visibility.ts)).
  Takes a `TaskFileViewerFile` ({ filename, filePath, mimeType, modifiedAt, taskId, url })
  ([task-file-viewer.ts:4-11](../../../apps/studio/src/client/atoms/task-file-viewer.ts#L4-L11))
  and a `menuComponents` set -- so it can drop into a Radix `ContextMenu` as-is.
- **File index + existence + modifiedAt**: `CurrentTaskFilesProvider` / `useCurrentTaskFile` /
  `useTaskFileReferenceStatus`
  ([current-task-files.tsx](../../../apps/studio/src/client/components/task/current-task-files.tsx))
  give a live `Map<filePath, TaskFile>`. This is both the existence gate AND the source of
  `modifiedAt` and `mimeType` needed to build the artifact-panel search param and a
  `TaskFileViewerFile`.
- **Asset URL**: `getAssetUrl({ assetBase, filePath, version })`
  ([get-asset-url.ts](../../../apps/studio/src/client/lib/get-asset-url.ts)); `assetBaseUrl` is
  already threaded into `Markdown` via the render context.
- **Path safety**: server-side `resolvePathWithinTaskDir` + `RelativeTaskPathSchema` guard every
  file RPC against traversal; the artifact-panel schema also rejects `..` client-side. No new
  guard needed -- the renderer only ever passes `{ taskId, relativePath }`.
- **Native open (prerequisite branch)**: `openTaskFile` / `openTaskFileWith` /
  `getTaskFileOpenTarget` / `getTaskFileOpenCandidates` RPC routes + `open-target-icon.tsx` /
  `open-with-menu.tsx` / `use-open-task-file.ts` / `use-task-file-open-target.ts` land with the
  `worktree-open-in-native-app` merge; the context menu consumes them.
- **Related prior art**: the app already auto-opens the first `output/` artifact after a turn
  (`task.outputArtifactsCreated` publisher +
  [use-auto-open-output-artifact.ts](../../../apps/studio/src/client/hooks/use-auto-open-output-artifact.ts)).
  Chip-click-to-panel is consistent with that behavior.

## Reference implementations (validated on disk)

- **the open-in pattern** (the reference open-in pattern): model emits a normal Markdown link; a custom `<a>`
  renderer detects a local-file href and swaps in a **file chip** (icon + basename + optional
  `:line`). Right-click on the chip -> Copy path / Reveal in Finder / Open in {target} / Open
  with / Open file. Also supports one optional custom token (`【/abs/path†L42】`) for a chip
  without a visible link. Detection is by absoluteness + scheme, not an allowlist walk.
- **the auto-link pattern** (the reference auto-link pattern): plain styled `<a>`; a
  `preprocessLinks()` step auto-links bare paths (linkify-it + a file-path regex, skipping code
  fences and existing links); click -> in-app preview overlay for previewable types else
  `shell.openPath`; the context menu lives on the preview's file badge (a dual left-click-dropdown
  / right-click-context-menu pattern). `url-transform` preserves the real anchor `href` for click
  routing while sanitizing the DOM `href` to block cmd/middle-click escape into the OS browser.

**Takeaway that answers the "custom syntax?" question:** neither app invents a _required_
directive. They let the model emit ordinary Markdown / bare paths and detect that the target is a
local file. We do the same. A token-style explicit token is a possible later add, not needed now.

## Design decisions

- **Rendering: file chip** (icon + filename), matching the app's existing file cards/rows and
  the open-in pattern. Not a plain underlined link.
- **Click target: the artifact panel** (the `artifactPanel` search param), matching the existing
  "Open in panel" and the post-turn auto-open behavior.
- **Detection, not a new syntax.** Both explicit links and bare paths resolve through the live task
  file index. Gate on the index: a token that does not resolve to a real task file renders as
  plain text (bare-path case) or falls through to `ExternalLink` (only for real URLs).
- **`modifiedAt` and `mimeType` come from the index**, so a chip is only "openable" when the file
  actually exists; this also gives graceful degradation for free.
- **Agent guidance stays light.** The prompt already tells the agent to link paths; we clarify that
  bare paths under visible roots auto-link, so explicit `[label](path)` is optional (use it only
  for a friendlier label). See Phase 4.

## Implementation phases

### Phase 1 - Explicit links -> chip -> open in panel

- Thread `taskId` into the Markdown render context alongside `assetBaseUrl`
  ([chat-stream.tsx](../../../apps/studio/src/client/components/chat-stream.tsx) ->
  `RenderPartContext` -> `AssistantMessage` -> `SessionMarkdown` -> `Markdown`).
- Add a `TaskFileLink` component. `MarkdownLink`
  ([markdown.tsx:116-144](../../../apps/studio/src/client/components/markdown.tsx#L116-L144))
  delegates to it when `href` is schemeless (no `scheme:` prefix, not `#`, not `//`). `TaskFileLink`:
  - normalizes `href` via `normalizeTaskFilePath`, looks it up with `useCurrentTaskFile`;
  - if found -> render the chip (file-type icon + filename); click -> navigate `search.artifactPanel
= { filePath, modifiedAt, type: "file" }`;
  - if not found -> render children as plain text (no error path).
- Fix `resolveImageSrc` / `isImageAllowed` to also resolve bare task-root-relative paths (not just
  `./`/`../`) so `![](output/x.png)` works and is consistent with links.
- **Exit check:** the transcript's `[Download the redacted image](output/redacted_x.png)` renders as
  a chip and opens the file in the panel.

### Phase 2 - Right-click menu (needs the prerequisite merge)

- Wrap the chip in a Radix `ContextMenu`; render `FileActionsMenuItems` with the context-menu
  `menuComponents` set and an `onAddToChat` that calls `appendToPromptAtom`.
- Build the `TaskFileViewerFile` the menu needs from the index entry (`filename`, `filePath`,
  `mimeType`, `modifiedAt`, `taskId`, `url` via `getAssetUrl`).
- Add the native-open items from the merged branch (Open in {App} + Open with submenu) to the menu,
  and optionally show the resolved app icon on the chip via `useTaskFileOpenTarget`.
- **Exit check:** right-clicking the chip offers and performs Download / Reveal / Copy / Add-to-chat
  / Open-in-{App}.

### Phase 3 - Auto-link bare paths in prose

- Add a remark plugin `remarkTaskFileLinks` that walks text nodes (skipping `code`, `inlineCode`,
  and existing `link` nodes), matches tokens that structurally look like task-relative paths (start
  with a known root from `TASK_FOLDER_NAMES` -- `output/ attachments/ downloads/ work/ toolOutput/`
  -- optionally `./`-prefixed, ending in a filename), and rewrites them to `link` nodes carrying a
  `data-taskfile` marker.
- Structural match only; existence gating still happens in `TaskFileLink` against the index, so
  false-positive tokens that are not real files fall back to plain text.
- Register the plugin in `Markdown`'s `remarkPlugins`.
- **Exit check:** a bare `output/redacted_x.png` in prose renders as the same chip; a made-up path
  stays plain text.

### Phase 4 - Tighten agent guidance (small, prompt-only)

- In [main.ts](../../../packages/workspace/src/agents/main.ts) (Tone/Style ~L149-153 and Task
  Folder ~L189-196), clarify: paths under user-visible roots (`output/`, `attachments/`,
  `downloads/`) auto-link to an interactive file chip, so the agent _may_ use
  `[friendly label](output/foo.png)` when a nicer label helps but does not need to -- a bare path
  links automatically.

### Phase 5 (optional) - Explicit citation token

- Only if we later want a chip without a visible path or with extra metadata (line ranges, custom
  label without a real link). Model on the open-in pattern's `【path†L..】` token + a remark tokenizer. Likely
  unnecessary given Phases 1 and 3.

## Open questions

1. Chip affordance for non-previewable types (e.g. `.zip`): panel `FileViewer` can't preview it --
   click should probably Download or Reveal instead of opening an empty panel. Decide the click
   fallback per `getFileType`.
2. Auto-link scope: restrict to user-visible roots (`output/ attachments/ downloads/`) and exclude
   `work/`/`toolOutput/` (internal) to avoid chip noise? Leaning yes.
3. Stale references: `useTaskFileReferenceStatus` can report `stale` (file overwritten since the
   message). Chip should open the current version (index `modifiedAt`); confirm that's always
   desired vs pinning the message-time version.
4. Middle/cmd-click: ensure the chip's DOM `href` can't escape into the OS browser (mirror
   the auto-link pattern's sanitized-`href` guard).
