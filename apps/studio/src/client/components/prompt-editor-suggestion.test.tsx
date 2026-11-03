import { act, type ComponentProps, createRef } from "react";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Relative, not `@/tests/render`: see prompt-editor.test.tsx.
import { renderWithProviders } from "../../tests/render";
import { PromptEditor, type PromptEditorRef } from "./prompt-editor";

vi.mock("./window/apps-by-slug", () => ({
  useAppsBySlug: () => new Map(),
}));

const SUGGESTION = "Move the duplicates to the Trash";

function renderOffering(
  props: Partial<ComponentProps<typeof PromptEditor>> = {},
) {
  const onChange = vi.fn();
  const ref = createRef<PromptEditorRef>();
  const { container } = renderWithProviders(
    <PromptEditor
      actions={[]}
      apps={[]}
      autoFocus={false}
      bounds={null}
      defaultValue=""
      disabled={false}
      onChange={onChange}
      onPaste={() => false}
      onSubmit={() => undefined}
      placeholder="Talk to Instrument"
      ref={ref}
      skills={[]}
      suggestion={SUGGESTION}
      {...props}
    />,
  );
  const editor = () => container.querySelector<HTMLElement>(".prompt-editor");
  return { editor, onChange, ref };
}

describe("a suggestion in the empty box", () => {
  it("shows in place of the placeholder", () => {
    const { editor } = renderOffering();
    expect(screen.getByText(SUGGESTION)).toBeTruthy();
    expect(editor()?.dataset.placeholder).toBe("");
  });

  it("goes in as the person's words with Tab", () => {
    const { editor, onChange, ref } = renderOffering();
    const dom = editor();
    if (!dom) {
      throw new Error("no editor");
    }
    fireEvent.keyDown(dom, { key: "Tab" });
    expect(ref.current?.getValue()).toBe(SUGGESTION);
    expect(onChange).toHaveBeenLastCalledWith(SUGGESTION);
    expect(screen.queryByRole("button", { name: "Use suggestion" })).toBeNull();
  });

  it("goes in with a click on its key", () => {
    const { ref } = renderOffering();
    fireEvent.click(screen.getByRole("button", { name: "Use suggestion" }));
    expect(ref.current?.getValue()).toBe(SUGGESTION);
  });

  it("goes away once anything is written, and the placeholder comes back with an empty box", () => {
    const { editor, ref } = renderOffering();
    act(() => {
      ref.current?.setValue("Keep them");
    });
    expect(screen.queryByText(SUGGESTION)).toBeNull();
    act(() => {
      ref.current?.clear();
    });
    expect(screen.getByText(SUGGESTION)).toBeTruthy();
    expect(editor()?.dataset.placeholder).toBe("");
  });

  it("leaves Tab alone with nothing suggested", () => {
    const { editor, ref } = renderOffering({ suggestion: undefined });
    const dom = editor();
    if (!dom) {
      throw new Error("no editor");
    }
    fireEvent.keyDown(dom, { key: "Tab" });
    expect(ref.current?.getValue()).toBe("");
    expect(dom.dataset.placeholder).toBe("Talk to Instrument");
  });
});
