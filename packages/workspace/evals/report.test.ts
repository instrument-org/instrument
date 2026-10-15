import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../src/schemas/session/message";
import { unfinishedCalls } from "./report";

/** One assistant message holding `parts`, as a session's history holds it. */
function message(parts: unknown[]): SessionMessage.WithParts {
  return {
    id: "msg_1",
    metadata: { createdAt: new Date(0), id: "msg_1", sessionId: "ses_1" },
    parts,
    role: "assistant",
  } as unknown as SessionMessage.WithParts;
}

const toolPart = (state: string) => ({
  input: {},
  metadata: { createdAt: new Date(0), id: `prt_${state}`, messageId: "msg_1" },
  state,
  toolCallId: "call_1",
  type: "tool-load_skill",
});

describe("unfinishedCalls", () => {
  it.each(["input-available", "input-streaming"])(
    "names a call left at %s",
    (state) => {
      expect(unfinishedCalls([message([toolPart(state)])])).toEqual([
        { messageId: "msg_1", state, type: "tool-load_skill" },
      ]);
    },
  );

  it.each(["output-available", "output-error"])(
    "says nothing of a call that reached %s",
    (state) => {
      expect(unfinishedCalls([message([toolPart(state)])])).toEqual([]);
    },
  );

  it("ignores everything that is not a call", () => {
    const text = {
      metadata: { createdAt: new Date(0), id: "prt_t", messageId: "msg_1" },
      state: "done",
      text: "hello",
      type: "text",
    };
    expect(unfinishedCalls([message([text])])).toEqual([]);
  });

  it("says nothing of a session with no messages", () => {
    expect(unfinishedCalls([])).toEqual([]);
  });
});
