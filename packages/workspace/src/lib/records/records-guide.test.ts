import { describe, expect, it } from "vitest";

import { StoreId } from "../../schemas/store-id";
import { parseRecordFileName } from "./file-names";
import { chatRecordsGuide, RECORD_FILE_EXAMPLES } from "./records-guide";

describe("chatRecordsGuide", () => {
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

  it("reads as the agent is told", () => {
    expect(chatRecordsGuide("INSTRUMENT_CHATS")).toMatchInlineSnapshot(`
      "Every chat's records, this one's included, are in \`$INSTRUMENT_CHATS\`, read-only: a folder per chat, named by its id, holding JSON Lines files, one record per line with \`t\` naming it.
        - \`<session>.<device>.jsonl\`: one session's log as one device wrote it (\`.2\` and on once it grew long). Its records, by \`t\`:
          - \`message\`: a message, with its \`role\` and \`id\`; its words are in the \`part\` records that name it
          - \`part\`: a piece of a message, which \`part.metadata.messageId\` names: \`text\` and \`reasoning\` hold words, \`tool-<name>\` a call with its \`input\` and \`output\`, \`file\` a file. The newest record of a part's id is the one that stands
          - \`retract\`: the \`messages\` it names are no longer in the session
          - \`rollover\`: the context window was reset after message \`after\`
          - \`session\`: the log's first line: \`parent\` and \`forkedAt\` on a task, a session the chat started, whose history is its parent's up to \`forkedAt\`, then its own
          - \`state\`: a standing fact the app keeps, \`what\` naming it
          - \`stopped\`: the turn was stopped, \`by\` saying who stopped it
          A message's \`role\`:
            - \`assistant\`: you
            - \`session-context\`: what the app told you at the start, the same in every chat and no part of the conversation
            - \`system\`: a note the app added for you
            - \`user\`: the user
        - \`marks.<device>.jsonl\`: \`mark\` records, the newest of each \`field\` standing:
          - \`archived\`: whether it is archived
          - \`starred\`: whether it is starred
          - \`stoppedAt\`: when the user stopped its turn
          - \`title\`: its title, in \`value.text\`
          - \`topics\`: its topic ids, the \`id\` in each topic's \`TOPIC.md\`
          - \`unread\`: whether it is unread
        - \`blobs/\`: bytes a tool returned, which its part names in a \`blob\` field (\`sha256-<hex>.<ext>\`)."
    `);
  });
});
