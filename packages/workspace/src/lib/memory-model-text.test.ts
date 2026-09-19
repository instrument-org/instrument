import { describe, expect, it } from "vitest";

import { memoryModelNote } from "./memory-model-text";

const sentAt = Date.parse("2026-09-19T12:00:00.000Z");

describe("memoryModelNote", () => {
  it("lists each memory by name with where it came from and how long ago", () => {
    expect(
      memoryModelNote({
        memories: [
          {
            at: Date.parse("2026-09-19T11:58:00.000Z"),
            from: "Roofer call",
            name: "pacific-time",
            text: "You are on Pacific time and mornings are best for calls.",
          },
          {
            at: Date.parse("2026-09-01T12:00:00.000Z"),
            name: "address",
            text: "Your address is 1420 Alder St, Portland.",
          },
        ],
        more: 0,
        sentAt,
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      What you remember about the user, kept for every thread (2):
      - pacific-time: You are on Pacific time and mornings are best for calls. (from "Roofer call", 2 minutes ago)
      - address: Your address is 1420 Alder St, Portland. (18 days ago)
      Each is what was true when it was saved. When one disagrees with what the user says now or a task reports, the present wins, and \`memory save\` under the same name corrects it.
      </instrument-system-note>"
    `);
  });

  it("counts what it left out", () => {
    expect(
      memoryModelNote({
        memories: [
          {
            at: sentAt,
            name: "one",
            text: "One.",
          },
        ],
        more: 70,
        sentAt,
      }),
    ).toContain(
      "(71):\n- one: One. (0 seconds ago)\n...and 70 more; `memory list` names them all.",
    );
  });

  it("says when everything has been forgotten", () => {
    expect(memoryModelNote({ memories: [], more: 0, sentAt }))
      .toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      Memory is empty now: nothing you remembered about the user is left.
      </instrument-system-note>"
    `);
  });
});
