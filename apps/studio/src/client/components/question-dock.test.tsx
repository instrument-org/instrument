import { rpcClient } from "@/client/rpc/client";
import {
  ChatIdSchema,
  type ChooseQuestion,
  StoreId,
} from "@instrument-org/workspace/client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";

import { renderWithProviders } from "../../tests/render";
import { QuestionDock } from "./question-dock";

const chatId = ChatIdSchema.parse("test-chat");

const card = (question: string): ChooseQuestion[] => [
  { choices: [{ label: "Yes" }, { label: "No" }], header: "", question },
];

/** Renders the dock with the chat's open asks as given. */
function withAsks(asks: Record<string, unknown>[]) {
  const rendered = renderWithProviders(<QuestionDock chatId={chatId} />);
  rendered.queryClient.setQueryData(
    rpcClient.workspace.chats.live.asks.experimental_liveOptions({
      input: { id: chatId },
    }).queryKey,
    asks.map((ask, index) => ({
      answerable: true,
      askedAt: new Date(index),
      askers: [
        { partId: StoreId.newPartId(), sessionId: StoreId.newSessionId() },
      ],
      computer: "Studio Mac",
      here: true,
      id: `ask-${index}`,
      kind: "question",
      messageId: StoreId.newMessageId(),
      ...ask,
    })) as never,
  );
  return rendered;
}

it("shows the first of the turn's questions, and how many are waiting", async () => {
  const { container } = withAsks([
    { card: card("Which planet?"), question: "Which planet?" },
    { card: card("Which moon?"), question: "Which moon?" },
  ]);

  await waitFor(() => {
    expect(container.textContent).toContain("Which planet?");
  });
  expect(container.textContent).toContain("1 of 2");
  expect(container.textContent).not.toContain("Which moon?");
});

it.each([
  { held: true, name: "one held while its turn runs" },
  { card: undefined, name: "one an earlier build asked, under its call" },
  { answerable: false, name: "one already answered" },
])("shows nothing for $name", async (ask) => {
  const { container } = withAsks([
    { card: card("Which planet?"), question: "Which planet?", ...ask },
  ]);

  await waitFor(() => {
    expect(container.textContent).toBe("");
  });
});

it("moves on to the next question once one is answered", async () => {
  const { container } = withAsks([
    { card: card("Which planet?"), question: "Which planet?" },
    { card: card("Which moon?"), question: "Which moon?" },
  ]);
  await waitFor(() => {
    expect(container.textContent).toContain("Which planet?");
  });

  fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
  fireEvent.click(screen.getByRole("button", { name: /^Send/ }));

  await waitFor(() => {
    expect(container.textContent).toContain("Which moon?");
  });
  expect(container.textContent).not.toContain("1 of");
});
