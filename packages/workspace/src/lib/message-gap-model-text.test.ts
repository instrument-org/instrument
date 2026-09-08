import { describe, expect, it } from "vitest";

import { messageGapModelNote } from "./message-gap-model-text";

// Separate cases rather than `it.each`: an inline snapshot is written back to
// its own call site, so one shared assertion cannot hold three expectations.
describe("messageGapModelNote", () => {
  it("says an hour at the threshold", () => {
    expect(messageGapModelNote({ minutes: 60 })).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      The user last wrote in this channel about 1 hour ago. Anything since was you and your tasks.
      </instrument-system-note>"
    `);
  });

  it("says hours for the rest of a day", () => {
    expect(messageGapModelNote({ minutes: 22 * 60 })).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      The user last wrote in this channel about 22 hours ago. Anything since was you and your tasks.
      </instrument-system-note>"
    `);
  });

  it("says days once it is longer than one", () => {
    expect(messageGapModelNote({ minutes: 3 * 24 * 60 }))
      .toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      The user last wrote in this channel about 3 days ago. Anything since was you and your tasks.
      </instrument-system-note>"
    `);
  });
});
