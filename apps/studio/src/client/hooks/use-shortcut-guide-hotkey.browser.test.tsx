import { shortcutGuideModalAtom } from "@/client/atoms/shortcut-guide-modal";
import { resetStudioModals } from "@/client/atoms/studio-modal";
import { blockingModalCountAtom } from "@/client/atoms/tab-navigation-block";
import { PromptEditor } from "@/client/components/prompt-editor";
import { getDefaultStore } from "jotai";
import { type ComponentProps } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";

import { useShortcutGuideHotkey } from "./use-shortcut-guide-hotkey";

// `?` is a character before it is a shortcut, so the guard that keeps it out of
// an editor is the whole design. Only a real browser can answer it: jsdom would
// be asserting against an event target this test constructed by hand, and the
// prompt editor is a ProseMirror contenteditable whose focused node is
// whichever one the caret landed in.

const store = getDefaultStore();

const noop = () => {
  // These tests assert on the document and the modal slot, not on submit.
};

function Host() {
  useShortcutGuideHotkey();
  return (
    <>
      <button type="button">outside the editor</button>
      <PromptEditor
        // Focus is what each test establishes for itself, since where the caret
        // is when `?` is pressed is the whole question.
        autoFocus={false}
        defaultValue=""
        disabled={false}
        maxHeight={200}
        onChange={noop}
        onPaste={() => false}
        onSubmit={noop}
        skills={[] as ComponentProps<typeof PromptEditor>["skills"]}
      />
    </>
  );
}

const editor = () => page.getByLabelText("Prompt");
const isGuideOpen = () => store.get(shortcutGuideModalAtom) !== null;

describe("useShortcutGuideHotkey in a browser", () => {
  // The browser project loads no shared setup, so this resets what the dom
  // project's `setup-dom` would have.
  beforeEach(() => {
    resetStudioModals();
    store.set(blockingModalCountAtom, 0);
  });

  it("types ? into the prompt editor instead of opening the guide", async () => {
    void render(<Host />);

    await userEvent.click(editor());
    await userEvent.keyboard("why?");

    await expect.element(editor()).toHaveTextContent("why?");
    expect(isGuideOpen()).toBe(false);
  });

  it("opens the guide when ? is pressed outside an editor", async () => {
    void render(<Host />);

    await userEvent.click(page.getByRole("button"));
    await userEvent.keyboard("?");

    expect(isGuideOpen()).toBe(true);
  });
});
