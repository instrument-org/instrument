import { rpcClient } from "@/client/rpc/client";
import { StoreId, ChatIdSchema } from "@instrument-org/workspace/client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../../tests/render";
import { QuestionCard, ToolChoose } from "./tool-choose";

// `tool-choose` stands in for every body here: the guard it trips is the one
// they all have, so what is under test is the empty body rather than the
// scaffolding. It answers over RPC, so it renders with the app's providers.
const part = (
  input?: { choices: string[]; question: string },
  output?: { answer?: { selectedChoice: string }; asked: true },
) =>
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

  it("draws the question once it has", () => {
    const { container } = renderWithProviders(
      <ToolChoose
        part={part({ choices: ["React", "Vue"], question: "Which one?" })}
        chatId={chatId}
      />,
    );

    expect(container.textContent).toContain("Which one?");
    expect(container.textContent).not.toContain("has not arrived");
  });

  const asked = { choices: ["React", "Vue"], question: "Which one?" };

  /** Renders the card with the chat's open asks as given. */
  function withAsks(
    asks: { askers: { partId: string; sessionId: string }[] }[],
    output: Parameters<typeof part>[1] = { asked: true },
  ) {
    const rendered = renderWithProviders(
      <ToolChoose part={part(asked, output)} chatId={chatId} />,
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
        ...ask,
      })) as never,
    );
    return rendered;
  }

  it("offers the choices while its question is open on the chat", async () => {
    const { container } = withAsks([{ askers: [{ partId, sessionId }] }]);

    await waitFor(() => {
      expect(screen.getAllByRole("radio")).toHaveLength(2);
    });
    expect(screen.getByLabelText("Your own answer")).toBeDefined();
    expect(container.textContent).not.toContain("ended without an answer");
  });

  // The person wrote in the chat instead, or stopped it: nothing will take
  // an answer, and clicking a row would read as the conversation ignoring
  // them.
  it("says the question ended once it closed unanswered", async () => {
    const { container } = withAsks([]);

    await waitFor(() => {
      expect(container.textContent).toContain("ended without an answer");
    });
    expect(container.querySelectorAll("button, input")).toHaveLength(0);
    expect(container.textContent).toContain("Which one?");
  });

  it("draws the answer written onto the call", async () => {
    const { container } = withAsks([], {
      answer: { selectedChoice: "Vue" },
      asked: true,
    });

    await waitFor(() => {
      expect(container.querySelectorAll("button, input")).toHaveLength(0);
    });
    expect(container.textContent).not.toContain("ended without an answer");
    expect(container.textContent).toContain("Vue");
  });
});

describe("QuestionCard", () => {
  const open = () => {
    const onAnswer = vi.fn();
    renderWithProviders(
      <QuestionCard
        choices={["React", "Vue"]}
        onAnswer={onAnswer}
        question="Which one?"
        status="open"
      />,
    );
    return onAnswer;
  };

  it("answers with a choice on one click", () => {
    const onAnswer = open();
    fireEvent.click(screen.getByRole("radio", { name: "Vue" }));
    expect(onAnswer).toHaveBeenCalledWith({ selectedChoice: "Vue" });
  });

  it("answers in the user's own words on Return", () => {
    const onAnswer = open();
    const own = screen.getByLabelText("Your own answer");
    fireEvent.change(own, { target: { value: "  Svelte  " } });
    fireEvent.keyDown(own, { key: "Enter" });
    expect(onAnswer).toHaveBeenCalledWith({ selectedChoice: "Svelte" });
  });

  it("sends nothing for a blank answer of their own", () => {
    const onAnswer = open();
    fireEvent.keyDown(screen.getByLabelText("Your own answer"), {
      key: "Enter",
    });
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("sends the note with whichever answer follows it, a skip included", () => {
    const onAnswer = open();
    fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
    fireEvent.change(screen.getByLabelText("Note"), {
      target: { value: "Ask design. " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Skip with note" }));
    expect(onAnswer).toHaveBeenCalledWith({
      declined: true,
      note: "Ask design.",
    });
  });

  it.each([
    { name: "Vue", sending: { selectedChoice: "Vue" } },
    { name: "Your own answer", sending: { selectedChoice: "Svelte" } },
  ])(
    "draws $sending.selectedChoice as picked while it is sending",
    ({ name, sending }) => {
      renderWithProviders(
        <QuestionCard
          choices={["React", "Vue"]}
          onAnswer={vi.fn()}
          question="Which one?"
          sending={sending}
          status="open"
        />,
      );
      const radios = screen.getAllByRole("radio");
      expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual(
        name === "Vue" ? ["false", "true"] : ["false", "false"],
      );
      expect(radios.every((radio) => radio.hasAttribute("disabled"))).toBe(
        true,
      );
      expect(screen.getByLabelText("Your own answer")).toHaveProperty(
        "disabled",
        true,
      );
    },
  );

  it.each([
    { output: { declined: true as const }, text: "You skipped this question." },
    { output: { selectedChoice: "Svelte" }, text: "Svelte" },
    { output: { note: "Why not.", selectedChoice: "Vue" }, text: "Why not." },
  ])("draws $output once answered", ({ output, text }) => {
    const { container } = renderWithProviders(
      <QuestionCard
        choices={["React", "Vue"]}
        onAnswer={vi.fn()}
        output={output}
        question="Which one?"
        status="closed"
      />,
    );
    expect(container.textContent).toContain(text);
    expect(container.querySelectorAll("button, input")).toHaveLength(0);
  });
});
