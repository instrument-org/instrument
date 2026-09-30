import { describe, expect, it } from "vitest";

import { createdTaskId } from "./created-task";

const created = (command: string, output: string) => ({
  input: { command },
  output: { output },
  state: "output-available",
});

describe("createdTaskId", () => {
  it("reads the id off a task new that succeeded", () => {
    expect(
      createdTaskId(
        created(
          "task new --name 'Lisbon' <<'EOF'\nFind a hotel.\nEOF",
          'Created lisbon-hotel ("Lisbon"). It is running now.\n',
        ),
      ),
    ).toBe("lisbon-hotel");
  });

  it("finds a task new later in a chain", () => {
    expect(
      createdTaskId(
        created(
          "task list; task new --name 'x' <<'EOF'\nx\nEOF",
          "Created x-1",
        ),
      ),
    ).toBe("x-1");
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
    expect(createdTaskId(part)).toBeUndefined();
  });
});
