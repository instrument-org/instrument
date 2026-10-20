import { describe, expect, it } from "vitest";

import {
  folderOf,
  homeRelative,
  isInside,
  nameOf,
  parentFolderOf,
  relativeHostPath,
  segmentsOf,
  separatorOf,
} from "./host-path";

// Paths reach the window spelled the way the computer they came from spells
// them, so every one of these reads a Windows path as readily as a POSIX one.
describe("separatorOf", () => {
  it.each([
    ["/Users/sam/Desktop", "/"],
    ["C:\\Users\\sam\\Desktop", "\\"],
    ["C:\\", "\\"],
    ["\\\\server\\share", "\\"],
    ["/Users/sam/a\\b.txt", "/"],
  ])("reads %s as %s", (hostPath, separator) => {
    expect(separatorOf(hostPath)).toBe(separator);
  });
});

describe("folderOf", () => {
  it.each([
    ["/Users/sam/Desktop/notes.txt", "/Users/sam/Desktop"],
    ["/notes.txt", "/"],
    ["C:\\Users\\sam\\Desktop\\notes.txt", "C:\\Users\\sam\\Desktop"],
    ["/Users/sam/a\\b.txt", "/Users/sam"],
  ])("puts %s in %s", (hostPath, folder) => {
    expect(folderOf(hostPath)).toBe(folder);
  });
});

describe("parentFolderOf", () => {
  it.each([
    ["/Users/sam/Desktop", "/Users/sam"],
    ["/Users", "/"],
    ["/", null],
    ["C:\\Users\\sam", "C:\\Users"],
    ["C:\\Users", "C:\\"],
    ["C:\\", null],
    // A network share's top is as far up as it goes: the server alone is no
    // folder anything can open.
    ["\\\\nas\\photos\\2024\\march", "\\\\nas\\photos\\2024"],
    ["\\\\nas\\photos\\2024", "\\\\nas\\photos"],
    ["\\\\nas\\photos", null],
    ["\\\\nas\\photos\\", null],
  ])("goes up from %s to %s", (hostPath, parent) => {
    expect(parentFolderOf(hostPath)).toBe(parent);
  });
});

describe("relativeHostPath", () => {
  it.each([
    ["/Users/sam", "/Users/sam/Desktop/notes.txt", "Desktop/notes.txt"],
    ["/Users/sam/", "/Users/sam/Desktop", "Desktop"],
    ["/", "/Users/sam", "Users/sam"],
    ["/Users/sam", "/Users/samantha/notes.txt", null],
    ["/Users/sam", "/Applications/Notes.app", null],
    [
      "C:\\Users\\sam",
      "C:\\Users\\sam\\Desktop\\notes.txt",
      "Desktop/notes.txt",
    ],
    ["C:\\", "C:\\Users\\sam", "Users/sam"],
    ["C:\\Users\\sam", "C:\\Users\\samantha\\notes.txt", null],
    ["C:\\Users\\sam", "D:\\notes.txt", null],
    ["\\\\nas\\photos", "\\\\nas\\photos\\2024\\beach.jpg", "2024/beach.jpg"],
  ])("puts %s + %s at %s", (root, hostPath, relative) => {
    expect(relativeHostPath(root, hostPath)).toBe(relative);
  });
});

describe("homeRelative", () => {
  it("writes the home folder as ~", () => {
    expect(homeRelative("/Users/sam", "/Users/sam")).toBe("~");
    expect(homeRelative("/Users/sam/Desktop", "/Users/sam")).toBe("~/Desktop");
  });

  it("leaves a path outside the home folder alone", () => {
    expect(homeRelative("/Applications", "/Users/sam")).toBe("/Applications");
  });

  // `~` is a Mac and Linux spelling. On Windows it names nothing, and a person
  // shown it would have no idea which folder they were looking at.
  it("writes a Windows path out in full", () => {
    expect(homeRelative("C:\\Users\\sam", "C:\\Users\\sam")).toBe(
      "C:\\Users\\sam",
    );
    expect(homeRelative("C:\\Users\\sam\\Desktop", "C:\\Users\\sam")).toBe(
      "C:\\Users\\sam\\Desktop",
    );
  });
});

describe("isInside", () => {
  it.each([
    ["/Users/sam/Desktop", "/Users/sam", true],
    ["/Users/samantha", "/Users/sam", false],
    ["C:\\Users\\sam", "C:\\", true],
    ["C:\\Users\\sam", "D:\\", false],
    ["/Volumes/Backup/photos", "/Volumes/Backup", true],
  ])("%s inside %s is %s", (hostPath, folder, expected) => {
    expect(isInside(hostPath, folder)).toBe(expected);
  });
});

describe("nameOf", () => {
  it.each([
    ["/Users/sam/chat/output/report.md", "report.md"],
    ["/Users/sam/home/notes/", "notes"],
    ["report.md", "report.md"],
    // What the main process hands back on Windows: a new folder, a copy,
    // and a folder a chat holds.
    ["C:\\Users\\sam\\Documents\\New folder", "New folder"],
    ["C:\\Users\\sam\\Documents\\notes - Copy.txt", "notes - Copy.txt"],
    ["\\\\server\\share\\Reports\\", "Reports"],
    // A backslash is a character a name can hold on a Mac or Linux.
    ["/Users/sam/a\\b.txt", "a\\b.txt"],
    ["/Users/sam/back\\slash/", "back\\slash"],
  ])("calls %s %s", (hostPath, name) => {
    expect(nameOf(hostPath)).toBe(name);
  });
});

describe("segmentsOf", () => {
  it.each([
    ["/Users/sam/Desktop", ["Users", "sam", "Desktop"]],
    ["C:\\Users\\sam\\Desktop", ["C:", "Users", "sam", "Desktop"]],
    ["C:\\", ["C:"]],
    ["/", []],
    ["/Users/sam/a\\b.txt", ["Users", "sam", "a\\b.txt"]],
    ["\\\\server\\share\\Reports", ["server", "share", "Reports"]],
  ])("reads %s", (hostPath, segments) => {
    expect(segmentsOf(hostPath)).toEqual(segments);
  });
});
