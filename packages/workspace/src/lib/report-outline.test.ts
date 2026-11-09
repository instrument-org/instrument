import { describe, expect, it } from "vitest";

import {
  emptySources,
  outlineCommand,
  outlineRecord,
  outlineSessionLog,
} from "./report-outline";

/** Planted in every field of every kind; the outline sends it only where the table says words go as written. */
const SECRET = "CANARY-5f1e";
/** The canary long enough that a command's text goes as its length. */
const LONG = `${SECRET} `.repeat(10);

const part = (body: Record<string, unknown>) => ({
  at: "2026-10-31T00:00:00.000Z",
  part: { metadata: { id: "prt_1", messageId: "msg_1" }, ...body },
  seq: 1,
  t: "part",
});

/** Every record kind the outline knows, with the canary in each of its fields. */
const PLANTED = [
  part({ type: "reasoning", text: SECRET, providerMetadata: { x: SECRET } }),
  part({
    type: "tool-bash",
    input: { command: `cat <<'EOF' | python -\nprint("${SECRET}")\nEOF` },
    output: {
      exitCode: 0,
      output: SECRET,
      browserSkill: { content: SECRET },
      pageAfter: { url: `https://mail.google.com/${SECRET}`, title: SECRET },
    },
  }),
  part({
    type: "tool-bash",
    input: { command: `echo '${SECRET.repeat(20)}'` },
    output: { exitCode: 0, output: SECRET },
  }),
  // Every shape a command can carry text in: a case arm, a heredoc on a
  // loop or a group, an assignment's value, a command substitution, a
  // `[[ ]]` test.
  ...[
    `case x in a) echo '${LONG}';; esac`,
    `while read l; do echo $l; done <<'EOF'\n${SECRET}\nEOF`,
    `{ cat; } <<EOF\n${SECRET} $HOME\nEOF`,
    `NOTE='${LONG}'; echo ok`,
    `X="${LONG}" python x.py`,
    `git commit -m "$(cat <<'EOF'\n${SECRET}\nEOF\n)"`,
    `[[ "$x" == "${LONG}" ]] && echo yes`,
    `echo $(printf '%s' '${LONG}')`,
  ].map((command) =>
    part({ type: "tool-bash", input: { command }, output: { exitCode: 0 } }),
  ),
  part({
    type: "tool-bash",
    input: { command: "ls" },
    rawInput: { command: SECRET },
    output: { exitCode: 0 },
  }),
  part({
    type: "tool-unavailable",
    rawInput: { command: SECRET },
    errorText: "no such tool",
  }),
  part({
    type: "tool-web_fetch",
    input: { url: `https://example.com/${SECRET}` },
    output: { content: SECRET },
  }),
  part({
    type: "tool-web_search",
    input: { query: "weather" },
    output: { results: [{ url: `https://a.com/${SECRET}`, text: SECRET }] },
  }),
  part({
    type: "tool-read_file",
    input: { filePath: "/a.md" },
    output: { content: SECRET },
  }),
  part({
    type: "tool-write_file",
    input: { filePath: "/a.md", content: SECRET },
    output: { filePath: "/a.md" },
  }),
  part({
    type: "tool-edit_file",
    input: { filePath: "/a.md", oldString: SECRET, newString: SECRET },
    output: { diff: SECRET },
  }),
  part({
    type: "tool-load_skill",
    input: { name: "pdf" },
    output: { content: SECRET },
  }),
  part({
    type: "tool-connect_app",
    input: { slug: "gmail" },
    output: { detail: SECRET },
  }),
  part({
    type: "tool-something-new",
    input: { anything: SECRET },
    output: { anything: SECRET },
  }),
  part({
    type: "data-memory",
    data: { memories: [{ name: SECRET, text: SECRET }] },
  }),
  part({
    type: "data-chatContext",
    data: { chats: [{ title: SECRET, latest: SECRET }] },
  }),
  part({
    type: "data-viewContext",
    data: {
      screen: "browser",
      url: "/x",
      tabs: [{ at: `https://mail.google.com/${SECRET}`, title: SECRET }],
      page: {
        text: SECRET,
        title: SECRET,
        url: `https://mail.google.com/${SECRET}`,
      },
    },
  }),
  part({
    type: "data-browserStatus",
    data: {
      status: "tabs",
      tabs: [{ id: "tab_1", title: SECRET, url: `https://b.com/${SECRET}` }],
    },
  }),
  part({
    type: "data-asks",
    data: {
      asks: [
        { excerpt: SECRET, instruction: "make it shorter", target: "line 5" },
      ],
    },
  }),
  part({
    type: "data-attachments",
    data: {
      files: [
        { filename: SECRET, filePath: SECRET, mimeType: "image/png", size: 10 },
      ],
    },
  }),
  part({ type: "data-something-new", data: { anything: SECRET } }),
  part({ type: "source-url", title: SECRET, url: `https://c.com/${SECRET}` }),
  part({ type: "text", text: "hello", providerMetadata: { x: SECRET } }),
  { seq: 2, t: "something-new", anything: SECRET },
];

