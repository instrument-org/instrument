import { describe, expect, it } from "vitest";

import { inWorkspacePath, workspaceHostPath } from "./workspace-relative-path";

describe("inWorkspacePath", () => {
  it.each([
    ["/Users/sam/Instrument/Notes/plan.md", "/Users/sam/Instrument"],
    ["/Users/sam/Instrument/Notes/plan.md", "/Users/sam/Instrument/"],
    [
      String.raw`C:\Users\sam\Instrument\Notes\plan.md`,
      String.raw`C:\Users\sam\Instrument`,
    ],
    // Windows does not tell case apart, so neither does the root.
    [
      String.raw`c:\users\sam\instrument\Notes\plan.md`,
      String.raw`C:\Users\sam\Instrument`,
    ],
  ])("keeps %s under %s by its place", (hostPath, root) => {
    expect(inWorkspacePath(hostPath, root)).toBe("workspace:/Notes/plan.md");
  });

  it.each([
    ["a file outside", "/Users/sam/Pictures/cat.png", "/Users/sam/Instrument"],
    [
      "a sibling sharing the root's name",
      "/Users/sam/Instrument Old/a.md",
      "/Users/sam/Instrument",
    ],
    ["the root itself", "/Users/sam/Instrument", "/Users/sam/Instrument"],
    [
      "another case on macOS",
      "/Users/sam/instrument/a.md",
      "/Users/sam/Instrument",
    ],
  ])("leaves %s alone", (_label, hostPath, root) => {
    expect(inWorkspacePath(hostPath, root)).toBeUndefined();
  });
});

describe("workspaceHostPath", () => {
  // The point of keeping it this way: written on one computer, read on
  // another where the workspace is somewhere else, or on another system.
  it.each([
    ["/Users/sam/Instrument", "/Users/sam/Instrument/Notes/plan.md"],
    [
      "/home/alex/Documents/Instrument/",
      "/home/alex/Documents/Instrument/Notes/plan.md",
    ],
    [
      String.raw`C:\Users\alex\Instrument`,
      String.raw`C:\Users\alex\Instrument\Notes\plan.md`,
    ],
    ["D:\\", String.raw`D:\Notes\plan.md`],
  ])("reads a path written on a Mac under %s", (root, expected) => {
    const stored = inWorkspacePath(
      "/Users/mac-user/Instrument/Notes/plan.md",
      "/Users/mac-user/Instrument",
    );
    expect(workspaceHostPath(stored ?? "", root)).toBe(expected);
  });

  it("reads a path written on Windows under a Mac's root", () => {
    const stored = inWorkspacePath(
      String.raw`C:\Users\alex\Instrument\Notes\plan.md`,
      String.raw`C:\Users\alex\Instrument`,
    );
    expect(workspaceHostPath(stored ?? "", "/Users/sam/Instrument")).toBe(
      "/Users/sam/Instrument/Notes/plan.md",
    );
  });

  it.each([
    ["climbs out of the root", "workspace:/../secrets.txt"],
    ["names the root itself", "workspace:/"],
    ["is not kept by its place", "/Users/sam/Instrument/Notes/plan.md"],
    ["is relative to the chat", "attachments/cat.png"],
  ])("gives nothing for a path that %s", (_label, stored) => {
    expect(workspaceHostPath(stored, "/Users/sam/Instrument")).toBeNull();
  });
});
