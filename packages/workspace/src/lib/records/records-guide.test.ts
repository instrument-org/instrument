import path from "node:path";
import { describe, expect, it } from "vitest";

import { StoreId } from "../../schemas/store-id";
import { parseRecordFileName } from "./file-names";
import { chatRecordsReference, RECORD_FILE_EXAMPLES } from "./records-guide";

describe("chatRecordsReference", () => {
  // The guide names the files by pattern; each, with real ids put in, is a
  // file the records are kept in.
  it.each([
    ["log", RECORD_FILE_EXAMPLES.log],
    ["marks", RECORD_FILE_EXAMPLES.marks],
  ] as const)("names a %s file the parser reads as one", (kind, example) => {
    const name = example
      .replace("<session>", StoreId.newSessionId())
      .replace("<device>", "dev_ABCD1234");
    expect(parseRecordFileName(name)?.kind).toBe(kind);
  });

  it("is the chat-history skill's records.md, so a format change reaches the skill with it", async () => {
    await expect(chatRecordsReference()).toMatchFileSnapshot(
      path.join(
        import.meta.dirname,
        "../../../system-skills/chat-history/records.md",
      ),
    );
  });
});
