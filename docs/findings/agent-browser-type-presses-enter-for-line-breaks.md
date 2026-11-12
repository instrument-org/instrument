# agent-browser's `type` presses Enter for every line break

**Status:** worked around in the wrapper (`agent-browser-typed-text.ts`), which types text with a line break inside it as one insertion; checked 2026-11-12 against agent-browser 0.39.4 and the `browser-typing-paragraphs` eval case.

## Symptom

A memory import asked claude.ai a question of several paragraphs. The agent typed it with `agent-browser type`, and each paragraph arrived in claude.ai as a message of its own; the agent noticed, opened a new chat and sent it again in one piece. The text reached the right page the whole time: this is not the keyboard-focus leak in [cdp-keyboard-input-follows-window-focus](cdp-keyboard-input-follows-window-focus.md), where text lands in Studio's own window.

## Cause

`type <sel> <text>` and `keyboard type <text>` (upstream `cli/src/native/interaction.rs`, `type_text_into_active_context`) send printable characters with `Input.insertText` one at a time and every `\n`, `\r` and `\t` as a real key event, so a line break is an Enter keydown carrying `"\r"`. A chat composer sends on Enter, a form submits on it, and a search runs on it. Playwright's and Puppeteer's `keyboard.type` do the same, so a separate Chromium would not change it. By the time the command reaches the CDP gateway, a typed line break is the same `Input.dispatchKeyEvent` as `press Enter`, so `dispatch-command.ts` cannot tell them apart.

## What each input path does with a line break

Measured in a standalone Electron 45.2.3 rig (a `<webview>` guest with a textarea, a form input, a contenteditable, a ProseMirror composer that sends on Enter and breaks a line on Shift+Enter, a React controlled input, and the ProseMirror composer again in a cross-origin iframe), with the text `"line one\n\nline two"`:

| Path | ProseMirror composer | Form input | Textarea, contenteditable |
| --- | --- | --- | --- |
| CDP Enter keydown, with or without `text` | sends | submits (with `text`), even with Shift | line break |
| CDP Shift+Enter | hard break | submits (with `text`) | line break |
| `webContents.sendInputEvent` Enter / Shift+Enter | sends / hard break | submits, either | line break |
| In-page synthetic `KeyboardEvent` Enter | sends (ProseMirror's keymap acts on an untrusted keydown) | no submit | nothing |
| One `Input.insertText` or `execCommand('insertText')` holding the whole text | three paragraphs, not sent | newlines become spaces, no submit | line breaks |
| Lines joined with `execCommand('insertLineBreak')` | the breaks become spaces | | line breaks |

Every key path treats Enter as send or submit. Only text inserted in one piece keeps its line breaks and never sends or submits. Mapping each `\n` to Shift+Enter works in a composer but submits a single-line form, so it is unsafe without knowing the target.

## Workaround

The wrapper rewrites `type` and `keyboard type` when the text has a line break before its end (`typedTextRuns`): `type <sel>` becomes `focus <sel>` and one `keyboard inserttext`, `type <sel> --clear` becomes `fill`, and `keyboard type` becomes `keyboard inserttext`. Line breaks the text ends with stay Enter presses, once each, since `type <field> "query\n"` is how a search is typed and sent. Each run keeps the invocation's global flags and the first failure ends the command. Against the real CLI and a contenteditable chat page that sends on Enter, the old `type` sent three messages and the rewritten runs sent one, line breaks kept.

Text the agent types with `\t` still presses Tab for each tab, which moves focus; nothing has needed that changed yet.

## Upstream

Not reported. A `type` that inserts multi-line runs whole would change what `type "query\n"` means to every caller, so the wrapper's rule (inner breaks inserted, trailing ones pressed) is ours rather than an upstream default.
