import { describe, expect, it } from "vitest";

import {
  dictatedToken,
  renderDictatedForModel,
  splitDictatedText,
  stripDictatedMarks,
} from "@instrument-org/shared/dictated-text";

const line = `Compare ${dictatedToken("Zendesk and Front")} at 10 agents`;

describe("dictated text", () => {
  it("splits a line into typed and dictated runs", () => {
    expect(splitDictatedText(line)).toEqual([
      { dictated: false, text: "Compare " },
      { dictated: true, text: "Zendesk and Front" },
      { dictated: false, text: " at 10 agents" },
    ]);
  });

  it("reads as plain words to a person", () => {
    expect(stripDictatedMarks(line)).toBe(
      "Compare Zendesk and Front at 10 agents",
    );
  });

  it("reads as tagged words to the model", () => {
    expect(renderDictatedForModel(line)).toBe(
      "Compare <dictated>Zendesk and Front</dictated> at 10 agents",
    );
  });

  it("reads a [ typed before a token as typed text", () => {
    const wire = `Fill in [ ${dictatedToken("the missing value")}`;
    expect(wire).toMatchInlineSnapshot(
      `"Fill in [ [the missing value](dictated:)"`,
    );
    expect(splitDictatedText(wire)).toMatchInlineSnapshot(`
      [
        {
          "dictated": false,
          "text": "Fill in [ ",
        },
        {
          "dictated": true,
          "text": "the missing value",
        },
      ]
    `);
    expect(stripDictatedMarks(wire)).toMatchInlineSnapshot(
      `"Fill in [ the missing value"`,
    );
  });

  it.each(["items[0]", "a ] b", "back\\slash", "[bracketed]", "a [ b", "]["])(
    "keeps %s whole through the wire form",
    (words) => {
      const wire = `x ${dictatedToken(words)} y`;
      expect(splitDictatedText(wire)).toEqual([
        { dictated: false, text: "x " },
        { dictated: true, text: words },
        { dictated: false, text: " y" },
      ]);
      expect(stripDictatedMarks(wire)).toBe(`x ${words} y`);
    },
  );

  it("writes several lines as a token each, which read back as the words", () => {
    const wire = dictatedToken("one\ntwo");
    expect(wire).toBe("[one](dictated:)\n[two](dictated:)");
    expect(stripDictatedMarks(wire)).toBe("one\ntwo");
  });
});
