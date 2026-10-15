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

  it.each(["items[0]", "a ] b", "back\\slash"])(
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
