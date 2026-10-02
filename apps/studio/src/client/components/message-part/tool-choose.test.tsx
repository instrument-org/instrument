import { rpcClient } from "@/client/rpc/client";
import { StoreId, TaskIdSchema } from "@instrument-org/workspace/client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../../tests/render";
import { QuestionCard, ToolChoose } from "./tool-choose";

// `tool-choose` stands in for every body here: the guard it trips is the one
// they all have, so what is under test is the empty body rather than the
// scaffolding. It answers over RPC, so it renders with the app's providers.
const part = (input?: { choices: string[]; question: string }) =>
  ({
    input,
    metadata: {
      id: StoreId.newPartId(),
      messageId: StoreId.newMessageId(),
      sessionId: StoreId.newSessionId(),
    },
    state: input ? "input-available" : "input-streaming",
    toolCallId: "call-1",
    type: "tool-choose",
  }) as unknown as Parameters<typeof ToolChoose>[0]["part"];

const taskId = TaskIdSchema.parse("test-task");

describe("ToolChoose", () => {
  // Every row draws a chevron, because whether a body has anything in it is
  // only knowable inside the body. So opening one always has to land on
  // something: a row that opens onto nothing reads as a row that failed to
  // open, and the reader has no way to tell those apart or report either.
  it("says so rather than drawing nothing when the input has not arrived", () => {
    const { container } = renderWithProviders(
      <ToolChoose part={part()} taskId={taskId} />,
    );

    expect(container.textContent).toBe("The question has not arrived yet.");
  });

  it("draws the question once it has", () => {
    const { container } = renderWithProviders(
      <ToolChoose
        part={part({ choices: ["React", "Vue"], question: "Which one?" })}
        taskId={taskId}
      />,
    );

    expect(container.textContent).toContain("Which one?");
    expect(container.textContent).not.toContain("has not arrived");
  });

  it("offers the choices while the session is running", () => {
    const { container } = renderWithProviders(
      <ToolChoose
        part={part({ choices: ["React", "Vue"], question: "Which one?" })}
        taskId={taskId}
      />,
    );

    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.getByLabelText("Your own answer")).toBeDefined();
    expect(container.textContent).not.toContain("ended without an answer");
  });

  // An app stopped mid-turn -- an update installing itself, a crash -- leaves
  // the call unanswered on disk with nothing left to answer it to. Clicking a
  // row then reads as the conversation ignoring you.
  it("stops offering the choices once no session is left to take one", async () => {
    const { container, queryClient } = renderWithProviders(
      <ToolChoose
        part={part({ choices: ["React", "Vue"], question: "Which one?" })}
        taskId={taskId}
      />,
    );

    queryClient.setQueryData(
      rpcClient.workspace.task.live.activity.experimental_liveOptions()
        .queryKey,
      [],
    );

    await waitFor(() => {
      expect(container.textContent).toContain("ended without an answer");
    });
    expect(container.querySelectorAll("button, input")).toHaveLength(0);
    expect(container.textContent).toContain("Which one?");
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
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(onAnswer).toHaveBeenCalledWith({
      declined: true,
      note: "Ask design.",
    });
  });

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
