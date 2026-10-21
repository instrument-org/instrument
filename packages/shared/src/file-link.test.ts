import { describe, expect, it } from "vitest";

import { filePathOfInstrumentLink } from "./file-link";

describe("filePathOfInstrumentLink", () => {
  it.each([
    [
      "instrument://file//Users/sam/Journal/2026-09-23.md",
      "/Users/sam/Journal/2026-09-23.md",
    ],
    [
      "instrument://file/Users/sam/Journal/2026-09-23.md",
      "/Users/sam/Journal/2026-09-23.md",
    ],
    ["instrument://File/Users/sam/My%20Notes/a.md", "/Users/sam/My Notes/a.md"],
    ["instrument://file/", undefined],
    ["instrument://chat/ses_01", undefined],
    ["https://file/Users/sam/a.md", undefined],
  ])("%s", (url, path) => {
    expect(filePathOfInstrumentLink(url)).toBe(path);
  });
});
