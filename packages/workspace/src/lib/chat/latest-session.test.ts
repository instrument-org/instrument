import { describe, expect, it } from "vitest";

import { cutForNote, lastAssistantTextIn } from "./latest-session";

describe("lastAssistantTextIn", () => {
  const message = (text: string) =>
    ({
      id: "msg",
      metadata: { createdAt: new Date() },
      parts: [{ text, type: "text" }],
      role: "assistant",
    }) as unknown as Parameters<typeof lastAssistantTextIn>[0][number];

  it("gives the words whole", () => {
    expect(lastAssistantTextIn([message("Done, in work/x.md.")])).toBe(
      "Done, in work/x.md.",
    );
  });
});

describe("cutForNote", () => {
  it("gives the words whole when they fit", () => {
    expect(cutForNote("Done, in work/x.md.", 4000)).toBe("Done, in work/x.md.");
  });

  it("says where it cut, so the first part is not taken for the whole", () => {
    expect(cutForNote("a".repeat(12), 8)).toMatchInlineSnapshot(`
      "aaaaaaaa
      [cut here at 8 characters; the transcript has the rest]"
    `);
  });
});
