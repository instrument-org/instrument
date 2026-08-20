import {
  type SessionMessagePart,
  StoreId,
} from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { isToolPartRunning, stripPatchHeader } from "./tool-call-utils";

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

describe("stripPatchHeader", () => {
  // The preamble the patch library writes, spelled out: it belongs to the
  // workspace package and is not a dependency here, so this is a copy of its
  // output rather than a call to it.
  const realPatch = [
    "Index: src/utils/helpers.ts",
    "===================================================================",
    "--- src/utils/helpers.ts",
    "+++ src/utils/helpers.ts",
    "@@ -1,1 +1,1 @@",
    '-str.replace(/[_-]+/g, "-")',
    '+str.replace(/[^a-z0-9]+/g, "-")',
  ].join("\n");

  it("keeps the hunks and drops the preamble", () => {
    expect(stripPatchHeader(realPatch)).toMatchInlineSnapshot(`
      "-str.replace(/[_-]+/g, "-")
      +str.replace(/[^a-z0-9]+/g, "-")"
    `);
  });

  // What a fixed line count did instead: a patch with fewer lines than the
  // preamble came out empty, and an empty body drew no card at all.
  it("never empties a patch that has content", () => {
    expect(stripPatchHeader("@@ -1,1 +1,1 @@\n-old\n+new")).toBe("-old\n+new");
  });

  // Not a patch this understands. Showing it whole beats showing nothing, and
  // silently dropping its first five lines is worse than either.
  it("hands back anything with no hunk header untouched", () => {
    expect(stripPatchHeader("- old\n+ new")).toBe("- old\n+ new");
  });

  // A real edit spans several hunks. Only the first header is a boundary; the
  // ones after it are content and have to survive.
  it("keeps the hunk headers after the first", () => {
    const twoHunks = [
      "--- a",
      "+++ b",
      "@@ -1,2 +1,2 @@",
      "-one",
      "+ONE",
      "@@ -9,2 +9,2 @@",
      "-two",
      "+TWO",
    ].join("\n");

    expect(stripPatchHeader(twoHunks)).toContain("@@ -9,2 +9,2 @@");
  });
});
