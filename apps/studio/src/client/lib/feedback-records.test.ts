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
  it("draws every record the outline sends as a label, its first line and what stayed home", () => {
    const rows = recordRows(outlineSessionLog(`${chat}\nnot json\n`).content);
    expect(
      rows.map(({ label, notSent, text }) =>
        [label, text, notSent].join(" | "),
      ),
    ).toMatchInlineSnapshot(`
      [
        "You | favorite my first email | 0",
        "On screen | https://mail.google.com/… | 1524",
        "Instrument | Starring it now. | 0",
        "Failed | app call gmail search_threads | 0",
        "Ran | agent-browser snapshot | 6212",
        "Read file | /notes.md | 18",
        "Sites | mail.google.com | 0",
        "Unreadable | … | 0",
      ]
    `);
  });

  it("opens a record onto its fields by name, a sized one as its length", () => {
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
          "notSent": 15,
          "value": "https://mail.google.com/…",
        },
        {
          "name": "data.page.text",
          "notSent": 1500,
          "value": "",
        },
        {
          "name": "data.page.title",
          "notSent": 9,
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
  it("puts the settings first, one row per change every device made, then each session in time order", () => {
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
      groups.map((group) => [group.title, group.rows.map((row) => row.text)]),
    ).toEqual([
      ["Chat settings", ["title: Hi"]],
      ["“Hi”", ["first", "second"]],
    ]);
  });
});
