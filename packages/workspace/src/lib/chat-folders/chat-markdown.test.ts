import { describe, expect, it } from "vitest";

import { SessionMessagePart } from "../../schemas/session/message-part";
import { type DeviceId } from "../records/device-id";
import { logFileName, settingsFileName } from "../records/file-names";
import { type FoldedChat, foldChat } from "../records/fold";
import {
  type LogRecord,
  type SettingRecord,
  recordLine,
} from "../records/record";
import {
  assistantMessage,
  at,
  CHAT,
  DEVICE_A,
  DEVICE_B,
  header,
  messageId,
  messageRecord,
  partId,
  partRecord,
  sessionId,
  textPart,
  toolPart,
  userMessage,
} from "../records/test-records";
import { renderChatMarkdown } from "./chat-markdown";

/**
 * The transcript is generated, so the bytes are the thing under test: two
 * renders of one chat must be the same file, and a change to the records
 * that nothing in the file reports must leave the file alone.
 */

const chatSession = sessionId(1);
const taskSession = sessionId(2);

function file(name: string, records: (LogRecord | SettingRecord)[]) {
  return { bytes: Buffer.from(records.map(recordLine).join("")), name };
}

function log(
  device: DeviceId,
  records: LogRecord[],
  { generation = 1, session = chatSession } = {},
) {
  return file(logFileName(session, device, generation), records);
}

function render(chat: FoldedChat) {
  return renderChatMarkdown({
    chat,
    id: CHAT,
    rootDir: "/Users/someone/Workspace",
  });
}

/**
 * A chat with everything the file draws from: a question and a reply, the
 * work between them, a task of its own, a card and its answer, a model
 * switch, and a second day.
 */
function wholeChat() {
  return foldChat([
    log(DEVICE_A, [
      header(0, { device: DEVICE_A, id: chatSession }),
      messageRecord(1, userMessage(chatSession, messageId(1), at(0))),
      partRecord(
        2,
        textPart(
          chatSession,
          messageId(1),
          partId(1),
          "Find me a quiet dishwasher under $900.",
          at(0),
        ),
      ),
      partRecord(
        3,
        SessionMessagePart.coerce({
          data: {
            files: [
              {
                filename: "kitchen.png",
                filePath: "attachments/kitchen.png",
                mimeType: "image/png",
                size: 1024,
              },
            ],
          },
          metadata: {
            createdAt: at(0),
            id: partId(2),
            messageId: messageId(1),
            sessionId: chatSession,
          },
          type: "data-attachments",
        }),
      ),
      messageRecord(4, assistantMessage(chatSession, messageId(2), at(30))),
      partRecord(
        5,
        SessionMessagePart.coerce({
          metadata: {
            createdAt: at(30),
            id: partId(3),
            messageId: messageId(2),
            sessionId: chatSession,
          },
          text: "Noise matters more to them than price.",
          type: "reasoning",
        }),
      ),
      partRecord(
        6,
        toolPart({
          createdAt: at(40),
          id: partId(4),
          message: messageId(2),
          more: { endedAt: at(50), output: { exitCode: 0 } },
          session: chatSession,
          state: "output-available",
        }),
      ),
      partRecord(
        7,
        textPart(
          chatSession,
          messageId(2),
          partId(5),
          "Three run under 44 dB.",
          at(200),
        ),
      ),
      // A card and the person's answer to it, a day later.
      messageRecord(8, assistantMessage(chatSession, messageId(3), at(90_000))),
      partRecord(
        9,
        SessionMessagePart.coerce({
          input: { choices: ["Bosch", "Miele"], question: "Which brand?" },
          metadata: {
            createdAt: at(90_000),
            id: partId(6),
            messageId: messageId(3),
            sessionId: chatSession,
          },
          output: { asked: true },
          state: "output-available",
          toolCallId: "call-choose",
          type: "tool-choose",
        }),
      ),
      messageRecord(10, userMessage(chatSession, messageId(4), at(90_060))),
      partRecord(
        11,
        SessionMessagePart.coerce({
          data: {
            answer: { selectedChoice: "Bosch" },
            partId: partId(6),
            question: "Which brand?",
          },
          metadata: {
            createdAt: at(90_060),
            id: partId(7),
            messageId: messageId(4),
            sessionId: chatSession,
          },
          type: "data-questionAnswer",
        }),
      ),
    ]),
    // A task of the chat's, whose steps fold in indented.
    log(
      DEVICE_A,
      [
        header(0, {
          device: DEVICE_A,
          forkedAt: messageId(1),
          handle: "t1",
          id: taskSession,
          parent: chatSession,
        }),
        messageRecord(1, assistantMessage(taskSession, messageId(10), at(45))),
        partRecord(
          2,
          toolPart({
            createdAt: at(45),
            id: partId(20),
            message: messageId(10),
            more: { endedAt: at(46), output: { exitCode: 1 } },
            session: taskSession,
            state: "output-available",
          }),
        ),
      ],
      { session: taskSession },
    ),
    file(settingsFileName(DEVICE_A), [
      {
        t: "set",
        seq: 0,
        at: at(300),
        device: DEVICE_A,
        field: "title",
        session: chatSession,
        value: { auto: false, text: "Quiet dishwashers under $900" },
      },
      {
        t: "set",
        seq: 1,
        at: at(300),
        device: DEVICE_A,
        field: "topic",
        session: chatSession,
        value: "top_1",
      },
    ]),
  ]);
}