describe("outlineSessionLog", () => {
  it("never sends a planted value from anything the agent read", () => {
    const log = PLANTED.map((record) => JSON.stringify(record)).join("\n");
    const { content, sources } = outlineSessionLog(log);
    expect(content).not.toContain(SECRET);
    expect([...sources.hosts].toSorted()).toEqual([
      "b.com",
      "c.com",
      "example.com",
      "mail.google.com",
    ]);
    expect([...sources.apps]).toEqual(["gmail"]);
    expect(sources.files).toBe(3);
  });

  it("keeps what was said and how each step went", () => {
    const record = (body: Record<string, unknown>) =>
      outlineRecord(part(body), emptySources());
    expect(record({ type: "text", text: "Starring it now." })).toMatchObject({
      part: { text: "Starring it now." },
    });
    expect(
      record({
        type: "tool-bash",
        input: {
          command: "app call gmail search_threads '{}'",
          explanation: "Finding the thread",
        },
        output: {
          exitCode: 1,
          output: "app: Incompatible auth server",
          stderr: "app: Incompatible auth server",
        },
      }),
    ).toMatchObject({
      part: {
        input: {
          command: "app call gmail search_threads '{}'",
          explanation: "Finding the thread",
        },
        output: {
          exitCode: 1,
          output: "<29 chars>",
          stderr: "app: Incompatible auth server",
        },
      },
    });
  });

  it.each([
    {
      name: "a failed stage behind a pipe",
      command: "find . | head -5",
      output: "Error: .: Access is denied. (os error 5)",
      ran: [
        {
          count: 1,
          exitCode: 1,
          failed: 1,
          name: "find",
          program: "/d/find.exe",
          sandbox: "mxc",
          source: "bundled",
          stderr: "Error: .: Access is denied. (os error 5)",
        },
        {
          count: 1,
          name: "head",
          program: "/d/coreutils.exe",
          sandbox: "mxc",
          source: "bundled",
        },
      ],
    },
    {
      name: "a record with no status on its runs",
      command: "find . | head -5",
      output: "a.txt",
      ran: [
        {
          count: 1,
          name: "find",
          program: "/d/find.exe",
          reason: "builtin-args",
          sandbox: "seatbelt",
          source: "bundled",
        },
      ],
    },
  ])("sends the facts of $name, and its output as a length", (run) => {
    const outlined = outlineRecord(
      part({
        type: "tool-bash",
        input: { command: run.command },
        output: {
          commands: ["find", "head"],
          exitCode: 0,
          output: run.output,
          ran: run.ran,
        },
      }),
      emptySources(),
    );
    expect(outlined).toMatchObject({
      part: {
        output: {
          output: `<${run.output.length} chars>`,
          ran: run.ran,
        },
      },
    });
  });

  it("keeps out what an exit-0 command printed and any field of a run not named", () => {
    const outlined = JSON.stringify(
      outlineRecord(
        part({
          type: "tool-bash",
          input: { command: "cat mail.txt 2>&1 | head -5" },
          output: {
            exitCode: 0,
            movedForMessageFrom: "user",
            output: SECRET,
            ran: [
              {
                count: 1,
                failed: 1,
                exitCode: 1,
                name: "cat",
                source: "builtin",
                somethingNew: SECRET,
              },
            ],
          },
        }),
        emptySources(),
      ),
    );
    expect(outlined).not.toContain(SECRET);
    expect(outlined).toContain('"movedForMessageFrom":"user"');
    expect(outlined).toContain('"somethingNew":"<11 chars>"');
  });

  it.each([
    { command: "cat missing mail.txt", exitCode: 1 },
    { command: "cat mail.txt", exitCode: 0 },
    { command: "task show t1 | head -30", exitCode: 0 },
    { command: "instrument app test gmail", exitCode: 1 },
  ])(
    "sends a call's output as its length, whatever ran: $command",
    ({ command, exitCode }) => {
      expect(
        outlineRecord(
          part({
            type: "tool-bash",
            input: { command },
            output: { exitCode, output: SECRET },
          }),
          emptySources(),
        ),
      ).toMatchObject({ part: { output: { output: "<11 chars>" } } });
    },
  );

  it("keeps where an ask stands, and a tab's page as its host", () => {
    const ask = (body: Record<string, unknown>) =>
      outlineRecord(
        {
          ask: {
            askedAt: "2026-11-07T14:02:38.400Z",
            askers: [{ at: "2026-11-07T14:02:38.400Z", sessionId: "ses_1" }],
            device: "dev_1",
            id: "ask_1",
            kind: "permission",
            stage: { is: "open" },
            ...body,
          },
          at: "2026-11-07T14:02:38.400Z",
          seq: 42,
          t: "ask",
        },
        emptySources(),
      );
    expect(
      ask({ on: "folder", target: "~/Library/Application Support/obsidian" }),
    ).toMatchObject({
      ask: {
        askedAt: "2026-11-07T14:02:38.400Z",
        on: "folder",
        stage: { is: "open" },
        target: "~/Library/Application Support/obsidian",
      },
      at: "2026-11-07T14:02:38.400Z",
    });
    const page = { title: SECRET, url: `https://mail.example.com/${SECRET}` };
    const tab = JSON.stringify([
      ask({ on: "tab", page, target: "tab_1" }),
      ask({
        on: "tab",
        page,
        stage: {
          is: "closed",
          outcome: { data: { page, state: "allowed" }, kind: "permission" },
          woken: true,
        },
        target: "tab_1",
      }),
      outlineRecord(
        part({
          data: { page, state: "allowed" },
          type: "data-permissionAnswer",
        }),
        emptySources(),
      ),
    ]);
    expect(tab).not.toContain(SECRET);
    expect(tab).toContain("mail.example.com");
  });

  it("outlines a session the way a report shows it", () => {
    const log = [
      { t: "session", seq: 0, id: "ses_1", app: "2.0.0" },
      part({ type: "text", text: "favorite my first email" }),
      part({
        type: "data-viewContext",
        data: {
          screen: "browser",
          url: "/browser",
          tabs: [
            { at: "https://mail.google.com/mail/u/0/#inbox", title: "Inbox" },
          ],
          page: {
            tab: "tab_1",
            text: "1–50 of 529 Conversations",
            title: "Inbox",
            url: "https://mail.google.com/mail/u/0/#inbox",
          },
        },
      }),
      part({
        type: "tool-bash",
        input: {
          command: "app tools gmail",
          explanation: "Listing Gmail app tools",
        },
        output: {
          command: "app tools gmail",
          commands: ["app"],
          durationMs: 688,
          exitCode: 0,
          output: "23 tools on gmail.",
        },
      }),
      part({
        type: "tool-bash",
        input: {
          command: 'app call gmail search_threads \'{"query": "in:inbox"}\'',
        },
        output: {
          commands: ["app"],
          durationMs: 494,
          exitCode: 1,
          output: "app: Incompatible auth server",
        },
      }),
    ]
      .map((record) => JSON.stringify(record))
      .join("\n");
    expect(
      outlineSessionLog(log)
        .content.split("\n")
        .map((line): unknown => {
          const record: unknown = JSON.parse(line);
          return typeof record === "object" &&
            record !== null &&
            "part" in record
            ? record.part
            : record;
        }),
    ).toMatchInlineSnapshot(`
      [
        {
          "app": "2.0.0",
          "id": "ses_1",
          "seq": 0,
          "t": "session",
        },
        {
          "metadata": {
            "id": "prt_1",
            "messageId": "msg_1",
          },
          "text": "favorite my first email",
          "type": "text",
        },
        {
          "data": {
            "page": {
              "tab": "tab_1",
              "text": "<25 chars>",
              "title": "<5 chars>",
              "url": "https://mail.google.com/<15 chars>",
            },
            "screen": "browser",
            "tabs": [
              "https://mail.google.com/<15 chars>",
            ],
            "url": "/browser",
          },
          "metadata": {
            "id": "prt_1",
            "messageId": "msg_1",
          },
          "type": "data-viewContext",
        },
        {
          "input": {
            "command": "app tools gmail",
            "explanation": "Listing Gmail app tools",
          },
          "metadata": {
            "id": "prt_1",
            "messageId": "msg_1",
          },
          "output": {
            "commands": [
              "app",
            ],
            "durationMs": 688,
            "exitCode": 0,
            "output": "<18 chars>",
          },
          "type": "tool-bash",
        },
        {
          "input": {
            "command": "app call gmail search_threads '{"query": "in:inbox"}'",
          },
          "metadata": {
            "id": "prt_1",
            "messageId": "msg_1",
          },
          "output": {
            "commands": [
              "app",
            ],
            "durationMs": 494,
            "exitCode": 1,
            "output": "<29 chars>",
          },
          "type": "tool-bash",
        },
      ]
    `);
  });
});

