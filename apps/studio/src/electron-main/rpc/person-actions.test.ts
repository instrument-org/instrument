import { describe, expect, it } from "vitest";

import { actionsOfCall } from "./person-actions";

const call = (route: string, input: unknown, output?: unknown) =>
  actionsOfCall(route.split("."), input, output);

describe("actionsOfCall", () => {
  it.each([
    [
      "files.rename",
      { name: "Q3.pdf", path: "/Users/sam/Q3 draft.pdf" },
      { path: "/Users/sam/Q3.pdf" },
      [
        {
          from: "/Users/sam/Q3 draft.pdf",
          kind: "rename",
          to: "/Users/sam/Q3.pdf",
        },
      ],
    ],
    [
      "files.trash",
      { path: "/Users/sam/old.txt" },
      { journalId: null },
      [{ kind: "trash", paths: ["/Users/sam/old.txt"] }],
    ],
    [
      "files.newFolder",
      { parent: "/Users/sam" },
      { path: "/Users/sam/untitled folder" },
      [{ kind: "new-folder", path: "/Users/sam/untitled folder" }],
    ],
    [
      "files.duplicate",
      { path: "/Users/sam/notes.md" },
      { path: "/Users/sam/notes copy.md" },
      [
        {
          from: "/Users/sam",
          kind: "copy",
          names: ["notes.md"],
          to: "/Users/sam",
        },
      ],
    ],
    [
      "files.write",
      {
        baseVersion: "v1",
        content: "what the file says",
        path: "/Users/sam/a.md",
      },
      { ok: true, version: "v2" },
      [{ kind: "edit", path: "/Users/sam/a.md" }],
    ],
    [
      "preferences.setTheme",
      { theme: "dark" },
      undefined,
      [{ kind: "setting", name: "Theme", value: "Dark" }],
    ],
    [
      "preferences.setShareActionsWithChats",
      { enabled: false },
      undefined,
      [
        {
          kind: "setting",
          name: "Share what you do in the app with chats",
          value: "Off",
        },
      ],
    ],
    [
      "preferences.setDefaultModelURI",
      {
        modelURI:
          "anthropic/claude-sonnet-5?provider=anthropic&providerConfigId=pc_1",
      },
      undefined,
      [
        {
          kind: "setting",
          name: "Default model",
          value: "anthropic/claude-sonnet-5",
        },
      ],
    ],
    [
      "preferences.setReleaseChannel",
      {},
      undefined,
      [{ kind: "setting", name: "Release channel", value: "Default" }],
    ],
  ])("turns %s into what the person did", (route, input, output, actions) => {
    expect(call(route, input, output)).toEqual(actions);
  });

  it("names a copy or move into a folder once for each folder the things came from", () => {
    const placed = (from: string, path: string) => ({
      from,
      how: "moved",
      path,
      replaced: false,
    });
    expect(
      call(
        "files.moveInto",
        {
          folder: "/Users/sam/Archive",
          paths: ["/Users/sam/Downloads/a.pdf", "/Users/sam/Desktop/c.pdf"],
        },
        {
          failure: null,
          journalId: "j1",
          placed: [
            placed("/Users/sam/Downloads/a.pdf", "/Users/sam/Archive/a.pdf"),
            placed("/Users/sam/Downloads/b.pdf", "/Users/sam/Archive/b.pdf"),
            placed("/Users/sam/Desktop/c.pdf", "/Users/sam/Archive/c.pdf"),
          ],
          protection: null,
          skipped: [],
          trashed: [],
        },
      ),
    ).toEqual([
      {
        from: "/Users/sam/Downloads",
        kind: "move",
        names: ["a.pdf", "b.pdf"],
        to: "/Users/sam/Archive",
      },
      {
        from: "/Users/sam/Desktop",
        kind: "move",
        names: ["c.pdf"],
        to: "/Users/sam/Archive",
      },
    ]);
    expect(
      call(
        "files.copyInto",
        { folder: "/Users/sam/Archive", paths: ["/Users/sam/a.pdf"] },
        { placed: [] },
      ),
    ).toEqual([]);
  });

  it.each([
    // A save that something else's write turned away.
    [
      "files.write",
      { content: "x", path: "/Users/sam/a.md" },
      { content: "y", ok: false, version: "v3" },
    ],
    // A rename to the name it already had.
    [
      "files.rename",
      { name: "a.md", path: "/Users/sam/a.md" },
      { path: "/Users/sam/a.md" },
    ],
    // A paste is the keys' own Paste, which says nothing of files.
    ["files.paste", undefined, undefined],
    // Input the route would not have taken.
    ["files.trash", { path: 3 }, { journalId: null }],
    // A route the log does not keep.
    ["files.read", { path: "/Users/sam/a.md" }, { content: "x" }],
  ])("records nothing for %s", (route, input, output) => {
    expect(call(route, input, output)).toEqual([]);
  });
});
