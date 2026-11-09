import { type ComponentProps } from "react";
import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Relative, not `@/tests/render`: see prompt-editor.test.tsx.
import { renderWithProviders } from "../../tests/render";
import { osConventions } from "../lib/utils";
import { PromptEditor } from "./prompt-editor";

vi.mock("./window/apps-by-slug", () => ({
  useAppsBySlug: () => new Map(),
}));

function renderEditor(
  props: Partial<ComponentProps<typeof PromptEditor>> = {},
) {
  const onSubmit = vi.fn();
  const { container } = renderWithProviders(
    <PromptEditor
      actions={[]}
      apps={[]}
      autoFocus={false}
      bounds={null}
      defaultValue=""
      disabled={false}
      onChange={() => undefined}
      onPaste={() => false}
      onSubmit={onSubmit}
      placeholder="Talk to Instrument"
      skills={[]}
      {...props}
    />,
  );
  const dom = container.querySelector<HTMLElement>(".prompt-editor");
  if (!dom) {
    throw new Error("no editor");
  }
  return { dom, onSubmit };
}

const withCommand = () => ({ [osConventions().commandKey]: true });

describe("the command key with Enter", () => {
  it("does what the box was given for it, in place of sending", () => {
    const onCommandEnter = vi.fn();
    const { dom, onSubmit } = renderEditor({ onCommandEnter });
    fireEvent.keyDown(dom, { key: "Enter", ...withCommand() });
    expect(onCommandEnter).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("sends as Enter does when the box was given nothing for it", () => {
    const { dom, onSubmit } = renderEditor();
    fireEvent.keyDown(dom, { key: "Enter", ...withCommand() });
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("leaves Enter alone to send", () => {
    const onCommandEnter = vi.fn();
    const { dom, onSubmit } = renderEditor({ onCommandEnter });
    fireEvent.keyDown(dom, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onCommandEnter).not.toHaveBeenCalled();
  });
});
