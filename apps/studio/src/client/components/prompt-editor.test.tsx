import {
  act,
  type ComponentProps,
  createRef,
  type ReactElement,
  type RefObject,
} from "react";
import { describe, expect, it, vi } from "vitest";

// Relative, not `@/tests/render`: oxlint's type-aware pass does not resolve the
// alias to this module and every access downstream then reads as an error type.
import { renderWithProviders } from "../../tests/render";
import { PromptEditor, type PromptEditorRef } from "./prompt-editor";

const noop = () => {
  // Nothing to do: these tests assert on onChange, not on submit or paste.
};

const editorProps = {
  disabled: false,
  maxHeight: 200,
  onPaste: () => false,
  onSubmit: noop,
  skills: [] as ComponentProps<typeof PromptEditor>["skills"],
};

interface RenderedEditor {
  onChange: ReturnType<typeof vi.fn>;
  ref: RefObject<null | PromptEditorRef>;
  rerender: (ui: ReactElement) => void;
  text: () => null | string;
}

function renderEditor({
  autoFocus = false,
  value = "",
}: { autoFocus?: boolean; value?: string } = {}): RenderedEditor {
  const onChange = vi.fn();
  const ref = createRef<PromptEditorRef>();
  const { container, rerender } = renderWithProviders(
    <PromptEditor
      {...editorProps}
      autoFocus={autoFocus}
      onChange={onChange}
      ref={ref}
      value={value}
    />,
  );

  return {
    onChange,
    ref,
    rerender,
    text: () => container.querySelector(".prompt-editor")?.textContent ?? null,
  };
}

describe("PromptEditor", () => {
  it("renders the value it is given", () => {
    expect(renderEditor({ value: "a draft" }).text()).toBe("a draft");
  });

  it("takes an externally changed value", () => {
    const { rerender, text } = renderEditor({ value: "first" });
    expect(text()).toBe("first");

    rerender(
      <PromptEditor
        {...editorProps}
        autoFocus={false}
        onChange={noop}
        value="second"
      />,
    );
    expect(text()).toBe("second");
  });

  // The composer starts empty while the stored draft is still loading in, so
  // anything that reports the document before the user has touched it announces
  // that empty document as the draft and overwrites what was saved. Caret
  // movement dispatches a transaction like an edit does, which is how this got
  // out once already.
  //
  // In the app the caret is moved by focus, not by this method. jsdom does not
  // deliver `selectionchange`, so ProseMirror never sees a focus-driven
  // selection here and a test written that way would pass with or without the
  // guard. This drives the same transaction directly instead.
  it("does not report a change when only the caret moves", () => {
    const { onChange, ref } = renderEditor({ value: "kept" });

    act(() => {
      ref.current?.moveCaretToEnd();
    });

    expect(onChange).not.toHaveBeenCalled();
  });
});
