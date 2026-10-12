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
import { ToolCallBody } from "./message-part/tool-call";

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

// A run killed between the reasoning block opening and its first delta. The
// state says streaming for the rest of the part's life, and there is nothing
// under it to draw.
const blankReasoningPart: SessionMessagePart.ReasoningPart = {
  metadata: {
    createdAt: new Date(0),
    id: StoreId.newPartId(),
    messageId,
    sessionId,
  },
  state: "streaming",
  text: "",
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

// What the transcript gets back for one part, which is what decides whether the
// row exists at all. A part that draws nothing has to come back as nothing: the
// chat stream counts the nodes it was handed, so an element that renders empty
// still holds a place in its group.
function chatPartNode(
  part: SessionMessagePart.ReasoningPart,
  { isAgentRunning }: { isAgentRunning: boolean },
) {
  const message = {
    id: messageId,
    metadata: { createdAt: new Date(0), sessionId },
    parts: [part],
    role: "assistant",
  } as SessionMessage.WithParts;

  const ctx = {
    isAgentRunning,
    isDeveloperMode: false,
    isToolStreaming: () => isAgentRunning,
    lastMessageId: messageId,
    onRetry: () => {
      // Nothing to do: these tests assert on the reasoning row, not on retry.
    },
    // Never read for a reasoning part, so the fixture stops at the boundary.
    chatInfo: undefined as never,
  } satisfies RenderPartContext;

  return renderChatPart({
    browserStatusContextAdded: false,
    ctx,
    message,
    part,
    partIndex: 0,
  });
}

function renderReasoning(parts: SessionMessagePart.Type[]) {
  const message = {
    id: messageId,
    metadata: { createdAt: new Date(0), sessionId },
    parts,
    role: "assistant",
  } as SessionMessage.WithParts;

  const ctx = {
    isAgentRunning: true,
    isDeveloperMode: false,
    isToolStreaming: () => true,
    lastMessageId: messageId,
    onRetry: () => {
      // Nothing to do: these tests assert on the reasoning row, not on retry.
    },
    // Never read for a reasoning part, so the fixture stops at the boundary.
    chatInfo: undefined as never,
  } satisfies RenderPartContext;

  renderWithProviders(
    <>
      {renderChatPart({
        browserStatusContextAdded: false,
        ctx,
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

  it("gives the transcript no row for a blank block the run left behind", () => {
    expect(
      chatPartNode(blankReasoningPart, { isAgentRunning: false }),
    ).toBeNull();
  });

  // The row that says the agent is thinking, which arrives before the first
  // word of it does. Reading the part alone is what confuses the two.
  it("keeps the row for a blank block the run is still inside of", () => {
    expect(
      chatPartNode(blankReasoningPart, { isAgentRunning: true }),
    ).not.toBeNull();
  });

  it("keeps a block that wrote something, whatever the run is doing", () => {
    expect(
      chatPartNode(reasoningPart, { isAgentRunning: false }),
    ).not.toBeNull();
  });
});

describe("renderChatPart in the chat", () => {
  // A command still being written: hidden in the chat for its kind, not its
  // state, and drawn in developer mode whatever its state.
  const bashPart: SessionMessagePart.ToolPart = {
    ...toolPart,
    type: "tool-bash",
  };
  const doneReasoningPart: SessionMessagePart.ReasoningPart = {
    ...reasoningPart,
    state: "done",
  };

  function chatNode(
    part: SessionMessagePart.Type,
    isDeveloperMode: boolean,
    { isStreaming = false }: { isStreaming?: boolean } = {},
  ) {
    const message = {
      id: messageId,
      metadata: { createdAt: new Date(0), sessionId },
      parts: [part],
      role: "assistant",
    } as SessionMessage.WithParts;
    return renderChatPart({
      browserStatusContextAdded: false,
      ctx: {
        isAgentRunning: false,
        isDeveloperMode,
        isToolStreaming: () => isStreaming,
        lastMessageId: messageId,
        onRetry: () => {
          // Nothing to do: these tests assert on whether the row exists.
        },
        presentation: "chat",
        // Handed to the row, never read while building it.
        chatInfo: undefined as never,
      },
      message,
      part,
      partIndex: 0,
    });
  }

  it.each([
    ["a command", bashPart],
    ["reasoning", doneReasoningPart],
  ])("hides %s, and shows it in developer mode", (_case, part) => {
    expect(chatNode(part, false)).toBeNull();
    expect(chatNode(part, true)).not.toBeNull();
  });

  // A question the model is still writing has nothing to ask yet, and once
  // written it is the card alone, with no row above it to open or shut it.
  it.each([false, true])(
    "draws a question as its card once it has arrived (developer mode: %s)",
    (isDeveloperMode) => {
      const choosePart = {
        ...toolPart,
        input: { question: "Which one?" },
        state: "input-streaming",
        type: "tool-choose",
      } satisfies SessionMessagePart.ToolPart;
      expect(
        chatNode(choosePart, isDeveloperMode, { isStreaming: true }),
      ).toBeNull();
      expect(
        chatNode(
          {
            ...choosePart,
            input: { choices: ["This", "That"], question: "Which one?" },
            state: "input-available",
          },
          isDeveloperMode,
          { isStreaming: true },
        ),
      ).toMatchObject({ type: ToolCallBody });
    },
  );
});
