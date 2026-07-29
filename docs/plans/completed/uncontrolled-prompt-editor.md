# Plan: make the prompt editor uncontrolled

Status: done.

---

## Background / why

`PromptEditor` wraps ProseMirror as a **controlled** component: a `value` string in, an `onChange` out. ProseMirror already owns a document, so there are two sources of truth for the same text, synced in both directions:

- up, on every edit, via `onChange` in `dispatchTransaction`
- down, on every `value` change, via an effect that diffs and replaces the whole document

That effect is manual echo cancellation. It compares `promptTextFromDoc(view.state.doc) === value` to decide whether an incoming `value` is a real external write or just its own edit coming back around. It works, but it is the reason for a family of bugs:

- **Drafts were emptied on load.** The editor reported its document on _every_ transaction, including the selection change that focus produces. The empty view a page load starts with announced itself as the draft and overwrote the stored one. Fixed by guarding on `transaction.docChanged`, but the guard exists because edits and caret moves travel the same wire.
- **The caret jumps to the end on any external write.** The effect ends with `TextSelection.atEnd(tr.doc)`. Clicking "add this file path" mid-sentence appends to the end and drags the caret there.
- Round-tripping depends on `promptTextFromDoc`/`promptDocFromText` being perfectly symmetric. Any asymmetry is an infinite loop or a caret jump.

The fix is to let ProseMirror own the document and demote the atom to a mirror.

## Success criteria

- `PromptEditor` takes a `defaultValue`, not a `value`. The `[value]` effect and its equality check are gone.
- External writers reach the editor through an imperative handle, not by setting an atom the editor watches.
- Inserting text lands **at the caret**, not at the end.
- The three existing prompt-editor test files still pass, plus a new browser test proving caret-position insertion.
- No behaviour change to: draft persistence, the slash menu, skill chips, submit, or the skill-page prefill.

## What is already done (do not redo)

Landed this week, all on `main`:

- Draft persistence rewritten. Task drafts are seeded from the task state the route already loads (`useHydrateTaskDraft`), with a write-behind that flushes on route leave and `pagehide`. `atomWithStorage` is gone. See `apps/studio/src/client/atoms/prompt-value.ts`.
- The `docChanged` guard in `dispatchTransaction`. **Keep it.** It is correct independent of this refactor.
- A three-project Vitest setup. See the Tests section of `apps/studio/AGENTS.md` before writing any test.

## The change

### 1. Contract

```ts
export interface PromptEditorRef {
  clear: () => void;
  focus: () => void;
  getValue: () => string;
  insertText: (text: string) => void; // at the caret
  moveCaretToEnd: () => void;
  setValue: (text: string) => void; // external reset / prefill
}
```

`element` is not on it: once every writer goes through the handle, nothing wants
the DOM node.

`value` becomes `defaultValue`, read once when the `EditorState` is built (it already is: `promptDocFromText(initialProps.value)`). Delete the effect below it.

`onChange` keeps firing on every edit, so the atom stays an accurate mirror. **`setValue` and `insertText` must fire `onChange` too**, or anything reading the atom goes stale for a tick.

### 2. Route the external writers

Eight sites write the draft while the editor is mounted, which is exactly what `defaultValue` alone cannot serve.

- `appendToPromptAtom` — five call sites (`markdown.tsx`, `message-part/tool-generate-image.tsx`, `message-part/file-tool-card.tsx`, `message-part/tool-read-file.tsx`, `task/task-files.tsx` ×2). **These files do not need to change.** Keep the `{ key, update }` signature and change only the implementation: resolve the live handle instead of the value atom, call `insertText`, drop the `requestAnimationFrame` (it exists only to wait for the controlled round trip).
- `routes/_app/skills/$name.tsx:114` and `studio-modals/skill-modal.tsx:79` — prefills, both ref-guarded already. Move to `setValue`.
- `prompt-input.tsx` `clear()` — already imperative; point it at the handle.

