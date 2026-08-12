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

const messagePart = (text: string) => {
  const messageId = StoreId.newMessageId();
  const sessionId = StoreId.newSessionId();
  const part = {
    metadata: {
      createdAt: new Date("2026-01-01T00:00:00Z"),
      id: StoreId.newPartId(),
      messageId,
      sessionId,
    },
    text,
    type: "text" as const,
  };
  return {
    message: {
      id: messageId,
      metadata: { createdAt: part.metadata.createdAt, sessionId },
      parts: [part],
      role: "user" as const,
    },
    part,
  };
};

// One line of copy per line of text, so a case's height follows its line count
// instead of where the words happen to wrap.
const lines = (count: number) =>
  Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n");

async function renderMessage(text: string) {
  const { message, part } = messagePart(text);
  await renderInBrowser(
    // The bubble is sized as a share of its parent, so the parent needs a width
    // before any of it can be measured.
    <div style={{ width: 600 }}>
      <UserMessage message={message} part={part} />
    </div>,
  );

  const content = document.querySelector<HTMLElement>(
    '[data-slot="user-message-content"]',
  );
  if (!content) {
    throw new Error("the message rendered without its content element");
  }
  return {
    hasExpandTarget: () =>
      document.querySelector('[data-slot="user-message-expand"]') !== null,
    isClipped: () => content.scrollHeight > content.clientHeight,
  };
}

describe("UserMessage in a browser", () => {
  // Nine lines clear the clamp and thirty overrun it by plenty; the ones
  // between are the interesting ones, where a message is taller than one
  // candidate clamp and shorter than another.
  it.each([1, 9, 10, 11, 12, 30])(
    "offers to expand a %i-line message only when it is cut off",
    async (lineCount) => {
      const message = await renderMessage(lines(lineCount));

      // The overflow check runs in an effect, so give it a frame to land.
      await expect
        .poll(() => message.hasExpandTarget())
        .toBe(message.isClipped());
    },
  );
});
