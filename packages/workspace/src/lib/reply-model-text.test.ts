import { describe, expect, it } from "vitest";

import { StoreId } from "../schemas/store-id";
import { replyExcerpt, replyModelNote } from "./reply-model-text";

describe("replyExcerpt", () => {
  it("keeps a short message, puts it on one line, and cuts a long one at a word", () => {
    expect({
      joined: replyExcerpt("First line.\n\n- a point\n- another"),
      long: replyExcerpt(
        `${"The quarterly numbers are in and ".repeat(8)}end.`,
      ),
      oneWord: replyExcerpt("x".repeat(250)),
      short: replyExcerpt("Done. It's in your Downloads."),
    }).toMatchInlineSnapshot(`
      {
        "joined": "First line. - a point - another",
        "long": "The quarterly numbers are in and The quarterly numbers are in and The quarterly numbers are in and The quarterly numbers are in and The quarterly numbers are in and The quarterly numbers are in and…",
        "oneWord": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx…",
        "short": "Done. It's in your Downloads.",
      }
    `);
  });
});

describe("replyModelNote", () => {
  it("quotes the excerpt under the note", () => {
    expect(
      replyModelNote({
        messageId: StoreId.newMessageId(),
        partId: StoreId.newPartId(),
        text: "Want me to book the 7:30 or the 8:15?",
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      The user sent this message as a reply to an earlier message of yours, quoted here (only its start, when it is long). "This" and "that" in their message may refer to it.
      > Want me to book the 7:30 or the 8:15?
      </instrument-system-note>"
    `);
  });
});
