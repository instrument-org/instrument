import { describe, expect, it } from "vitest";

import { StoreId } from "@instrument-org/workspace/client";

import { createdTaskSession } from "./created-task";

const TASK = StoreId.newSessionId();

const created = (command: string, output: string) => ({
  input: { command },
  output: { output },
  state: "output-available",
});

describe("createdTaskSession", () => {
  it("reads the id off a task new that succeeded", () => {
    expect(
      createdTaskSession(
        created(
          "task new --name 'Lisbon' <<'EOF'\nFind a hotel.\nEOF",
          `Created ${TASK} ("Lisbon"). It is running now.\n`,
        ),
      ),
    ).toBe(TASK);
  });

  it("finds a task new later in a chain", () => {
    expect(
      createdTaskSession(
        created(
          "task list; task new --name 'x' <<'EOF'\nx\nEOF",
          `Created ${TASK}`,
        ),
      ),
    ).toBe(TASK);
  });

  it.each([
    {
      name: "a command that is not task new",
      part: created("task list", "Created abc"),
    },
    {
      name: "a task new that failed",
      part: created("task new", "task: new: a brief is required"),
    },
    {
      name: "an output that names something that is not a task id",
      part: created("task new <<'EOF'\nx\nEOF", "Created NOT_AN_ID"),
    },
    {
      name: "a call still running",
      part: { input: { command: "task new" }, state: "input-available" },
    },
  ])("gives nothing for $name", ({ part }) => {
    expect(createdTaskSession(part)).toBeUndefined();
  });
});
