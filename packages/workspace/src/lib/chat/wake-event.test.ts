import { describe, expect, it } from "vitest";

import { StoreId } from "../../schemas/store-id";
import { replacesPendingEvent } from "./wake-event";

const sessionId = StoreId.newSessionId();
const event = (status: "done" | "error" | "overdue") => ({
  status,
  sessionId,
  title: "Task",
});

describe("replacesPendingEvent", () => {
  it.each([
    [undefined, "overdue", true],
    [undefined, "done", true],
    ["overdue", "overdue", true],
    ["overdue", "done", true],
    ["overdue", "error", true],
    ["done", "overdue", false],
    ["error", "overdue", false],
    ["done", "error", true],
  ] as const)("waiting %s, incoming %s: %s", (waiting, incoming, expected) => {
    expect(
      replacesPendingEvent(
        waiting === undefined ? undefined : event(waiting),
        event(incoming),
      ),
    ).toBe(expected);
  });
});