it("renders a chat whole", () => {
  expect(render(wholeChat())).toMatchInlineSnapshot(`
    "---
    title: "Quiet dishwashers under $900"
    chat: instrument://chat/records-test
    created: 2026-10-14T12:00:00Z
    topic: top_1
    ---

    [Open this chat in Instrument](instrument://chat/records-test). This file is a copy of the chat that Instrument keeps up to date, so changes you make here won't last.

    ## Wednesday, October 14, 2026

    ### You at 12:00 PM UTC

    Find me a quiet dishwasher under $900.

    Sent: kitchen.png

    <details>
    <summary>Worked for 20s · ran 2 commands</summary>

    > Noise matters more to them than price.

    **Ran a command** · 10s

    \`\`\`sh
    ls
    \`\`\`

    **t1 Ran a command** · exit 1 · 1s

    \`\`\`sh
    ls
    \`\`\`

    </details>

    ### Instrument at 12:03 PM UTC

    Three run under 44 dB.

    ## Thursday, October 15, 2026

    ### Instrument at 1:00 PM UTC

    Asked: Which brand?
    - Bosch
    - Miele

    ### You at 1:01 PM UTC

    You chose “Bosch”.
    "
  `);
});

it("counts the work to the end of the call, not to when it was made", () => {
  const slow = foldChat([
    log(DEVICE_A, [
      header(0, { device: DEVICE_A, id: chatSession }),
      messageRecord(1, assistantMessage(chatSession, messageId(2), at(0))),
      partRecord(
        2,
        toolPart({
          createdAt: at(0),
          id: partId(1),
          message: messageId(2),
          more: { endedAt: at(190), output: { exitCode: 0 } },
          session: chatSession,
          state: "output-available",
        }),
      ),
      partRecord(
        3,
        textPart(chatSession, messageId(2), partId(2), "Done.", at(200)),
      ),
    ]),
  ]);
  expect(render(slow)).toContain(
    "<summary>Worked for 3m 10s · ran a command</summary>",
  );
});

it("keeps what the agent wrote inside the fold: no markup escapes it, and a command reads as typed", () => {
  const meta = (id: number, seconds: number) => ({
    createdAt: at(seconds),
    id: partId(id),
    messageId: messageId(2),
    sessionId: chatSession,
  });
  const chat = foldChat([
    log(DEVICE_A, [
      header(0, { device: DEVICE_A, id: chatSession }),
      messageRecord(1, assistantMessage(chatSession, messageId(2), at(0))),
      partRecord(
        2,
        SessionMessagePart.coerce({
          metadata: meta(1, 0),
          text: "Close it with </details>, then run `a <b> c`.",
          type: "reasoning",
        }),
      ),
      partRecord(
        3,
        SessionMessagePart.coerce({
          input: { command: "echo ``` && ls 2>/dev/null" },
          metadata: meta(2, 1),
          output: { exitCode: 0 },
          state: "output-available",
          toolCallId: "call-echo",
          type: "tool-bash",
        }),
      ),
      partRecord(
        4,
        textPart(chatSession, messageId(2), partId(3), "Done.", at(2)),
      ),
    ]),
  ]);
  const fold = render(chat)?.match(/<details>[\s\S]*?<\/details>/)?.[0];
  expect(fold).toMatchInlineSnapshot(`
    "<details>
    <summary>Worked for 1s · ran a command</summary>

    > Close it with \\</details\\>, then run \`a <b> c\`.

    **Ran a command**

    \`\`\`\`sh
    echo \`\`\` && ls 2>/dev/null
    \`\`\`\`

    </details>"
  `);
});

