import { renderWithProviders } from "@/tests/render";
import { type SessionMessage, StoreId } from "@instrument-org/workspace/client";
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
  const writeText = vi.fn<(text: string) => Promise<void>>(() =>
    Promise.resolve(),
  );
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });

  renderWithProviders(
    <AssistantMessagesFooter
      alwaysVisible
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

// A call the app's quit cut off is stamped when the app closed, after the
// step's own finish, and the clock time runs to it.
test("times a turn to the last part that ended, past its message's finish", () => {
  const message = assistantMessage();
  renderWithProviders(
    <AssistantMessagesFooter
      alwaysVisible
      messages={[
        {
          ...message,
          metadata: {
            ...message.metadata,
            finishedAt: new Date(5000),
            msToFinish: 5000,
          },
          parts: [
            {
              metadata: {
                createdAt: new Date(0),
                endedAt: new Date(20_000),
                id: StoreId.newPartId(),
                messageId: message.id,
                sessionId,
              },
              text: "Done.",
              type: "text",
            },
          ],
        },
      ]}
    />,
  );

  expect(screen.getByText("20s")).toBeTruthy();
});

test("offers Branch only where the transcript can branch", () => {
  renderWithProviders(
    <AssistantMessagesFooter alwaysVisible messages={[assistantMessage()]} />,
  );

  expect(screen.queryByRole("button", { name: "Branch from here" })).toBeNull();
});

// The dialog quotes the reply from what the footer already has, and the
// branch is made only once the person confirms it.
test("asks before branching, quoting the reply it is under", async () => {
  const onBranch = vi.fn<() => Promise<void>>(() => Promise.resolve());
  renderWithProviders(
    <AssistantMessagesFooter
      alwaysVisible
      messages={[assistantMessage("At 10 agents we're 18% under Zendesk.")]}
      onBranch={onBranch}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Branch from here" }));

  const dialog = await screen.findByRole("alertdialog");
  expect(dialog.textContent).toContain("Branch from this reply?");
  expect(dialog.textContent).toContain("At 10 agents we're 18% under Zendesk.");
  expect(onBranch).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Branch" }));

  await waitFor(() => {
    expect(onBranch).toHaveBeenCalledOnce();
  });
  await waitFor(() => {
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
