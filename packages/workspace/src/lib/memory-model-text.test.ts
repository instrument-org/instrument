import { describe, expect, it } from "vitest";

import { memoryModelNote } from "./memory-model-text";

const sentAt = Date.parse("2026-09-19T12:00:00.000Z");

describe("memoryModelNote", () => {
  it("groups memories under the thread and day they came from, newest first", () => {
    expect(
      memoryModelNote({
        forgotten: [],
        memories: [
          {
            at: Date.parse("2026-09-19T11:58:00.000Z"),
            from: "Roofer call",
            name: "pacific-time",
            text: "You are on Pacific time and mornings are best for calls.",
          },
          {
            at: Date.parse("2026-09-19T11:57:00.000Z"),
            from: "Roofer call",
            name: "roofer",
            text: "Your roofer is Dale at Summit Roofing.",
          },
          {
            at: Date.parse("2026-09-01T12:00:00.000Z"),
            name: "address",
            text: "Your address is 1420 Alder St, Portland.",
          },
        ],
        more: 0,
        sentAt,
        tells: "whole",
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      What you remember about the user, kept for every thread (3):
      From "Roofer call", 2 minutes ago:
      - pacific-time: You are on Pacific time and mornings are best for calls.
      - roofer: Your roofer is Dale at Summit Roofing.
      From no thread, 18 days ago:
      - address: Your address is 1420 Alder St, Portland.
      Each is what was true when it was saved. When one disagrees with what the user says now or a task reports, the present wins, and \`memory save\` under the same name corrects it.
      </instrument-system-note>"
    `);
  });

  it("starts a new group when the same thread saved on another day", () => {
    expect(
      memoryModelNote({
        forgotten: [],
        memories: [
          {
            at: Date.parse("2026-09-19T11:58:00.000Z"),
            from: "Roofer call",
            name: "pacific-time",
            text: "You are on Pacific time.",
          },
          {
            at: Date.parse("2026-09-12T11:58:00.000Z"),
            from: "Roofer call",
            name: "roofer",
            text: "Your roofer is Dale.",
          },
        ],
        more: 0,
        sentAt,
        tells: "whole",
      }),
    ).toContain(
      'From "Roofer call", 2 minutes ago:\n- pacific-time: You are on Pacific time.\nFrom "Roofer call", 7 days ago:\n- roofer: Your roofer is Dale.',
    );
  });

  it("counts what it left out", () => {
    expect(
      memoryModelNote({
        forgotten: [],
        memories: [
          {
            at: sentAt,
            name: "one",
            text: "One.",
          },
        ],
        more: 70,
        sentAt,
        tells: "whole",
      }),
    ).toContain(
      "(71):\nFrom no thread, 0 seconds ago:\n- one: One.\n...and 70 more; `memory list` names them all.",
    );
  });

  it("tells only the change once the thread has heard the whole", () => {
    expect(
      memoryModelNote({
        forgotten: ["old-roofer"],
        memories: [
          {
            at: Date.parse("2026-09-19T11:58:00.000Z"),
            from: "Roofer call",
            name: "roofer",
            text: "Your roofer is Dale at Summit Roofing.",
          },
        ],
        more: 0,
        sentAt,
        tells: "changes",
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      Memory changed since you were last told.
      Saved or corrected:
      From "Roofer call", 2 minutes ago:
      - roofer: Your roofer is Dale at Summit Roofing.
      Forgotten: old-roofer.
      Each is what was true when it was saved. When one disagrees with what the user says now or a task reports, the present wins, and \`memory save\` under the same name corrects it.
      </instrument-system-note>"
    `);
  });

  it("names only what was forgotten when nothing was saved", () => {
    expect(
      memoryModelNote({
        forgotten: ["old-roofer", "stevia"],
        memories: [],
        more: 0,
        sentAt,
        tells: "changes",
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      Memory changed since you were last told.
      Forgotten: old-roofer, stevia.
      Each is what was true when it was saved. When one disagrees with what the user says now or a task reports, the present wins, and \`memory save\` under the same name corrects it.
      </instrument-system-note>"
    `);
  });

  it("says when everything has been forgotten", () => {
    expect(
      memoryModelNote({
        forgotten: [],
        memories: [],
        more: 0,
        sentAt,
        tells: "whole",
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      Memory is empty now: nothing you remembered about the user is left.
      </instrument-system-note>"
    `);
  });
});
