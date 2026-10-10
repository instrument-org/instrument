import { describe, expect, it } from "vitest";

import { StoreId } from "@instrument-org/workspace/client";

import { createdTaskSession } from "./created-task";

const TASK = StoreId.newSessionId();
const OTHER = StoreId.newSessionId();

const finished = (
  handOffs?: { kind: "created" | "sent"; sessionId: StoreId.Session }[],
) => ({ output: { handOffs }, state: "output-available" });

describe("createdTaskSession", () => {
  it("reads the session off the call's created hand-off", () => {
    expect(
      createdTaskSession(
        finished([
          { kind: "sent", sessionId: OTHER },
          { kind: "created", sessionId: TASK },
        ]),
      ),
    ).toBe(TASK);
  });

  it.each([
    { name: "a call that handed nothing off", part: finished() },
    {
      name: "a call that only sent to a task",
      part: finished([{ kind: "sent", sessionId: OTHER }]),
    },
    {
      name: "a call still running",
      part: { state: "input-available" },
    },
  ])("gives nothing for $name", ({ part }) => {
    expect(createdTaskSession(part)).toBeUndefined();
  });
});
