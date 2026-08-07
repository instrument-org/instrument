import {
  type SessionMessagePart,
  StoreId,
} from "@instrument-org/workspace/client";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ToolStartActivity } from "./tool-start-activity";

const sessionId = StoreId.newSessionId();
const messageId = StoreId.newMessageId();

function activityPart(input: undefined | { title?: string }) {
  const part: SessionMessagePart.ToolPart = {
    input,
    metadata: {
      createdAt: new Date(0),
      id: StoreId.newPartId(),
      messageId,
      sessionId,
    },
    state: "input-streaming",
    toolCallId: StoreId.ToolCallSchema.parse("call-1"),
    type: "tool-start_activity",
  };
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  if (part.type !== "tool-start_activity") {
    throw new TypeError("Expected a start_activity part");
  }
  return part;
}

describe("ToolStartActivity", () => {
  it("heads the group with the title the agent gave it", () => {
    const { container } = render(
      <ToolStartActivity
        isRunning={false}
        part={activityPart({ title: "Charting the quarterly numbers" })}
      />,
    );

    expect(container.textContent).toBe("Charting the quarterly numbers");
  });

  it.each([
    ["nothing has streamed in yet", undefined],
    ["the title is still arriving", {}],
    ["the model called it with a blank title", { title: "   " }],
  ])("renders nothing while %s", (_case, input) => {
    const { container } = render(
      <ToolStartActivity isRunning={false} part={activityPart(input)} />,
    );

    expect(container.innerHTML).toBe("");
  });
});
