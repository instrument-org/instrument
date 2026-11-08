import { describe, expect, it } from "vitest";

import { jobEventModelNote } from "./job-event-model-text";

// The note a session wakes to when its background processes end on their own.
// How each ended decides what the agent does next: an expired one did not
// fail, and an uncertain one may still be running.
describe("jobEventModelNote", () => {
  const event = {
    command: "pnpm dev",
    durationMs: 90_000,
    id: "bg_1",
    logFilePath: "/work/bg_1.log",
  };

  it.each([
    [
      { exitCode: 0, status: "exited" },
      "finished with exit code 0 after 2 minutes.",
      "",
    ],
    [{ status: "failed" }, "failed after 2 minutes.", ""],
    [{ status: "killed" }, "ended without an exit code after 2 minutes.", ""],
    [
      { status: "expired" },
      "was stopped after 2 minutes, the most a background process may run (",
      "it did not fail; start it again only if the work still needs it.",
    ],
    [
      { status: "termination-uncertain" },
      "was stopped after 2 minutes, the most a background process may run (",
      "did not confirm it exited; it may still be running.",
    ],
  ] as const)("says how it ended: %o", (how, said, then) => {
    const note = jobEventModelNote({ events: [{ ...event, ...how }] });
    expect(note).toContain(`- bg_1 (\`pnpm dev\`) ${said}`);
    expect(note).toContain(then);
  });

  it("names every process that ended, and where each one's output is", () => {
    const note = jobEventModelNote({
      events: [
        { ...event, exitCode: 1, status: "exited" },
        {
          ...event,
          id: "bg_2",
          logFilePath: "/work/bg_2.log",
          status: "killed",
        },
      ],
    });
    expect(note).toContain(
      "Commands you started have ended in the background:",
    );
    expect(note).toContain("all of it is in `/work/bg_1.log`.");
    expect(note).toContain("`fg bg_2`; all of it is in `/work/bg_2.log`.");
    expect(note).toContain("If the user was waiting on one of these");
  });
});
