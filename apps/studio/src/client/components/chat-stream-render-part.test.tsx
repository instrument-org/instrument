import {
  type SessionMessage,
  type SessionMessagePart,
  StoreId,
} from "@instrument-org/workspace/client";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

// Relative, not `@/tests/render`: oxlint's type-aware pass does not resolve the
// alias to this module and every access downstream then reads as an error type.
import { renderWithProviders } from "../../tests/render";
import {
  renderChatPart,
  type RenderPartContext,
} from "./chat-stream-render-part";

const sessionId = StoreId.newSessionId();
const messageId = StoreId.newMessageId();

const reasoningPart: SessionMessagePart.ReasoningPart = {
  metadata: {
    createdAt: new Date(0),
    id: StoreId.newPartId(),
    messageId,
    sessionId,
  },
  state: "streaming",
  text: "I should read the file",
  type: "reasoning",
};

const toolPart: SessionMessagePart.ToolPart = {
  input: undefined,
  metadata: {
    createdAt: new Date(0),
    id: StoreId.newPartId(),
    messageId,
    sessionId,
  },
  state: "input-streaming",
  toolCallId: StoreId.ToolCallSchema.parse("call-1"),
  type: "tool-read_file",
};

function renderReasoning(parts: SessionMessagePart.Type[]) {
  const message = {
    id: messageId,
    metadata: { createdAt: new Date(0), sessionId },
    parts,
    role: "assistant",
  } as SessionMessage.WithParts;

  const ctx = {
    assetBaseUrl: "https://assets.test",
    isAgentRunning: true,
    isDeveloperMode: false,
    isToolStreaming: () => true,
    lastMessageId: messageId,
    onRetry: () => {
      // Nothing to do: these tests assert on the reasoning row, not on retry.
    },
    // Never read for a reasoning part, so the fixture stops at the boundary.
    task: undefined as never,
  } satisfies RenderPartContext;

  renderWithProviders(
    <>
      {renderChatPart({
        browserStatusContextAdded: false,
        ctx,
        isGroupWorking: false,
        message,
        part: reasoningPart,
        partIndex: 0,
      })}
    </>,
  );
}

describe("renderChatPart reasoning", () => {
  it("counts up while the model is still thinking", () => {
    renderReasoning([reasoningPart]);

    expect(screen.getByText(/Thinking for/)).toBeTruthy();
  });

  // Providers can hold a reasoning block's end event until the step finishes,
  // so the part is still `streaming` while the call it decided on runs.
  it("stops counting once a later part supersedes it", () => {
    renderReasoning([reasoningPart, toolPart]);

    expect(screen.queryByText(/Thinking for/)).toBeNull();
    expect(screen.getByText("Thought")).toBeTruthy();
  });
});