describe("outlineCommand", () => {
  it.each<readonly [string, string]>([
    ["app tools gmail", "app tools gmail"],
    [
      "memory save name <<'EOF'\nAlex Rivera\nEOF",
      "memory save name <<'EOF'\n<11 chars>\nEOF",
    ],
    [
      "cat <<'EOF' | agent-browser eval --stdin\n(() => document.cookie)()\nEOF",
      "cat <<'EOF' | agent-browser eval --stdin\n<25 chars>\nEOF",
    ],
    [`python -c "${"x".repeat(90)}"`, 'python -c "<90 chars>"'],
    [
      "rg -n -A12 'Your cart' page.txt | head -3",
      "rg -n -A12 'Your cart' page.txt | head -3",
    ],
    ["echo 'unterminated", "<18 chars>"],
    [`NOTE='${"x".repeat(90)}'; echo ok`, "NOTE='<90 chars>'; echo ok"],
    [
      "git commit -m \"$(cat <<'EOF'\nthe message\nEOF\n)\"",
      "git commit -m \"$(cat <<'EOF'\n<11 chars>\nEOF\n)\"",
    ],
    [
      "while read l; do echo $l; done <<EOF\nthe list $HOME\nEOF",
      "while read l; do echo $l; done <<EOF\n<14 chars>\nEOF",
    ],
    // Two heredocs on one line are more than the source search reads.
    ["cat <<'A' <<'B'\none\nA\ntwo\nB", "<27 chars>"],
    // An opener quoted as an example before the real one could be taken for it.
    [
      "printf '%s\\n' '<<EOF\nexample\nEOF\n'\ncat > document.txt <<EOF\nPRIVATE_DOCUMENT_BODY\nEOF",
      "<85 chars>",
    ],
    ...(
      [
        ["<<\\EOF", 65],
        ['<<"E"OF', 66],
        ["<<E\\OF", 65],
        ["<<'E'OF", 66],
      ] as const
    ).map(
      ([opener, length]) =>
        [
          `printf '%s\\n' '<<EOF\nexample\nEOF\n'\ncat > d.txt ${opener}\nPRIVATE\nEOF`,
          `<${length} chars>`,
        ] as const,
    ),
  ])("%j", (command, outlined) => {
    expect(outlineCommand(command)).toBe(outlined);
  });
});
