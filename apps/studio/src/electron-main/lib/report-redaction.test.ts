import { describe, expect, it } from "vitest";

import { createReportRedactor } from "./report-redaction";

const CHAT = "2026-10-20-dinner-party-menu-6d4a";
const KEY = `lin_api_${"aB3dE5gH7j".repeat(4)}`;
const ALLERGY = "Dana is allergic to tree nuts; no almond flour.";

function part(type: string, data: unknown) {
  return { part: { data, type }, seq: 1, t: "part" };
}

function text(value: string) {
  return { part: { text: value, type: "text" }, seq: 2, t: "part" };
}

const LOG = [
  { chat: CHAT, seq: 0, t: "session" },
  text(
    "The user's name is Sam Rivera, signed in as sam.rivera@example.com.\nOn this computer `$INSTRUMENT_OUTPUT` is `/Users/samrivera/Instrument/Chats/Dinner`.",
  ),
  part("data-memory", {
    forgotten: ["old-address"],
    memories: [
      { at: 1, from: "Grocery run", name: "wife-allergy", text: ALLERGY },
      { at: 2, name: "timezone", text: "Central time." },
    ],
    told: { timezone: "b2", "wife-allergy": "a1" },
  }),
  part("data-chatContext", {
    chats: [
      {
        id: "2026-10-19-lawyer-call-1a2b",
        latest: "Moved the hearing to the 14th",
        title: "Lawyer call about custody",
        topics: ["Family"],
      },
    ],
    sentAt: 3,
  }),
  part("data-viewContext", {
    attached: [{ id: CHAT, kind: "chat", title: "Dinner party menu" }],
    chat: {
      id: "2026-10-19-lawyer-call-1a2b",
      title: "Lawyer call about custody",
    },
    screen: "chat",
  }),
  {
    part: {
      input: {
        command: "instrument memory show wife-allergy; whoami; cat .env",
      },
      output: `${ALLERGY}\nsamrivera\nLINEAR_API_KEY=${KEY}\nSam said thanks.`,
      type: "tool-bash",
    },
    seq: 3,
    t: "part",
  },
]
  .map((record) => JSON.stringify(record))
  .join("\n");

describe("createReportRedactor", () => {
  it("takes the person, their memories, other chats and secrets out of a chat's log", () => {
    const redactor = createReportRedactor({
      chatId: CHAT,
      home: "/Users/samrivera",
      login: "samrivera",
    });
    const [file] = redactor.chatFiles([
      { content: `${LOG}\n`, name: "ses_01ABC.dev_X.jsonl" },
    ]);
    const records = (file?.content ?? "")
      .split("\n")
      .filter(Boolean)
      .map((line): unknown => JSON.parse(line));

    expect(file?.content.endsWith("\n")).toBe(true);
    expect(records).toMatchInlineSnapshot(`
      [
        {
          "chat": "2026-10-20-dinner-party-menu-6d4a",
          "seq": 0,
          "t": "session",
        },
        {
          "part": {
            "text": "The user's name is [name], signed in as [email].
      On this computer \`$INSTRUMENT_OUTPUT\` is \`~/Instrument/Chats/Dinner\`.",
            "type": "text",
          },
          "seq": 2,
          "t": "part",
        },
        {
          "part": {
            "data": {
              "forgotten": [
                "memory-3",
              ],
              "memories": [
                {
                  "at": 1,
                  "from": "[chat title, 11 chars]",
                  "name": "memory-1",
                  "text": "[memory, 47 chars]",
                },
                {
                  "at": 2,
                  "name": "memory-2",
                  "text": "[memory, 13 chars]",
                },
              ],
              "told": {
                "memory-1": "a1",
                "memory-2": "b2",
              },
            },
            "type": "data-memory",
          },
          "seq": 1,
          "t": "part",
        },
        {
          "part": {
            "data": {
              "chats": [
                {
                  "id": "2026-10-19-lawyer-call-1a2b",
                  "latest": "[message, 29 chars]",
                  "title": "[other chat, 25 chars]",
                  "topics": [
                    "[topic]",
                  ],
                },
              ],
              "sentAt": 3,
            },
            "type": "data-chatContext",
          },
          "seq": 1,
          "t": "part",
        },
        {
          "part": {
            "data": {
              "attached": [
                {
                  "id": "2026-10-20-dinner-party-menu-6d4a",
                  "kind": "chat",
                  "title": "Dinner party menu",
                },
              ],
              "chat": {
                "id": "2026-10-19-lawyer-call-1a2b",
                "title": "[other chat, 25 chars]",
              },
              "screen": "chat",
            },
            "type": "data-viewContext",
          },
          "seq": 1,
          "t": "part",
        },
        {
          "part": {
            "input": {
              "command": "instrument memory show memory-1; whoami; cat .env",
            },
            "output": "[memory-1 text]
      [login]
      LINEAR_API_KEY=[secret: Linear key]
      Sam said thanks.",
            "type": "tool-bash",
          },
          "seq": 3,
          "t": "part",
        },
      ]
    `);
  });

  it("leaves a short login and a one-word memory name in free text", () => {
    const redactor = createReportRedactor({
      login: "sam",
      memories: [
        { name: "timezone", text: "Central time, so meetings after 9." },
      ],
    });
    expect(
      redactor.text(
        "sam ran `date`; the timezone is Central time, so meetings after 9.",
      ),
    ).toMatchInlineSnapshot(
      `"sam ran \`date\`; the timezone is [memory-1 text]"`,
    );
  });

  it("takes other chats' ids out of the log and keeps this chat's", () => {
    const redactor = createReportRedactor({
      chatId: "fix-the-build",
      chatIds: ["fix-the-build", "plan-sams-birthday", "notes"],
    });
    expect(
      redactor.text(
        [
          "Chat records: converted plan-sams-birthday",
          "Chat records: converted fix-the-build",
          "Chat records: converted notes",
          "Chat records: converted plan-sams-birthday-2",
        ].join("\n"),
      ),
    ).toMatchInlineSnapshot(`
      "Chat records: converted [other chat]
      Chat records: converted fix-the-build
      Chat records: converted notes
      Chat records: converted plan-sams-birthday-2"
    `);
  });

  it("takes an email out whatever its case", () => {
    const redactor = createReportRedactor({
      people: [{ email: "Sam.Rivera@Example.com", name: "Sam Rivera" }],
    });
    expect(
      redactor.text("Signed in as sam.rivera@example.com (Sam Rivera)."),
    ).toMatchInlineSnapshot(`"Signed in as [email] ([name])."`);
  });

  it("reads a Windows home as ~ in each of its spellings", () => {
    const redactor = createReportRedactor({
      home: "C:\\Users\\sam-r",
      login: "sam-r",
    });
    expect(
      redactor.text(
        "at file:///C:/Users/sam-r/AppData/x.js; cwd /c/Users/sam-r/chat; C:\\Users\\sam-r\\notes.md",
      ),
    ).toMatchInlineSnapshot(
      `"at file:///~/AppData/x.js; cwd ~/chat; ~\\notes.md"`,
    );
  });
});
