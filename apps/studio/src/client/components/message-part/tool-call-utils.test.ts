import {
  type SessionMessagePart,
  StoreId,
} from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { isToolPartRunning } from "./tool-call-utils";

const sessionId = StoreId.newSessionId();
const messageId = StoreId.newMessageId();

function metadata(startedAt?: Date) {
  return {
    createdAt: new Date(0),
    id: StoreId.newPartId(),
    messageId,
    sessionId,
    startedAt,
  };
}

const input = { filePath: "notes.md" };
const toolCallId = StoreId.ToolCallSchema.parse("call-1");
const output = {
  content: "hello",
  displayedLines: 1,
  filePath: "notes.md",
  hasMoreLines: false,
  modifiedAt: 0,
  offset: 1,
  state: "exists",
  totalLines: 1,
  truncatedByBytes: false,
} as const;

const queued: SessionMessagePart.ToolPart = {
  input,
  metadata: metadata(),
  state: "input-available",
  toolCallId,
  type: "tool-read_file",
};

const started: SessionMessagePart.ToolPart = {
  input,
  metadata: metadata(new Date(1)),
  state: "input-available",
  toolCallId,
  type: "tool-read_file",
};

const arriving: SessionMessagePart.ToolPart = {
  input,
  metadata: metadata(),
  state: "input-streaming",
  toolCallId,
  type: "tool-read_file",
};

const preliminary: SessionMessagePart.ToolPart = {
  input,
  metadata: { ...metadata(new Date(1)), endedAt: new Date(2) },
  output,
  preliminary: true,
  state: "output-available",
  toolCallId,
  type: "tool-read_file",
};

const finished: SessionMessagePart.ToolPart = {
  input,
  metadata: { ...metadata(new Date(1)), endedAt: new Date(2) },
  output,
  state: "output-available",
  toolCallId,
  type: "tool-read_file",
};

const failed: SessionMessagePart.ToolPart = {
  errorText: "no",
  input,
  metadata: { ...metadata(new Date(1)), endedAt: new Date(2) },
  state: "output-error",
  toolCallId,
  type: "tool-read_file",
};

describe("isToolPartRunning", () => {
  it("separates a call that has started from one still waiting its turn", () => {
    expect(isToolPartRunning(started)).toBe(true);
    expect(isToolPartRunning(queued)).toBe(false);
  });

  it("counts input that is still arriving, which is the model writing the call", () => {
    expect(isToolPartRunning(arriving)).toBe(true);
  });

  it("counts a preliminary output, which a streaming tool emits mid-run", () => {
    expect(isToolPartRunning(preliminary)).toBe(true);
    expect(isToolPartRunning(finished)).toBe(false);
  });

  it("is over once the call failed", () => {
    expect(isToolPartRunning(failed)).toBe(false);
  });
});
