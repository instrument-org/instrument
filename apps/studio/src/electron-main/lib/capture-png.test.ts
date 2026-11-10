import { describe, expect, it } from "vitest";

import { readCaptureText, withCaptureText } from "./capture-png";

// A 1x1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const keywordCount = (png: Buffer) =>
  png.toString("latin1").split("instrument-capture").length - 1;

describe("capture text", () => {
  it("reads back what was written, and replaces it on a second write", () => {
    const once = withCaptureText(PNG, { build: "dev", n: 1 });
    expect(readCaptureText(once)).toEqual({ build: "dev", n: 1 });
    const twice = withCaptureText(once, { n: 2, text: "ünïcode" });
    expect(readCaptureText(twice)).toEqual({ n: 2, text: "ünïcode" });
    expect(keywordCount(twice)).toBe(1);
  });

  it("finds nothing in a PNG without it, or in something else", () => {
    expect(readCaptureText(PNG)).toBeUndefined();
    expect(readCaptureText(Buffer.from("not a png"))).toBeUndefined();
  });
});
