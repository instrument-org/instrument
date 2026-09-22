import { describe, expect, it } from "vitest";

import { isMessageDocument, parseMessage } from "./parse-message";

describe("parseMessage", () => {
  it("reads front matter and the body under it", () => {
    expect(
      parseMessage(
        "---\nmessage: email\nto: Dana Whitfield <dana@whitfield.studio>\nsubject: Friday instead\n---\n\nHi Dana,\n\nCould we move it?\n",
      ),
    ).toMatchInlineSnapshot(`
      {
        "body": "Hi Dana,

      Could we move it?",
        "kind": "email",
        "subject": "Friday instead",
        "to": "Dana Whitfield <dana@whitfield.studio>",
      }
    `);
  });

  it.each([
    ["bare headers", "to: Sam\nvia: Messages\n\nRunning late", "other", "Sam"],
    ["a kind", "message: text\nto: Sam\n\nRunning late", "text", "Sam"],
    ["no headers", "Running late", "other", undefined],
    ["a subject alone", "subject: Hi\n\nBody", "email", undefined],
    ["an unknown kind", "message: fax\n\nBody", "other", undefined],
  ])("reads %s", (_name, source, kind, to) => {
    const message = parseMessage(source);
    expect(message.kind).toBe(kind);
    expect(message.to).toBe(to);
  });

  it("keeps a first line that only looks like a header in the body", () => {
    expect(parseMessage("Note: I'm late\nsorry").body).toBe(
      "Note: I'm late\nsorry",
    );
  });

  it("reads an unclosed front matter as headers still arriving", () => {
    expect(parseMessage("---\nmessage: email\nto: Da")).toMatchInlineSnapshot(`
      {
        "body": "",
        "kind": "email",
        "to": "Da",
      }
    `);
  });

  it("joins a list of recipients", () => {
    expect(parseMessage("---\nto: [Ana, Bo]\n---\nHi").to).toBe("Ana, Bo");
  });

  it("reads front matter YAML cannot parse line by line", () => {
    expect(
      parseMessage("---\nmessage: email\nsubject: Re: the: plan\n---\nHi")
        .subject,
    ).toBe("Re: the: plan");
  });
});

describe("isMessageDocument", () => {
  it.each([
    ["---\nmessage: email\n---\nHi", true],
    ["---\ntitle: Notes\n---\nHi", false],
    ["# Notes", false],
  ])("%j is %s", (source, expected) => {
    expect(isMessageDocument(source)).toBe(expected);
  });
});
