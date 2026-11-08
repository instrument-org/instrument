import { type Draft } from "@/shared/drafts";
import { renderInBrowser } from "@/tests/render-browser";
import { AnimatePresence } from "motion/react";
import { type ReactNode, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { ComposerFrame } from "../composer-frame";
import { ChatBar } from "./chat-window";
import { ComposeBar } from "./compose-window";

// A window along the foot stays on screen for its exit animation, holding the
// handlers of the render before it left. A press landing on it there runs them
// against a window that has since moved on.

const DRAFT: Draft = {
  createdAt: 1,
  id: "draft",
  updatedAt: 1,
  words: "Words",
};

/** Takes the bar away when its button is pressed, the way pressing a window's own buttons does. */
function Leaves({
  bar,
}: {
  bar: (leave: (run: () => void) => () => void) => ReactNode;
}) {
  const [isUp, setUp] = useState(true);
  return (
    <AnimatePresence>
      {isUp &&
        bar((run) => () => {
          setUp(false);
          run();
        })}
    </AnimatePresence>
  );
}

describe("a bar on its way out", () => {
  it.each([
    [
      "a chat's",
      "chat-bar",
      (onOpen: () => void) => (
        <ChatBar
          chat={undefined}
          key="bar"
          onClose={() => undefined}
          onOpen={onOpen}
          right={0}
        />
      ),
    ],
    [
      "a draft's",
      "compose-bar",
      (onOpen: () => void) => (
        <ComposeBar
          draft={DRAFT}
          key="bar"
          onClose={() => undefined}
          onOpen={onOpen}
          right={0}
        />
      ),
    ],
  ])("%s takes no press", async (_name, slot, bar) => {
    const onOpen = vi.fn();
    await renderInBrowser(
      <div className="relative h-40 w-96">
        <Leaves bar={(leave) => bar(leave(onOpen))} />
      </div>,
    );
    const pressed = page.getByRole("button").first();

    await userEvent.click(pressed);

    const leaving = document.querySelector(`[data-slot=${slot}]`);
    expect(leaving).not.toBeNull();
    expect(leaving?.hasAttribute("inert")).toBe(true);
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

describe("the attachments row on its way out", () => {
  it("takes no press, since the chips in it are not told they are going", async () => {
    function WithAttachment() {
      const [isAttached, setAttached] = useState(true);
      return (
        <ComposerFrame
          actions={null}
          attachments={
            isAttached && (
              <button
                onClick={() => {
                  setAttached(false);
                }}
                type="button"
              >
                Remove
              </button>
            )
          }
          maxHeight={null}
        >
          Words
        </ComposerFrame>
      );
    }
    await renderInBrowser(<WithAttachment />);

    await userEvent.click(page.getByRole("button", { name: "Remove" }));

    const row = document.querySelector("[data-slot=composer-attachments]");
    expect(row).not.toBeNull();
    expect(row?.hasAttribute("inert")).toBe(true);
  });
});
