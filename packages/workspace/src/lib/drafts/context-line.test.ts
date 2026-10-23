import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  contextEntryOf,
  contextLineOf,
  type DraftContextEntry,
  pastedPathOf,
} from "./context-line";

// Resolved, so on Windows it has a drive, as a workspace's root always does.
const rootDir = path.resolve(path.sep, "Users", "sam", "Workspace");
const dir = path.join(rootDir, "Drafts", "2026-10-14");
const base = { dir, rootDir };

describe("a draft's context lines", () => {
  it.each<[string, DraftContextEntry, string]>([
    [
      "a file pasted into the draft",
      { kind: "file", path: path.join(dir, "receipt.png") },
      "receipt.png",
    ],
    [
      "a folder in the workspace",
      { kind: "folder", path: path.join(rootDir, "Kitchen plans") },
      "workspace:/Kitchen plans/",
    ],
    [
      "a file anywhere else",
      { kind: "file", path: path.join(path.sep, "Users", "sam", "a.pdf") },
      path.join(path.sep, "Users", "sam", "a.pdf"),
    ],
    [
      "another chat",
      { chat: "2026-10-12-oven-research-2p9d", kind: "chat" },
      "instrument://chat/2026-10-12-oven-research-2p9d",
    ],
    [
      "a web page",
      { kind: "link", url: "https://example.com/a" },
      "https://example.com/a",
    ],
    [
      "an app",
      { kind: "link", url: "instrument://app/linear" },
      "instrument://app/linear",
    ],
  ])("writes %s and reads it back", (_name, entry, line) => {
    expect(contextLineOf(entry, base)).toBe(line);
    expect(contextEntryOf(line, base)).toEqual(entry);
  });

  it("reads a chat named by its address however it was written", () => {
    expect(contextEntryOf(" instrument://chat/abc ", base)).toEqual({
      chat: "abc",
      kind: "chat",
    });
  });

  it.each([
    ["receipt.png", "receipt.png"],
    ["workspace:/a.png", undefined],
    ["/Users/sam/a.png", undefined],
    ["instrument://chat/abc", undefined],
    ["notes/", undefined],
  ])("reads %s as pasted: %s", (line, pasted) => {
    expect(pastedPathOf(line)).toBe(pasted);
  });
});
