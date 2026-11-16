import { rpcClient } from "@/client/rpc/client";
import {
  ChatIdSchema,
  type ChooseQuestion,
  StoreId,
} from "@instrument-org/workspace/client";
import {
  act,
  fireEvent,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { expect, it } from "vitest";

import { renderWithProviders } from "../../tests/render";
import { QuestionDock, useQuestionBox, useQuestionDock } from "./question-dock";

const chatId = ChatIdSchema.parse("test-chat");

const card = (question: string): ChooseQuestion[] => [
  { choices: [{ label: "Yes" }, { label: "No" }], header: "", question },
];

function Dock() {
  return <QuestionDock dock={useQuestionDock(chatId)} />;
}

/** Renders the dock with the chat's open asks as given. */
function withAsks(asks: Record<string, unknown>[]) {
  const rendered = renderWithProviders(<Dock />);
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

/** The trade between the card and the box, with no keyboard to move. */
function questionBox(initial: { askId?: string; isBoxEmpty: boolean }) {
  return renderHook(
    (props: { askId?: string; isBoxEmpty: boolean }) =>
      useQuestionBox({
        askId: props.askId,
        composerRef: { current: null },
        dockRef: { current: null },
        focusBox: () => {
          // Nothing on screen to focus.
        },
        isActive: false,
        isBoxEmpty: props.isBoxEmpty,
      }),
    { initialProps: initial },
  );
}

it("hides an empty box while a card is up, and brings it back once the card goes", () => {
  const { rerender, result } = questionBox({ isBoxEmpty: true });
  expect(result.current.isBoxHidden).toBe(false);

  rerender({ askId: "ask-1", isBoxEmpty: true });
  expect(result.current.isBoxHidden).toBe(true);

  rerender({ askId: undefined, isBoxEmpty: true });
  expect(result.current.isBoxHidden).toBe(false);
});

it("keeps a box with something in it for that card, even once it is emptied", () => {
  const { rerender, result } = questionBox({ isBoxEmpty: false });

  rerender({ askId: "ask-1", isBoxEmpty: false });
  expect(result.current.isBoxHidden).toBe(false);
  rerender({ askId: "ask-1", isBoxEmpty: true });
  expect(result.current.isBoxHidden).toBe(false);

  // The next question starts over.
  rerender({ askId: "ask-2", isBoxEmpty: true });
  expect(result.current.isBoxHidden).toBe(true);
});

it("brings the box back for something put in it while hidden, such as a dictation", () => {
  const { rerender, result } = questionBox({
    askId: "ask-1",
    isBoxEmpty: true,
  });
  expect(result.current.isBoxHidden).toBe(true);

  rerender({ askId: "ask-1", isBoxEmpty: false });
  expect(result.current.isBoxHidden).toBe(false);
});

it("brings the box back beside the folded card for the model picker", () => {
  const { result } = questionBox({ askId: "ask-1", isBoxEmpty: true });

  act(() => {
    result.current.showBox();
  });

  expect(result.current).toMatchObject({
    isBoxHidden: false,
    isCollapsed: true,
  });
});

it("folds the card beside the box on Chat about this, and hides an empty box again on Back", () => {
  const { result } = questionBox({ askId: "ask-1", isBoxEmpty: true });

  act(() => {
    result.current.onChatAbout();
  });
  expect(result.current).toMatchObject({
    isBoxHidden: false,
    isCollapsed: true,
  });

  act(() => {
    result.current.onBack();
  });
  expect(result.current).toMatchObject({
    isBoxHidden: true,
    isCollapsed: false,
  });
});
