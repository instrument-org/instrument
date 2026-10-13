import { renderInBrowser } from "@/tests/render-browser";
import { StoreId } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { UserMessage } from "./user-message";

// A collapsed message shows a fade and turns its whole bubble into a
// click-to-expand target, and it should do that exactly when it is actually
// cutting text off. Deciding that means comparing the content's height against
// the clamp, which is a measurement: jsdom reports every height as 0, so a test
// there passes whichever number the component measures against.
//
// So none of this asserts a pixel height. Each case asks the rendered bubble
// whether it is clipping anything and requires the affordance to agree, which
// keeps holding if the clamp is ever retuned.

const messagePart = (text: string) => ({
  metadata: {
    createdAt: new Date("2026-01-01T00:00:00Z"),
    id: StoreId.newPartId(),
    messageId: StoreId.newMessageId(),
    sessionId: StoreId.newSessionId(),
  },
  text,
  type: "text" as const,
});

// One line of copy per line of text, so a case's height follows its line count
// instead of where the words happen to wrap.
const lines = (count: number) =>
  Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n");

async function renderMessage(text: string) {
  const screen = await renderInBrowser(
    // The bubble is sized as a share of its parent, so the parent needs a width
    // before any of it can be measured.
    <div style={{ width: 600 }}>
      <UserMessage part={messagePart(text)} />
    </div>,
  );

  const content = document.querySelector<HTMLElement>(
    '[data-slot="user-message-content"]',
  );
  if (!content) {
    throw new Error("the message rendered without its content element");
  }
  return {
    ...screen,
    content,
    hasExpandTarget: () =>
      document.querySelector('[data-slot="user-message-expand"]') !== null,
    isClipped: () => content.scrollHeight > content.clientHeight,
  };
}

describe("UserMessage in a browser", () => {
  // Fourteen lines clear the clamp and thirty overrun it by plenty; the ones
  // between are the interesting ones, where a message is taller than one
  // candidate clamp and shorter than another.
  it.each([1, 14, 15, 16, 17, 30])(
    "offers to expand a %i-line message only when it is cut off",
    async (lineCount) => {
      const message = await renderMessage(lines(lineCount));

      // The overflow check runs in an effect, so give it a frame to land.
      await expect
        .poll(() => message.hasExpandTarget())
        .toBe(message.isClipped());
    },
  );

  // A fade alone read as a message that ended a little early, so the cut is
  // also said in words, on a row that is the control. The rest of the bubble
  // still answers a press, through that row's stretched box rather than a
  // second, unnamed control.
  it("says a clipped message has more and opens it from anywhere on it", async () => {
    const screen = await renderMessage(lines(30));
    const expand = screen.getByRole("button", { name: "Show more" });
    await expect.element(expand).toBeVisible();

    // A point on the clipped text belongs to the row's control.
    const textBox = screen.content.getBoundingClientRect();
    expect(
      document.elementFromPoint(
        textBox.left + textBox.width / 2,
        textBox.top + 10,
      ),
    ).toBe(expand.element());

    await expand.click();
    const collapse = screen.getByRole("button", { name: "Show less" });
    await expect.element(collapse).toBeVisible();
    expect(
      screen.container.querySelector('[data-slot="user-message-expand"]'),
    ).toBeNull();

    await collapse.click();
    await expect
      .element(screen.getByRole("button", { name: "Show more" }))
      .toBeVisible();
  });
});
