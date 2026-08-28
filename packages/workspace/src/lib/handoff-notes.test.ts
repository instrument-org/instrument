import { describe, expect, it } from "vitest";

import { contextRolloverNotice, HANDOFF_NOTES_PATH } from "./handoff-notes";

describe("contextRolloverNotice", () => {
  it("puts the notes in the request rather than pointing at them", () => {
    const notice = contextRolloverNotice(
      "Format: the number, a period, then the English word.",
    );

    expect(notice).toContain(
      "Format: the number, a period, then the English word.",
    );
    // The version this replaces asked the agent to go and read the file, which
    // costs a tool call it did not spend. Nothing here asks for one.
    expect(notice).not.toMatch(/read (your |the )?notes there/i);
  });

  it("says what is missing, whether or not there are notes", () => {
    for (const notice of [
      contextRolloverNotice("some notes"),
      contextRolloverNotice(undefined),
    ]) {
      expect(notice).toContain("continued in a fresh window");
      expect(notice).toContain("Your own earlier turns have not");
    }
  });

  it("names the same path it would be read from when there are none", () => {
    expect(contextRolloverNotice(undefined)).toContain(HANDOFF_NOTES_PATH);
  });

  // The write instruction and the read both derive from this, so a path that
  // drifted would break the handoff silently rather than loudly.
  it("names a path under the task mount", () => {
    expect(HANDOFF_NOTES_PATH).toMatchInlineSnapshot(`"/task/work/handoff-notes.md"`);
  });
});
