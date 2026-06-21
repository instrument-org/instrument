import {
  StoreId,
} from "@instrument-org/workspace/client";

import {
  registerSession,
  SessionBuilder,
} from "../helpers";

// Fixture that reproduces the cross-message tool-call boundary spacing bug:
// sequential tool calls split across multiple assistant messages (multi-step)
// should not receive a double spacer at the message boundary.
const builder = new SessionBuilder();
const sessionId = builder.getSessionId();

const userMsgId = StoreId.newMessageId();
const assistantMsg1Id = StoreId.newMessageId();
const assistantMsg2Id = StoreId.newMessageId();
const assistantMsg3Id = StoreId.newMessageId();

registerSession({
  messages: [
    {
      id: userMsgId,
      metadata: { createdAt: builder.nextTime(), sessionId },
      parts: [
        builder.textPart("Read a few files, then write a summary.", userMsgId),
      ],
      role: "user",
    },
    // Step 1: ends with tool calls (no trailing text)
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
        builder.textPart("Let me start by reading the files.", assistantMsg1Id),
        builder.toolPart(assistantMsg1Id, "output-available", {
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
        builder.toolPart(assistantMsg1Id, "output-available", {
          input: { explanation: "Read index", filePath: "./index.ts" },
          output: {
            content: 'import "./config";',
            displayedLines: 1,
            filePath: "./index.ts",
            hasMoreLines: false,
            offset: 1,
            state: "exists",
            totalLines: 1,
            truncatedByBytes: false,
          },
          type: "tool-read_file",
        }),
      ],
      role: "assistant",
    },
    // Step 2: starts immediately with more tool calls (no leading text)
    // The boundary between msg1's last tool call and msg2's first tool call
    // is where the double-spacer bug appears.
    {
      id: assistantMsg2Id,
      metadata: {
        createdAt: builder.nextTime(),
        finishReason: "tool-calls",
        modelId: "claude-sonnet-4.5",
        providerId: "anthropic",
        sessionId,
      },
      parts: [
        builder.toolPart(assistantMsg2Id, "output-available", {
          input: { explanation: "Read utils", filePath: "./utils.ts" },
          output: {
            content: "export function noop() {}",
            displayedLines: 1,
            filePath: "./utils.ts",
            hasMoreLines: false,
            offset: 1,
            state: "exists",
            totalLines: 1,
            truncatedByBytes: false,
          },
          type: "tool-read_file",
        }),
        builder.toolPart(assistantMsg2Id, "output-available", {
          input: {
            command: "echo done",
            explanation: "Verify environment",
            timeoutMs: 5000,
          },
          output: {
            command: "echo done",
            commands: ["echo"],
            durationMs: 12,
            exitCode: 0,
            output: "done",
          },
          type: "tool-bash",
        }),
      ],
      role: "assistant",
    },
    // Step 3: tool calls first, then a closing text block
    {
      id: assistantMsg3Id,
      metadata: {
        createdAt: builder.nextTime(),
        finishReason: "stop",
        modelId: "claude-sonnet-4.5",
        providerId: "anthropic",
        sessionId,
      },
      parts: [
        builder.toolPart(assistantMsg3Id, "output-available", {
          input: {
            content: "# Summary\n\nAll files read successfully.",
            explanation: "Write summary file",
            filePath: "./SUMMARY.md",
          },
          output: { filePath: "./SUMMARY.md" },
          type: "tool-write_file",
        }),
        builder.textPart(
          "Done! I've read all the files and written a summary to `SUMMARY.md`.",
          assistantMsg3Id,
        ),
      ],
      role: "assistant",
    },
  ],
  name: "Tools: Multi-Step Boundary",
});
