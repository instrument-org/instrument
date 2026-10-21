import { describe, expect, it } from "vitest";

import { isAddressableChatFilePath } from "./chat-file-path";
import { normalizeChatFilePath } from "./normalize-chat-file-path";

describe("normalizeChatFilePath", () => {
  it.each([
    ["work/report.html", "work/report.html", true],
    ["./output/chart.png", "output/chart.png", true],
    ["/c/Users/sam/notes.txt", "/c/Users/sam/notes.txt", true],
    [
      String.raw`C:\Users\sam\sp ace\notes.txt`,
      "/c/Users/sam/sp ace/notes.txt",
      true,
    ],
    ["C:/Users/sam/sp ace/notes.txt", "/c/Users/sam/sp ace/notes.txt", true],
    [String.raw`d:\Data/mixed\notes.txt`, "/d/Data/mixed/notes.txt", true],
    ["C:\\Users\\sam\\Photos\\", "/c/Users/sam/Photos/", true],
    [
      String.raw`C:\Users\..\Windows\win.ini`,
      "/c/Users/../Windows/win.ini",
      false,
    ],
    [String.raw`work\report.html`, String.raw`work\report.html`, false],
    [
      String.raw`\\nas\photos\2024\shot.png`,
      "//nas/photos/2024/shot.png",
      true,
    ],
    [String.raw`\\nas\photos\..\x`, "//nas/photos/../x", false],
  ])("%s -> %s (addressable: %s)", (path, normalized, addressable) => {
    expect(normalizeChatFilePath(path)).toBe(normalized);
    expect(isAddressableChatFilePath(normalizeChatFilePath(path))).toBe(
      addressable,
    );
  });
});
