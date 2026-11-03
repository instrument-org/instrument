import { describe, expect, it } from "vitest";

import { backgroundProcessesModelNote } from "./background-processes-model-text";

// The note a turn opens with about what this session left running. The
// transcript still holds an earlier "running" claim, so an ended process has
// to be said out loud, and a running one must not be started twice.
describe("backgroundProcessesModelNote", () => {
  it("names what is still running with its age and what ended since", () => {
    expect(
      backgroundProcessesModelNote({
        ended: [{ command: "npx vite", id: "bg_1" }],
        running: [
          { command: "pnpm dev", id: "bg_2", runningForMs: 125_000 },
          // A process younger than a second still reads as one second.
          { command: "tail -f log", id: "bg_3", runningForMs: 10 },
        ],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      Still running from earlier in this session: bg_2 (\`pnpm dev\`), running 2 minutes; bg_3 (\`tail -f log\`), running 1 second. Do not start a second copy of any of these. Read one with \`fg <id>\`, list them with \`jobs\`, and stop what is no longer needed with \`kill <id>\`.
      No longer running: bg_1 (\`npx vite\`). Anything that depended on one of these -- a URL you gave the user, a watcher you assumed was rebuilding -- is no longer true. Start it again if the work needs it.
      </instrument-system-note>"
    `);
  });

  it("says nothing about running processes when only some ended", () => {
    const note = backgroundProcessesModelNote({
      ended: [{ command: "npx vite", id: "bg_1" }],
      running: [],
    });
    expect(note).toContain("No longer running: bg_1");
    expect(note).not.toContain("Still running");
  });
});