describe("the same records render the same bytes", () => {
  it("renders the same file twice", () => {
    const chat = wholeChat();
    expect(render(chat)).toBe(render(chat));
  });

  it("renders the same file from a second fold of the same files", () => {
    expect(render(wholeChat())).toBe(render(wholeChat()));
  });

  /**
   * Every day and time is UTC rather than the process's own zone, which is
   * what keeps a render from moving when the app runs somewhere else. The
   * whole file is also run under another `TZ` in CI for the same reason;
   * this is the half a unit test can see.
   */
  it("says the day and the time in UTC", () => {
    const rendered = render(wholeChat());
    expect(rendered).toContain("created: 2026-10-14T12:00:00Z");
    expect(rendered).toContain("## Wednesday, October 14, 2026");
    expect(rendered).toContain("### You at 12:00 PM UTC");
  });
});

describe("a change the file does not report leaves it alone", () => {
  it("renders the same file when the records arrive in another order", () => {
    const files = [...wholeChatFiles()];
    expect(render(foldChat(files.toReversed()))).toBe(render(foldChat(files)));
  });

  it("renders the same file when a record arrives twice", () => {
    const files = wholeChatFiles();
    const twice = files.map(({ bytes, name }) => ({
      bytes: Buffer.concat([bytes, bytes]),
      name,
    }));
    expect(render(foldChat(twice))).toBe(render(foldChat(files)));
  });

  it("renders the same file when another device marks the chat read", () => {
    const withSetting = [
      ...wholeChatFiles(),
      file(settingsFileName(DEVICE_B), [
        {
          t: "set",
          seq: 0,
          at: at(400),
          device: DEVICE_B,
          field: "starred",
          session: chatSession,
          value: true,
        },
      ]),
    ];
    expect(render(foldChat(withSetting))).toBe(
      render(foldChat(wholeChatFiles())),
    );
  });

  it("renders the same file when the session's browser went somewhere new", () => {
    const state = [
      ...wholeChatFiles(),
      log(
        DEVICE_B,
        [
          header(0, {
            continues: { [DEVICE_A]: 11 },
            device: DEVICE_B,
            id: chatSession,
          }),
          { t: "sites", seq: 1, at: at(500), visited: ["example.com"] },
        ],
        { generation: 2 },
      ),
    ];
    expect(render(foldChat(state))).toBe(render(foldChat(wholeChatFiles())));
  });
});

it("names a chat the agent never named by its opening words", () => {
  expect(render(foldChat(foldFilesOf()))?.split("\n")[1]).toBe(
    "title: A question.",
  );
});

it("leaves a record folder with no conversation of its own unrendered", () => {
  const taskOnly = foldChat([
    log(
      DEVICE_A,
      [
        header(0, {
          device: DEVICE_A,
          handle: "t1",
          id: taskSession,
          parent: chatSession,
        }),
      ],
      { session: taskSession },
    ),
  ]);
  expect(render(taskOnly)).toBeUndefined();
});

function wholeChatFiles() {
  return [
    ...foldFilesOf(),
    file(settingsFileName(DEVICE_A), [
      {
        t: "set",
        seq: 0,
        at: at(300),
        device: DEVICE_A,
        field: "title",
        session: chatSession,
        value: { auto: false, text: "Quiet dishwashers under $900" },
      },
    ]),
  ];
}

/** The chat's own log, as the whole-chat fixture writes it. */
function foldFilesOf() {
  return [
    log(DEVICE_A, [
      header(0, { device: DEVICE_A, id: chatSession }),
      messageRecord(1, userMessage(chatSession, messageId(1), at(0))),
      partRecord(
        2,
        textPart(chatSession, messageId(1), partId(1), "A question.", at(0)),
      ),
      messageRecord(3, assistantMessage(chatSession, messageId(2), at(30))),
      partRecord(
        4,
        toolPart({
          createdAt: at(40),
          id: partId(4),
          message: messageId(2),
          more: { endedAt: at(50), output: { exitCode: 0 } },
          session: chatSession,
          state: "output-available",
        }),
      ),
      partRecord(
        5,
        textPart(chatSession, messageId(2), partId(5), "An answer.", at(200)),
      ),
    ]),
  ];
}

it("writes dictated words as the plain words the person said", () => {
  const dictated = foldChat([
    log(DEVICE_A, [
      header(0, { device: DEVICE_A, id: chatSession }),
      messageRecord(1, userMessage(chatSession, messageId(1), at(0))),
      partRecord(
        2,
        textPart(
          chatSession,
          messageId(1),
          partId(1),
          "[Find me a quiet](dictated:) dishwasher [under \\[900\\]](dictated:)",
          at(0),
        ),
      ),
    ]),
  ]);
  expect(render(dictated)?.split("\n").slice(-3)).toMatchInlineSnapshot(`
    [
      "",
      "Find me a quiet dishwasher under [900]",
      "",
    ]
  `);
});
