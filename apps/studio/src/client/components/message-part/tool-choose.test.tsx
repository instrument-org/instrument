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
  // The questions go up by the composer once the turn is over; drawn here as
  // the call streams in, they showed in the chat first and then jumped down.
  it.each([
    { input: undefined, name: "before its input arrives" },
    { input: { questions: ONE }, name: "with its questions in" },
  ])("draws nothing while the call streams in, $name", ({ input }) => {
    const { container } = renderWithProviders(
      <ToolChoose part={part(input)} chatId={chatId} />,
    );

    expect(container.textContent).toBe("");
  });

  /** Renders the card with the chat's open asks as given. */
  function withAsks(
    asks: ({ askers: { partId: string; sessionId: string }[] } & Record<
      string,
      unknown
    >)[],
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
        answerable: true,
        askedAt: new Date(0),
        computer: "Studio Mac",
        here: true,
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

  it("draws an answer given on another device as given, waiting for the computer that asked", async () => {
    const { container } = withAsks([
      {
        answerable: false,
        answered: {
          answer: { replies: [{ picked: ["Vue"] }] },
          by: "Sam’s iPhone",
          taken: false,
        },
        askers: [{ partId, sessionId }],
        here: false,
      },
    ]);

    await waitFor(() => {
      expect(container.textContent).toContain(
        "You answered from Sam’s iPhone. Studio Mac needs to be on for it to take effect.",
      );
    });
    expect(container.textContent).toContain("Vue");
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(container.textContent).not.toContain("No answer");
  });

  // Stopped, or asked again past: nothing will take an answer, and a row to
  // click would read as the conversation ignoring them.
  it("says the card ended once it closed unanswered", async () => {
    const { container } = withAsks([]);

    await waitFor(() => {
      expect(container.textContent).toContain("No answer");
    });
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(container.textContent).toContain("Which one?");
  });

  it("says a card closed by a reply typed in the chat was answered there, with no numbers", async () => {
    const { container } = withAsks([], { asked: true, inReply: true });

    await waitFor(() => {
      expect(container.textContent).toBe("Which one?Answered in your reply");
    });
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  // A question that carries its card waits by the composer, so the call
  // shows no buttons of its own.
  it.each([
    {
      held: true,
      name: "draws nothing while the turn that asked it runs",
      text: "",
    },
    {
      held: undefined,
      name: "points to the box below once the turn is over",
      text: "Which one? You can answer below.",
    },
  ])("$name", async ({ held, text }) => {
    const { container } = withAsks([
      {
        answerable: held === undefined,
        askers: [{ partId, sessionId }],
        card: ONE,
        held,
      },
    ]);

    await waitFor(() => {
      expect(container.textContent).toBe(text);
    });
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
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

  it("sends a click on a choice at once, with no note to go through", () => {
    const onAnswer = open();
    expect(screen.getByRole("button", { name: "Send" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.queryByRole("button", { name: "Add a note" })).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Vue" }));
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({
      replies: [{ picked: ["Vue"] }],
    });
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

  it("trades Skip for Send once the user has typed an answer of their own", () => {
    const onAnswer = open();
    const own = screen.getByLabelText("Your own answer");
    fireEvent.change(own, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Skip" })).toBeDefined();

    fireEvent.change(own, { target: { value: "Svelte" } });
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({
      replies: [{ picked: ["Svelte"] }],
    });
  });

  it.each(["Skip", "Close"])("skips the question with %s", (name) => {
    const onAnswer = open();
    fireEvent.click(screen.getByRole("button", { name }));
    expect(onAnswer).toHaveBeenCalledWith({ replies: [{ skipped: true }] });
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
    const onShow = () =>
      [...container.querySelectorAll("p")].find(
        (each) => each.getAttribute("aria-hidden") !== "true",
      )?.textContent;
    return { container, onAnswer, onShow };
  };

  it("moves on with each pick, counts several picks, and sends every answer from the last", () => {
    const { container, onAnswer, onShow } = open();
    expect(onShow()).toBe("Which team size?");
    expect(container.textContent).toContain("1 of 3");

    fireEvent.click(screen.getByRole("radio", { name: /10 agents/ }));
    expect(onShow()).toBe("Annual or monthly?");
    expect(onAnswer).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(onShow()).toBe("Which competitors?");
    expect(container.textContent).toContain("0 picked");

    // Several picks only tick boxes, so the person moves on with the arrow.
    fireEvent.click(screen.getByRole("checkbox", { name: "Zendesk" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Freshdesk" }));
    expect(container.textContent).toContain("2 picked");
    expect(onAnswer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({
      replies: [
        { picked: ["10 agents"] },
        { skipped: true },
        { picked: ["Zendesk", "Freshdesk"] },
      ],
    });
  });

  it("goes back a question with the arrow, keeping its answer, and the next pick goes to the one still waiting", () => {
    const { onAnswer, onShow } = open();
    fireEvent.click(screen.getByRole("radio", { name: /25 agents/ }));
    fireEvent.click(screen.getByRole("button", { name: "Previous question" }));

    expect(onShow()).toBe("Which team size?");
    expect(
      screen
        .getByRole("radio", { name: /25 agents/ })
        .getAttribute("aria-checked"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("radio", { name: /10 agents/ }));
    expect(onShow()).toBe("Annual or monthly?");
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("closes with every question not answered yet skipped", () => {
    const { onAnswer } = open();
    fireEvent.click(screen.getByRole("radio", { name: /25 agents/ }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onAnswer).toHaveBeenCalledWith({
      replies: [
        { picked: ["25 agents"] },
        { skipped: true },
        { skipped: true },
      ],
    });
  });
});

describe("QuestionCard detail", () => {
  const LAYOUT: ChooseQuestion[] = [
    {
      choices: [
        {
          detail: "| Plan | Price |\n| --- | --- |\n| Team | $45 |",
          label: "Table",
        },
        {
          description: "A short write-up with the numbers in it",
          label: "One-page summary",
        },
      ],
      header: "Layout",
      question: "How should I lay out the comparison?",
    },
  ];

  it("has no detail area when no choice carries detail", () => {
    const { container } = renderWithProviders(
      <QuestionCard onAnswer={vi.fn()} questions={ONE} status="open" />,
    );
    expect(container.querySelector("[data-detail]")).toBeNull();
  });

  it("shows the first choice's detail, then the one the keyboard moves to, restating a choice that has none", () => {
    const { container } = renderWithProviders(
      <QuestionCard onAnswer={vi.fn()} questions={LAYOUT} status="open" />,
    );
    const area = () => container.querySelector("[data-detail]");
    expect(area()?.querySelector("table")).not.toBeNull();

    fireEvent.focus(screen.getByRole("radio", { name: /One-page summary/ }));
    expect(area()?.querySelector("table")).toBeNull();
    expect(area()?.querySelector("[data-restated]")?.textContent).toBe(
      "One-page summaryA short write-up with the numbers in it",
    );
  });
});

describe("QuestionCard once answered", () => {
  it.each([
    {
      output: { replies: [{ skipped: true as const }] },
      text: "Which one?Skipped",
    },
    { output: { replies: [{ picked: ["Vue"] }] }, text: "Which one?Vue" },
    {
      output: { replies: [{ picked: ["Vue", "Solid, if it's ready"] }] },
      text: "Which one?Vue, “Solid, if it's ready”",
    },
    {
      output: { note: "Why not.", replies: [{ picked: ["Vue"] }] },
      text: "Which one?VueWhy not.",
    },
  ])(
    "draws $output whole, with nothing to open or click",
    ({ output, text }) => {
      const { container } = renderWithProviders(
        <QuestionCard
          onAnswer={vi.fn()}
          output={output}
          questions={ONE}
          status="closed"
        />,
      );
      expect(container.textContent).toBe(text);
      expect(screen.queryAllByRole("button")).toHaveLength(0);
      expect(container.querySelectorAll("input, textarea")).toHaveLength(0);
    },
  );

  // A reply that grades the answers (a quiz) reads against what was asked,
  // which a header like "Q2" does not say.
  it("puts each question's own words over its answer, a skipped one as skipped", () => {
    const { container } = renderWithProviders(
      <QuestionCard
        onAnswer={vi.fn()}
        output={{ replies: [{ skipped: true }, { picked: ["Fly"] }] }}
        questions={[
          ...ONE,
          {
            choices: [{ label: "Fly" }, { label: "Render" }],
            header: "Hosting",
            question: "Where should it run?",
          },
        ]}
        status="closed"
      />,
    );
    expect(
      [...container.querySelectorAll("p")].map((line) => line.textContent),
    ).toEqual(["Which one?", "Skipped", "Where should it run?", "Fly"]);
  });

  it("says a card closed by a typed reply was answered in it, once, under its questions", () => {
    const { container } = renderWithProviders(
      <QuestionCard
        inReply
        onAnswer={vi.fn()}
        questions={[...ONE, { ...ONE[0]!, question: "Which host?" }]}
        status="closed"
      />,
    );
    expect(container.textContent).toBe(
      "Which one?Which host?Answered in your reply",
    );
  });

  it("says a question never answered had no answer", () => {
    const { container } = renderWithProviders(
      <QuestionCard onAnswer={vi.fn()} questions={ONE} status="ended" />,
    );
    expect(container.textContent).toBe("Which one?No answer");
  });

  // Records an earlier build wrote in the one-question shape carry no header.
  it("leads with the question when it has no header", () => {
    const { container } = renderWithProviders(
      <QuestionCard
        onAnswer={vi.fn()}
        output={{ replies: [{ picked: ["Vue"] }] }}
        questions={[{ ...ONE[0]!, header: "" }]}
        status="closed"
      />,
    );
    expect(container.textContent).toBe("Which one?Vue");
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
