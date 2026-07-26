import { type ComponentProps, createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";

import { PromptEditor, type PromptEditorRef } from "./prompt-editor";

// What jsdom cannot observe: a real caret, a real selection, and text that
// arrives by being typed rather than by being handed in as a prop. Everything
// here needs a browser to mean anything; anything that does not belongs in
// `prompt-editor.test.tsx`, which is far cheaper to run.

const noop = () => {
  // Nothing to do: these tests assert on the document, not on submit or paste.
};

const editorProps = {
  disabled: false,
  maxHeight: 200,
  onPaste: () => false,
  onSubmit: noop,
  skills: [] as ComponentProps<typeof PromptEditor>["skills"],
};

function renderEditor(value = "") {
  const onChange = vi.fn();
  const ref = createRef<PromptEditorRef>();
  // `render` reports a thenable so it can be awaited; nothing here needs to.
  void render(
    <PromptEditor
      {...editorProps}
      autoFocus
      onChange={onChange}
      ref={ref}
      value={value}
    />,
  );
  return { onChange, ref };
}

// The editor is a contenteditable div, which carries no implicit role, so it is
// found by the label ProseMirror puts on it rather than by role.
const editor = () => page.getByLabelText("Prompt");

describe("PromptEditor in a browser", () => {
  it("reports what was typed", async () => {
    const { onChange } = renderEditor();

    await userEvent.click(editor());
    await userEvent.keyboard("hello");

    await expect.element(editor()).toHaveTextContent("hello");
    expect(onChange).toHaveBeenLastCalledWith("hello");
  });

  // The regression that emptied stored drafts: the composer mounts empty while
  // the saved draft is still loading, and anything reporting the document
  // before the user touches it overwrites what was saved. Focus is what moved
  // the caret in the app, and it is exactly the step jsdom cannot reproduce,
  // because it never delivers `selectionchange`.
  it("reports nothing when focus alone places the caret", async () => {
    const { onChange } = renderEditor("a stored draft");

    await userEvent.click(editor());

    await expect.element(editor()).toHaveTextContent("a stored draft");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps typing where the caret is rather than at the end", async () => {
    const { onChange } = renderEditor();

    await userEvent.click(editor());
    await userEvent.keyboard("ac");
    await userEvent.keyboard("{ArrowLeft}b");

    expect(onChange).toHaveBeenLastCalledWith("abc");
  });
});
