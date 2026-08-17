import {
  act,
  Activity,
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
  actions: [],
  // The box the editor's menu is placed against. Nothing here opens it, and
  // jsdom has no layout to measure against anyway.
  bounds: null,
  disabled: false,
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
  defaultValue = "",
}: { autoFocus?: boolean; defaultValue?: string } = {}): RenderedEditor {
  const onChange = vi.fn();
  const ref = createRef<PromptEditorRef>();
  const { container, rerender } = renderWithProviders(
    <PromptEditor
      {...editorProps}
      autoFocus={autoFocus}
      defaultValue={defaultValue}
      onChange={onChange}
      ref={ref}
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
  it("renders the value it starts with", () => {
    expect(renderEditor({ defaultValue: "a draft" }).text()).toBe("a draft");
  });

  // The document is ProseMirror's, and a prop cannot take it back: a re-render
  // carrying different text is the mirror catching up with an edit, not an
  // instruction to replace what the user is typing.
  it("ignores a changed defaultValue", () => {
    const { rerender, text } = renderEditor({ defaultValue: "first" });
    expect(text()).toBe("first");

    rerender(
      <PromptEditor
        {...editorProps}
        autoFocus={false}
        defaultValue="second"
        onChange={noop}
      />,
    );
    expect(text()).toBe("first");
  });

  it("takes an external write through the handle", () => {
    const { onChange, ref, text } = renderEditor({ defaultValue: "first" });

    act(() => {
      ref.current?.setValue("second");
    });

    expect(text()).toBe("second");
    // Anything mirroring the text hears about a write it did not make.
    expect(onChange).toHaveBeenLastCalledWith("second");
  });

  it("clears through the handle", () => {
    const { onChange, ref, text } = renderEditor({ defaultValue: "a draft" });

    act(() => {
      ref.current?.clear();
    });

    expect(text()).toBe("");
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  // The task page keeps the composer inside a hidden `<Activity>` while the
  // file list is showing, and hiding one runs every effect's cleanup: the
  // ProseMirror view is destroyed and built again on the way back. What it is
  // built from has to be the text as it stands, not the text this component
  // first mounted with, because "add to chat" can land in the draft while the
  // file list is the thing on screen.
  it("comes back from being hidden with the current value", () => {
    const Host = ({
      mode,
      value,
    }: {
      mode: "hidden" | "visible";
      value: string;
    }) => (
      <Activity mode={mode}>
        <PromptEditor
          {...editorProps}
          autoFocus={false}
          defaultValue={value}
          onChange={noop}
        />
      </Activity>
    );
    const { container, rerender } = renderWithProviders(
      <Host mode="visible" value="first" />,
    );
    const text = () =>
      container.querySelector(".prompt-editor")?.textContent ?? null;
    expect(text()).toBe("first");

    rerender(<Host mode="hidden" value="first" />);
    rerender(<Host mode="hidden" value="second" />);
    rerender(<Host mode="visible" value="second" />);

    expect(text()).toBe("second");
  });

  it("reads its document back", () => {
    const { ref } = renderEditor({ defaultValue: "a draft" });

    expect(ref.current?.getValue()).toBe("a draft");
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
    const { onChange, ref } = renderEditor({ defaultValue: "kept" });

    act(() => {
      ref.current?.moveCaretToEnd();
    });

    expect(onChange).not.toHaveBeenCalled();
  });
});
