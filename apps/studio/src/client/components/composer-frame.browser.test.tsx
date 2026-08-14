// The frame's whole job is a measured one -- a box that stops at its cap with
// every row still inside it -- and jsdom has no layout engine, so an assertion
// about it there would pass whatever the classes said. The editor here is the
// real one: what overflowed the box was a long draft rendered by ProseMirror,
// not a stand-in of a known height.
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ComposerFrame } from "./composer-frame";
import { PromptEditor } from "./prompt-editor";

vi.mock("@/client/components/skill-mention", () => ({
  SkillMention: ({ name }: { name: string }) => <span>/{name}</span>,
}));

const noop = () => {
  // These tests assert on layout, not on what the editor reports.
};

const LONG_DRAFT = Array.from(
  { length: 40 },
  (_, line) => `line ${line} of a draft long enough to need scrolling`,
).join("\n");

// The 48px square an attached file renders as, and the 40px button the composer
// sends with, without the icons and image loading either one really carries.
const CHIP_SIZE = 48;
const ACTION_SIZE = 40;

async function renderFrame({
  attachmentCount = 0,
  draft = "",
  maxHeight = 400,
}: { attachmentCount?: number; draft?: string; maxHeight?: number } = {}) {
  await render(
    <div style={{ width: 480 }}>
      <ComposerFrame
        actions={
          <button
            style={{ height: ACTION_SIZE, width: ACTION_SIZE }}
            type="button"
          >
            Send
          </button>
        }
        attachments={
          attachmentCount > 0 &&
          Array.from({ length: attachmentCount }, (_, index) => (
            <div
              key={index}
              style={{ flexShrink: 0, height: CHIP_SIZE, width: CHIP_SIZE }}
            />
          ))
        }
        maxHeight={maxHeight}
      >
        <PromptEditor
          actions={[]}
          autoFocus={false}
          defaultValue={draft}
          disabled={false}
          onChange={noop}
          onPaste={() => false}
          onSubmit={noop}
          skills={[]}
        />
      </ComposerFrame>
    </div>,
  );

  const find = (selector: string) => {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) {
      throw new Error(`${selector} is not mounted`);
    }
    return element;
  };
  const scroller = find('[aria-label="Prompt"]').parentElement;
  if (!scroller) {
    throw new Error("the editor is not inside a scroller");
  }

  return {
    actions: find('[data-slot="composer-actions"]'),
    attachments: () => find('[data-slot="composer-attachments"]'),
    frame: find('[data-slot="composer-frame"]'),
    scroller,
  };
}

describe("ComposerFrame in a browser", () => {
  it("hugs a short draft", async () => {
    const { frame } = await renderFrame({ draft: "hello" });

    expect(frame.getBoundingClientRect().height).toBeLessThan(400);
  });

  it("stops growing at its cap", async () => {
    const { frame } = await renderFrame({ draft: LONG_DRAFT });

    expect(frame.getBoundingClientRect().height).toBeLessThanOrEqual(400);
  });

  // The regression, and what it looked like: the row holding the editor was
  // squeezed by everything else in the box while the editor inside it kept a
  // height of its own, so 60-odd px of draft was painted over the buttons. The
  // buttons themselves never moved, which is why this asks where the text ends
  // rather than where the actions row sits.
  it.each([
    { attachmentCount: 0, maxHeight: 400 },
    { attachmentCount: 1, maxHeight: 400 },
    // Enough chips to fill the attachments row past its own cap, in a box small
    // enough that the editor at its floor still does not leave room for it.
    { attachmentCount: 24, maxHeight: 240 },
  ])(
    "keeps the draft off the actions with $attachmentCount attached and a $maxHeight cap",
    async ({ attachmentCount, maxHeight }) => {
      const { actions, frame, scroller } = await renderFrame({
        attachmentCount,
        draft: LONG_DRAFT,
        maxHeight,
      });

      const box = frame.getBoundingClientRect();
      const buttons = actions.getBoundingClientRect();
      expect(box.height).toBeLessThanOrEqual(maxHeight);
      expect(scroller.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        buttons.top,
      );
      // Inside the box's padding, not merely inside its border.
      expect(buttons.bottom).toBeLessThanOrEqual(box.bottom - 16);
      // The draft is long enough that the box is full: without this the
      // assertions above would hold for a composer with nothing in it.
      expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
    },
  );

  // Attachments give last: shrinking them while the editor still has room to
  // scroll would clip a chip nobody asked to hide.
  it("leaves the attachments at full height while the editor can give", async () => {
    const { attachments } = await renderFrame({
      attachmentCount: 1,
      draft: LONG_DRAFT,
    });

    // The chip inside the row's own 8px padding.
    expect(attachments().getBoundingClientRect().height).toBe(CHIP_SIZE + 16);
  });
});
