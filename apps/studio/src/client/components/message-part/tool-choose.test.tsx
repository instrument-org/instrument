import { StoreId, TaskIdSchema } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../../tests/render";
import { ToolChoose } from "./tool-choose";

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
});
