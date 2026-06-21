import { describe, expect, it } from "vitest";

import { shouldAttachClipboardItem } from "./paste-clipboard";

describe("shouldAttachClipboardItem", () => {
  it.each([
    // Word/PowerPoint on macOS: text + image rendering of that text.
    {
      expected: false,
      hasText: true,
      item: { kind: "file", type: "image/png" },
      name: "image alongside text (Word paste)",
    },
    {
      expected: false,
      hasText: true,
      item: { kind: "file", type: "image/tiff" },
      name: "tiff alongside text",
    },
    // Genuine image paste with no text should attach.
    {
      expected: true,
      hasText: false,
      item: { kind: "file", type: "image/png" },
      name: "image-only paste",
    },
    // Real files attach even when text is present (e.g. copied PDF + name).
    {
      expected: true,
      hasText: true,
      item: { kind: "file", type: "application/pdf" },
      name: "non-image file with text",
    },
    // Plain string clipboard entries are never attachments.
    {
      expected: false,
      hasText: true,
      item: { kind: "string", type: "text/plain" },
      name: "text string item",
    },
  ])("$name", ({ expected, hasText, item }) => {
    expect(shouldAttachClipboardItem({ hasText, item })).toBe(expected);
  });
});
