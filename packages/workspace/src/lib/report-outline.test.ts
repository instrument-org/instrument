import { describe, expect, it } from "vitest";

import {
  emptySources,
  fullSessionLog,
  outlineCommand,
  outlineRecord,
  outlineSessionLog,
} from "./report-outline";

/** Planted in every field of every kind; the outline sends it only where the table says words go as written. */
const SECRET = "CANARY-5f1e";

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
        output: { exitCode: 1, output: "app: Incompatible auth server" },
      }),
    ).toMatchObject({
      part: {
        input: {
          command: "app call gmail search_threads '{}'",
          explanation: "Finding the thread",
        },
        output: { exitCode: 1, output: "app: Incompatible auth server" },
      },
    });
  });

  it("keeps the output of Instrument's own status commands, trimmed or not", () => {
    const output = (command: string) =>
      outlineRecord(
        part({
          type: "tool-bash",
          input: { command },
          output: { exitCode: 0, output: "t1 idle" },
        }),
        emptySources(),
      );
    expect(output("task show t1 | head -30")).toMatchObject({
      part: { output: { output: "t1 idle" } },
    });
    expect(output("instrument app test gmail")).toMatchObject({
      part: { output: { output: "t1 idle" } },
    });
    expect(output("cat notes.md")).toMatchObject({
      part: { output: { output: "<7 chars>" } },
    });
    expect(output("task show t1 | grep x")).toMatchObject({
      part: { output: { output: "<7 chars>" } },
    });
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
            "output": "23 tools on gmail.",
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
            "output": "app: Incompatible auth server",
          },
          "type": "tool-bash",
        },
      ]
    `);
  });
});

describe("outlineCommand", () => {
  it.each([
    ["app tools gmail", "app tools gmail"],
    [
      "memory save name <<'EOF'\nJeremy Mack\nEOF",
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
  ])("%j", (command, outlined) => {
    expect(outlineCommand(command)).toBe(outlined);
  });
});

describe("fullSessionLog", () => {
  it("keeps what was read and leaves out the thinking", () => {
    const log = [
      part({
        type: "reasoning",
        text: "thinking about it",
        providerMetadata: { x: 1 },
      }),
      part({
        type: "tool-read_file",
        input: { filePath: "/a.md" },
        output: { content: "the file" },
      }),
    ]
      .map((record) => JSON.stringify(record))
      .join("\n");
    const full = fullSessionLog(log);
    expect(full).not.toContain("thinking about it");
    expect(full).toContain("the file");
  });
});
