import { renderWithProviders } from "@/tests/render";
import {
  type SessionMessage,
  StoreId,
  TaskIdSchema,
} from "@instrument-org/workspace/client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { AssistantMessagesFooter } from "./assistant-messages-footer";

const sessionId = StoreId.newSessionId();

function assistantMessage(
  ...texts: string[]
): SessionMessage.AssistantWithParts {
  const messageId = StoreId.newMessageId();
  return {
    id: messageId,
    metadata: {
      createdAt: new Date(0),
      finishReason: "stop",
      modelId: "test-model",
      providerId: "test-provider",
      sessionId,
    },
    parts: texts.map((text) => ({
      metadata: {
        createdAt: new Date(0),
        id: StoreId.newPartId(),
        messageId,
        sessionId,
      },
      text,
      type: "text" as const,
    })),
    role: "assistant",
  };
}

// A turn's prose brackets its tool work: one message per step, so the text
// arrives as separate parts and is drawn as separate blocks. The copy has to
// keep them apart too, or the paste reads "plan:Done." where the screen showed
// a paragraph break.
test("copies a turn's text parts as the separate blocks they are drawn as", async () => {
  const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });

  renderWithProviders(
    <AssistantMessagesFooter
      alwaysVisible
      id={TaskIdSchema.parse("quarterly-numbers")}
      messages={[
        assistantMessage("Here is the plan:"),
        // A whitespace-only part, which the transcript never draws (a done
        // text part that is only whitespace is skipped), so the copy holding
        // one would paste a blank block the screen does not have.
        assistantMessage("  \n"),
        assistantMessage("Done. Open output/report.md."),
      ]}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Copy" }));

  await waitFor(() => {
    expect(writeText).toHaveBeenCalledWith(
      "Here is the plan:\n\nDone. Open output/report.md.",
    );
  });
});
