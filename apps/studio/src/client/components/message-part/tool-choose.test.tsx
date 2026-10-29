import { rpcClient } from "@/client/rpc/client";
import {
  ChatIdSchema,
  type ChooseQuestion,
  StoreId,
} from "@instrument-org/workspace/client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../../tests/render";
import { QuestionCard, ToolChoose } from "./tool-choose";

const ONE: ChooseQuestion[] = [
  {
    choices: [{ label: "React" }, { label: "Vue" }],
    header: "Framework",
    question: "Which one?",
  },
];

// `tool-choose` stands in for every body here: the guard it trips is the one
// they all have, so what is under test is the empty body rather than the
// scaffolding. It answers over RPC, so it renders with the app's providers.
// Input and output are what the records hold, which an earlier build wrote
// in its own shape, so they are typed as loosely as a record is.
const part = (input?: unknown, output?: unknown) =>
  ({
    input,
    metadata: {
      id: partId,
      messageId: StoreId.newMessageId(),
      sessionId,
    },
    output,
    state: output
      ? "output-available"
      : input
        ? "input-available"
        : "input-streaming",
    toolCallId: "call-1",
    type: "tool-choose",
  }) as unknown as Parameters<typeof ToolChoose>[0]["part"];

const partId = StoreId.newPartId();
const sessionId = StoreId.newSessionId();

const chatId = ChatIdSchema.parse("test-task");

describe("ToolChoose", () => {
  // Every row draws a chevron, because whether a body has anything in it is
  // only knowable inside the body. So opening one always has to land on
  // something: a row that opens onto nothing reads as a row that failed to
  // open, and the reader has no way to tell those apart or report either.
  it("says so rather than drawing nothing when the input has not arrived", () => {
    const { container } = renderWithProviders(
      <ToolChoose part={part()} chatId={chatId} />,
    );

    expect(container.textContent).toBe("The question has not arrived yet.");
  });

  it.each([
    { input: { questions: ONE }, name: "a card of questions" },
    {
      input: { choices: ["React", "Vue"], question: "Which one?" },
      name: "an earlier build's one question",
    },
  ])("draws $name once it has arrived", ({ input }) => {
    const { container } = renderWithProviders(
      <ToolChoose part={part(input)} chatId={chatId} />,
    );

    expect(container.textContent).toContain("Which one?");
    expect(container.textContent).not.toContain("has not arrived");
  });

  /** Renders the card with the chat's open asks as given. */
  function withAsks(
    asks: { askers: { partId: string; sessionId: string }[] }[],
    output: unknown = { asked: true },
  ) {
    const rendered = renderWithProviders(
      <ToolChoose part={part({ questions: ONE }, output)} chatId={chatId} />,
    );
    rendered.queryClient.setQueryData(
      rpcClient.workspace.chats.live.asks.experimental_liveOptions({
        input: { id: chatId },
      }).queryKey,
      asks.map((ask) => ({
        askedAt: new Date(0),
        id: "ask-1",
        kind: "question",
        messageId: StoreId.newMessageId(),
        question: "Which one?",
        questions: ["Which one?"],
        ...ask,
      })) as never,
    );
    return rendered;
  }

  it("offers the choices while its card is open on the chat", async () => {
    const { container } = withAsks([{ askers: [{ partId, sessionId }] }]);

    await waitFor(() => {
      expect(screen.getAllByRole("radio")).toHaveLength(2);
    });
    expect(screen.getByLabelText("Your own answer")).toBeDefined();
    expect(container.textContent).not.toContain("No answer");
  });

  // The person wrote in the chat instead, or stopped it: nothing will take
  // an answer, and a row to click would read as the conversation ignoring
  // them.
  it("says the card ended once it closed unanswered", async () => {
    const { container } = withAsks([]);

    await waitFor(() => {
      expect(container.textContent).toContain("No answer");
    });
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(container.textContent).toContain("Which one?");
  });

  it.each([
    { answer: { replies: [{ picked: ["Vue"] }] }, name: "the answer" },
    { answer: { selectedChoice: "Vue" }, name: "an earlier build's answer" },
  ])("draws $name written onto the call", async ({ answer }) => {
    const { container } = withAsks([], { answer, asked: true });

    await waitFor(() => {
      expect(container.textContent).toContain("Vue");
    });
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(container.textContent).not.toContain("No answer");
  });
});

