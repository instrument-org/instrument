import { StoreId } from "@instrument-org/workspace/client";

import { registerSession, SessionBuilder } from "../helpers";

// Fixture for the empty-leading-assistant-message edge case. The first
// assistant message in the consecutive group has no visible parts (only a
// `step-start`, which renders nothing inline). The second assistant message
// in the same group does have visible parts. The logo should still render
// once for the group, anchored before the first visible content.
const builder = new SessionBuilder();
const sessionId = builder.getSessionId();

const userMsgId = StoreId.newMessageId();
const assistantMsg1Id = StoreId.newMessageId();
const assistantMsg2Id = StoreId.newMessageId();

registerSession({
  messages: [
    {
      id: userMsgId,
      metadata: { createdAt: builder.nextTime(), sessionId },
      parts: [builder.textPart("Read a file please.", userMsgId)],
      role: "user",
    },
    // Step 1: empty visible content (only a step-start, which renders nothing
    // inline). In the original per-message logo emission this would have
    // emitted a logo above an empty message; in the boundary-aware version
    // the logo correctly anchors to the next message's first visible part.
    {
      id: assistantMsg1Id,
      metadata: {
        createdAt: builder.nextTime(),
        finishReason: "tool-calls",
        modelId: "claude-sonnet-4.5",
        providerId: "anthropic",
        sessionId,
      },
      parts: [
        {
          metadata: {
            createdAt: builder.nextTime(),
            id: StoreId.newPartId(),
            messageId: assistantMsg1Id,
            sessionId,
            stepCount: 0,
          },
          type: "step-start",
        },
      ],
      role: "assistant",
    },
    // Step 2: actual visible content. Logo header for the consecutive
    // assistant group should appear above this message's content.
    {
      id: assistantMsg2Id,
      metadata: {
        createdAt: builder.nextTime(),
        finishReason: "stop",
        modelId: "claude-sonnet-4.5",
        providerId: "anthropic",
        sessionId,
      },
      parts: [
        builder.toolPart(assistantMsg2Id, "output-available", {
          input: { explanation: "Read config", filePath: "./config.ts" },
          output: {
            content: "export const config = { port: 3000 };",
            displayedLines: 1,
            filePath: "./config.ts",
            hasMoreLines: false,
            offset: 1,
            state: "exists",
            totalLines: 1,
            truncatedByBytes: false,
          },
          type: "tool-read_file",
        }),
        builder.textPart("Done reading the config.", assistantMsg2Id),
      ],
      role: "assistant",
    },
  ],
  name: "Tools: Empty Leading Assistant Message",
});
