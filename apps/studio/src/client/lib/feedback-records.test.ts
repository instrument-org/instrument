import { describe, expect, it } from "vitest";

import { recordRows } from "./feedback-records";

const lines = [
  {
    at: "2026-10-25T14:26:12.644Z",
    id: "ses_1",
    seq: 0,
    startedAs: "Red and blue squares",
    t: "session",
  },
  {
    message: {
      id: "msg_1",
      metadata: { aiGatewayModel: { name: "GPT 6 Luna" } },
      role: "assistant",
    },
    seq: 1,
    t: "message",
  },
  { part: { text: "Make a\n  PDF.", type: "text" }, seq: 2, t: "part" },
  {
    part: {
      input: { command: "ls", explanation: "Checking the folder" },
      state: "output-error",
      type: "tool-bash",
    },
    seq: 3,
    t: "part",
  },
  { part: { type: "step-start" }, seq: 4, t: "part" },
  { field: "title", seq: 5, t: "set", value: "Squares" },
]
  .map((line) => JSON.stringify(line))
  .join("\n");

describe("recordRows", () => {
  it("names each record by its own type with a gist beside it", () => {
    expect(
      recordRows(`${lines}\n\nnot json\n`).map(
        ({ detail, failed, kind, seq }) => ({ detail, failed, kind, seq }),
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "detail": "Red and blue squares",
          "failed": false,
          "kind": "session",
          "seq": 0,
        },
        {
          "detail": "assistant · GPT 6 Luna",
          "failed": false,
          "kind": "message",
          "seq": 1,
        },
        {
          "detail": "Make a PDF.",
          "failed": false,
          "kind": "text",
          "seq": 2,
        },
        {
          "detail": "Checking the folder",
          "failed": true,
          "kind": "tool-bash",
          "seq": 3,
        },
        {
          "detail": "",
          "failed": false,
          "kind": "step-start",
          "seq": 4,
        },
        {
          "detail": "title = "Squares"",
          "failed": false,
          "kind": "set",
          "seq": 5,
        },
        {
          "detail": "not json",
          "failed": true,
          "kind": "?",
          "seq": undefined,
        },
      ]
    `);
  });

  it("keeps each record whole, indented", () => {
    expect(recordRows(lines)[4]?.json).toMatchInlineSnapshot(`
      "{
        "part": {
          "type": "step-start"
        },
        "seq": 4,
        "t": "part"
      }"
    `);
  });
});