describe("QuestionCard with one question", () => {
  const open = () => {
    const onAnswer = vi.fn();
    renderWithProviders(
      <QuestionCard onAnswer={onAnswer} questions={ONE} status="open" />,
    );
    return onAnswer;
  };

  // A misclick can be put right before anything reaches the agent.
  it("picks on a click and sends on Send", () => {
    const onAnswer = open();
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("radio", { name: "React" }));
    fireEvent.click(screen.getByRole("radio", { name: "Vue" }));
    expect(onAnswer).not.toHaveBeenCalled();
    expect(
      screen
        .getAllByRole("radio")
        .map((radio) => radio.getAttribute("aria-checked")),
    ).toEqual(["false", "true"]);

    fireEvent.click(send);
    expect(onAnswer).toHaveBeenCalledWith({ replies: [{ picked: ["Vue"] }] });
  });

  it("answers in the user's own words on Return", () => {
    const onAnswer = open();
    const own = screen.getByLabelText("Your own answer");
    fireEvent.change(own, { target: { value: "  Svelte  " } });
    fireEvent.keyDown(own, { key: "Enter" });
    expect(onAnswer).toHaveBeenCalledWith({
      replies: [{ picked: ["Svelte"] }],
    });
  });

  it("sends nothing for a blank answer of their own", () => {
    const onAnswer = open();
    fireEvent.keyDown(screen.getByLabelText("Your own answer"), {
      key: "Enter",
    });
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("takes a note after the pick, and sends it with a skip too", () => {
    const onAnswer = open();
    fireEvent.click(screen.getByRole("radio", { name: "Vue" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
    fireEvent.change(screen.getByLabelText("Note"), {
      target: { value: "Ask design. " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Skip with note" }));
    expect(onAnswer).toHaveBeenCalledWith({
      note: "Ask design.",
      replies: [{ skipped: true }],
    });
  });
});

describe("QuestionCard with several questions", () => {
  const SEVERAL: ChooseQuestion[] = [
    {
      choices: [
        { description: "Where most customers are", label: "10 agents" },
        { label: "25 agents" },
      ],
      header: "Team size",
      question: "Which team size?",
    },
    {
      choices: [{ label: "Annual" }, { label: "Monthly" }],
      header: "Billing",
      question: "Annual or monthly?",
    },
    {
      choices: [
        { label: "Zendesk" },
        { label: "Intercom" },
        { label: "Freshdesk" },
      ],
      header: "Competitors",
      multiSelect: true,
      question: "Which competitors?",
    },
  ];

  const open = () => {
    const onAnswer = vi.fn();
    const { container } = renderWithProviders(
      <QuestionCard onAnswer={onAnswer} questions={SEVERAL} status="open" />,
    );
    return { container, onAnswer };
  };

  it("steps through the questions and sends every answer together from Review", () => {
    const { container, onAnswer } = open();
    expect(container.textContent).toContain("Which team size?");

    fireEvent.click(screen.getByRole("radio", { name: /10 agents/ }));
    expect(container.textContent).toContain("Annual or monthly?");

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(container.textContent).toContain("Which competitors?");

    // Several picks only tick boxes, so the person moves on with Next.
    fireEvent.click(screen.getByRole("checkbox", { name: "Zendesk" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Freshdesk" }));
    expect(onAnswer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(container.textContent).toContain("Zendesk, Freshdesk");
    fireEvent.change(screen.getByLabelText("Note"), {
      target: { value: "List prices only." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send answers" }));
    expect(onAnswer).toHaveBeenCalledWith({
      note: "List prices only.",
      replies: [
        { picked: ["10 agents"] },
        { skipped: true },
        { picked: ["Zendesk", "Freshdesk"] },
      ],
    });
  });

  it("goes back to a question from its header, keeping its answer", () => {
    const { container } = open();
    fireEvent.click(screen.getByRole("radio", { name: /25 agents/ }));
    fireEvent.click(screen.getByRole("button", { name: /Team size/ }));

    expect(container.textContent).toContain("Which team size?");
    expect(
      screen
        .getByRole("radio", { name: /25 agents/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });
});

describe("QuestionCard once answered", () => {
  it.each([
    { output: { replies: [{ skipped: true as const }] }, text: "Skipped" },
    { output: { replies: [{ picked: ["Svelte"] }] }, text: "Svelte" },
    {
      output: { note: "Why not.", replies: [{ picked: ["Vue"] }] },
      text: "Why not.",
    },
  ])("draws $output as a line", ({ output, text }) => {
    const { container } = renderWithProviders(
      <QuestionCard
        onAnswer={vi.fn()}
        output={output}
        questions={ONE}
        status="closed"
      />,
    );
    expect(container.textContent).toContain(text);
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(container.querySelectorAll("input")).toHaveLength(0);
  });

  it("opens to show what else was offered", () => {
    const { container } = renderWithProviders(
      <QuestionCard
        onAnswer={vi.fn()}
        output={{ replies: [{ picked: ["Vue"] }] }}
        questions={ONE}
        status="closed"
      />,
    );
    expect(container.textContent).not.toContain("React");

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(container.textContent).toContain("React");
  });

  it("draws an answer on its way as given, with nothing left to click", () => {
    const { container } = renderWithProviders(
      <QuestionCard
        onAnswer={vi.fn()}
        questions={ONE}
        sending={{ replies: [{ picked: ["Vue"] }] }}
        status="open"
      />,
    );
    expect(container.textContent).toContain("Vue");
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });
});