`promptDraftRefFamily` currently holds `HTMLElement | null` (`prompt-value.ts:172`). Widen it to hold the editor handle. Only two consumers: `prompt-input.tsx:163` sets it, `task/chat.tsx:193` reads it.

That also retires `focusPromptDraft` (`prompt-value.ts`), which hand-rolls a DOM `Range` inside a contenteditable to place the caret. Its one caller is `chat.tsx:198`. ProseMirror should own its own selection: `handle.moveCaretToEnd()`.

### 3. Leave the mirror alone

`prompt-input.tsx` reads `value` at two places besides the editor: line 375 (submit-enabled) and line 430 (`handleSubmit`). Both keep working off the mirrored atom.

**Do not** try to remove the per-keystroke re-render as part of this. It needs a derived `hasContent` boolean plus reading text via `getValue()` at submit, and it is a separate decision. Land the correctness change first.

## Verification

Write the caret test **first**, watch it fail, then refactor. From `apps/studio`:

- `pnpm test:browser` — the browser project. `prompt-editor.browser.test.tsx` already has "keeps typing where the caret is rather than at the end"; add the equivalent for `insertText`, which is the actual regression this refactor is meant to fix.
- `pnpm test:ci` — node + dom.
- `pnpm exec turbo run check:types check:lint --filter=@instrument-org/studio` from the repo root.

Then drive it by hand, because none of the above covers the draft round trip end to end. Boot Studio (`REMOTE_DEBUGGING_PORT=48160 pnpm dev` from `apps/studio`; unset `ELECTRON_RUN_AS_NODE` first), open a task, and check:

1. Type, reload immediately, draft comes back.
2. Type, leave the route inside a second, return, draft is there.
3. Click a file card's "add to prompt" with the caret mid-sentence: text lands at the caret.
4. Open a skill page: prefill appears. Submit: composer clears.

## What "read once" turned out to mean

The view is not built once per composer. `TaskSidebar` keeps the chat inside
`<Activity mode="hidden">` while the file list is showing, and hiding an
`Activity` runs every effect's cleanup: the `EditorView` is destroyed and built
again on the way back. The controlled version healed itself, because the
`[value]` effect remounted with it and pushed the current text in. Uncontrolled,
the rebuilt editor came back holding whatever it first mounted with, and a
minute of typing was gone the first time the file list was opened.

So the editor keeps `defaultValue` in a ref updated by a layout effect declared
above the one that builds the view, and builds from that. Two consequences worth
keeping in mind:

- The mirror is not only a mirror. It is what the document is restored from, so
  it has to stay accurate whether or not a view exists.
- `appendToPromptAtom` needs its no-editor branch. "Add to chat" is offered from
  the file list, which is exactly when the composer is not mounted; with no
  caret to aim at, it appends to the mirror instead.

None of the three test projects caught this. The dom test that now covers it
drives `<Activity>` directly.

## Gotchas found the hard way

- **`document.querySelector('.prompt-editor')` returns the wrong editor.** Every open tab stays mounted in one web contents, so several composers exist at once. Scope to the tab whose wrapper lacks `invisible opacity-0`, or you will read a background tab and conclude the feature is broken when it is not.
- **jsdom never delivers `selectionchange`.** A focus-driven caret test written in the `dom` project passes whether the code works or not. Anything about selection belongs in `.browser.test.tsx`.
- **Confirm every test fails against the unfixed code before keeping it.** Two of the first five tests written for this component could not fail.
- **`@/tests/render` does not resolve under `oxlint --type-aware`.** Import `../../tests/render` relatively from test files or the whole file degrades to error types.
- **`render.tsx` now exports two helpers.** `renderWithProviders` gives a fresh store; `renderWithDefaultStore` is for code writing through `getDefaultStore()`. Pick deliberately.

## Related

`docs/plans/active/semantic-prompt-composer.md` still describes the composer as "a controlled textarea", which stopped being true when it moved to ProseMirror. It needs a pass against the current code; out of scope here, but do not treat it as an accurate description of today.
