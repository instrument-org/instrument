import { describe, expect, it } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { replacesPendingEvent } from "./wake-event";

const taskId = ChatIdSchema.parse("task");
const event = (status: "done" | "error" | "overdue") => ({
  status,
  taskId,
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
