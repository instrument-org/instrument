import { outlineSessionLog } from "@instrument-org/workspace/report-outline";
import { describe, expect, it } from "vitest";

import { chatGroups, kindLabel, recordRows } from "./feedback-records";

const log = (records: unknown[]) =>
  records.map((record) => JSON.stringify(record)).join("\n");

const part = (seq: number, body: Record<string, unknown>) => ({
  at: `2026-10-31T22:14:${String(seq).padStart(2, "0")}.000Z`,
  part: body,
  seq,
  t: "part",
});

const chat = log([
  { id: "ses_1", seq: 0, startedAs: "Star my first email", t: "session" },
  { message: { id: "m1", role: "user" }, seq: 1, t: "message" },
  part(2, { text: "favorite my first email", type: "text" }),
  part(3, {
    data: {
      page: { text: "x".repeat(1500), title: "Inbox (3)" },
      screen: "browser",
      url: "https://mail.google.com/mail/u/0/#inbox",
    },
    type: "data-viewContext",
  }),
  { message: { id: "m2", role: "assistant" }, seq: 4, t: "message" },
  part(5, { type: "step-start" }),
  part(6, { text: "", type: "reasoning" }),
  part(7, { text: "Starring it now.", type: "text" }),
  part(8, {
    input: { command: "app call gmail search_threads" },
    output: {
      exitCode: 1,
      output: "app: Incompatible auth server",
    },
    state: "output-available",
    type: "tool-bash",
  }),
  part(9, {
    input: { command: "agent-browser snapshot" },
    output: { exitCode: 0, output: "y".repeat(6212) },
    state: "output-available",
    type: "tool-bash",
  }),
  part(10, {
    input: { filePath: "/notes.md" },
    output: { content: "what the file says" },
    state: "output-available",
    type: "tool-read_file",
  }),
  { seq: 11, t: "sites", visited: ["mail.google.com"] },
]);

describe("recordRows", () => {
  it("draws every record the outline sends as a label and its first line", () => {
    const rows = recordRows(outlineSessionLog(`${chat}\nnot json\n`).content);
    expect(rows.map(({ label, text }) => `${label} | ${text}`))
      .toMatchInlineSnapshot(`
      [
        "You | favorite my first email",
        "On screen | https://mail.google.com/…",
        "Instrument | Starring it now.",
        "Failed | app call gmail search_threads",
        "Ran | agent-browser snapshot",
        "Read file | /notes.md",
        "Sites | mail.google.com",
        "Unreadable | …",
      ]
    `);
  });

  it("marks a call whose stage failed behind a pipe and lists what ran, its output left out", () => {
    const rows = recordRows(
      outlineSessionLog(
        log([
          part(1, {
            input: { command: "find . | head -5" },
            output: {
              exitCode: 0,
              output: "Error: .: Access is denied. (os error 5)",
              ran: [
                {
                  count: 1,
                  exitCode: 1,
                  failed: 1,
                  name: "find",
                  sandbox: "mxc",
                  source: "bundled",
                  stderr: "Error: .: Access is denied. (os error 5)",
                },
              ],
            },
            type: "tool-bash",
          }),
          part(2, {
            input: { command: "ls | head -5" },
            output: {
              exitCode: 0,
              output: "a.txt",
              ran: [{ count: 1, name: "ls", source: "builtin" }],
            },
            type: "tool-bash",
          }),
        ]),
      ).content,
    );
    expect(rows.map((row) => `${row.label} | ${row.text}`)).toEqual([
      "Failed | find . | head -5",
      "Ran | ls | head -5",
    ]);
    expect(rows[0]?.fields).toMatchInlineSnapshot(`
      [
        {
          "name": "input.command",
          "value": "find . | head -5",
        },
        {
          "name": "output.exitCode",
          "value": "0",
        },
        {
          "name": "output.output",
          "redacted": true,
          "value": "",
        },
        {
          "name": "output.ran[0].count",
          "value": "1",
        },
        {
          "name": "output.ran[0].exitCode",
          "value": "1",
        },
        {
          "name": "output.ran[0].failed",
          "value": "1",
        },
        {
          "name": "output.ran[0].name",
          "value": "find",
        },
        {
          "name": "output.ran[0].sandbox",
          "value": "mxc",
        },
        {
          "name": "output.ran[0].source",
          "value": "bundled",
        },
        {
          "name": "output.ran[0].stderr",
          "value": "Error: .: Access is denied. (os error 5)",
        },
      ]
    `);
  });

  it("opens a record onto its fields by name, what was left out marked redacted", () => {
    const [, page] = recordRows(outlineSessionLog(chat).content);
    expect(page?.fields).toMatchInlineSnapshot(`
      [
        {
          "name": "data.screen",
          "value": "browser",
        },
        {
          "name": "data.tabs",
          "value": "none",
        },
        {
          "name": "data.url",
          "redacted": true,
          "value": "https://mail.google.com/￼",
        },
        {
          "name": "data.page.text",
          "redacted": true,
          "value": "",
        },
        {
          "name": "data.page.title",
          "redacted": true,
          "value": "",
        },
      ]
    `);
  });
});

describe("kindLabel", () => {
  it.each([
    ["tool-bash", "Ran"],
    ["tool-read_file", "Read file"],
    ["data-taskEvent", "Task event"],
    ["card", "Card"],
  ])("%s reads as %s", (kind, label) => {
    expect(kindLabel(kind)).toBe(label);
  });
});

describe("chatGroups", () => {
  it("puts the settings first and closed, one row per change every device made, then each session in time order", () => {
    const setting = log([{ field: "title", seq: 0, t: "set", value: "Hi" }]);
    const groups = chatGroups([
      {
        content: log([part(2, { text: "second", type: "text" })]),
        label: "“Hi”",
        path: "chat/ses_1.mac.jsonl",
      },
      {
        content: log([part(1, { text: "first", type: "text" })]),
        label: "“Hi”",
        path: "chat/ses_1.win.jsonl",
      },
      {
        content: log([part(1, { text: "go", type: "text" })]),
        label: "Task: Look",
        path: "chat/ses_2.mac.jsonl",
      },
      {
        content: setting,
        label: "Chat settings",
        path: "chat/settings.mac.jsonl",
      },
      {
        content: setting,
        label: "Chat settings",
        path: "chat/settings.win.jsonl",
      },
    ]);
    expect(
      groups.map((group) => [
        group.title,
        group.open,
        group.items.map((item) => ("row" in item ? item.row.text : "steps")),
      ]),
    ).toEqual([
      ["Chat settings", false, ["title: Hi"]],
      ["“Hi”", true, ["first", "second"]],
      ["Task: Look", false, ["go"]],
    ]);
  });

  it("folds each run of steps between two things said into one item", () => {
    const [group] = chatGroups([
      {
        content: outlineSessionLog(chat).content,
        label: "“Star my first email”",
        path: "chat/ses_1.mac.jsonl",
      },
    ]);
    expect(
      group?.items.map((item) =>
        "row" in item
          ? item.row.label
          : item.steps.map((step) => step.label).join(", "),
      ),
    ).toMatchInlineSnapshot(`
      [
        "You",
        "On screen",
        "Instrument",
        "Failed, Ran, Read file, Sites",
      ]
    `);
  });
});
