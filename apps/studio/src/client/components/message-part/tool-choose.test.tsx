import { StoreId } from "@instrument-org/workspace/client";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ToolChoose } from "./tool-choose";

// `tool-choose` stands in for every body here: the guard it trips is the one
// they all have, and it is the only one with no hooks or task context of its
// own, so what is under test is the empty body rather than the scaffolding.
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

describe("ToolChoose", () => {
  // Every row draws a chevron, because whether a body has anything in it is
  // only knowable inside the body. So opening one always has to land on
  // something: a row that opens onto nothing reads as a row that failed to
  // open, and the reader has no way to tell those apart or report either.
  it("says so rather than drawing nothing when the input has not arrived", () => {
    const { container } = render(<ToolChoose part={part()} />);

    expect(container.textContent).toBe("The question has not arrived yet.");
  });

  it("draws the question once it has", () => {
    const { container } = render(
      <ToolChoose
        part={part({ choices: ["React", "Vue"], question: "Which one?" })}
      />,
    );

    expect(container.textContent).toContain("Which one?");
    expect(container.textContent).not.toContain("has not arrived");
  });
});
