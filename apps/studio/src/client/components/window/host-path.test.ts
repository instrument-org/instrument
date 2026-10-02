import { describe, expect, it } from "vitest";

import {
  folderOf,
  homeRelative,
  isInside,
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
  ])("reads %s as %s", (hostPath, separator) => {
    expect(separatorOf(hostPath)).toBe(separator);
  });
});

describe("folderOf", () => {
  it.each([
    ["/Users/sam/Desktop/notes.txt", "/Users/sam/Desktop"],
    ["/notes.txt", "/"],
    ["C:\\Users\\sam\\Desktop\\notes.txt", "C:\\Users\\sam\\Desktop"],
  ])("puts %s in %s", (hostPath, folder) => {
    expect(folderOf(hostPath)).toBe(folder);
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

describe("segmentsOf", () => {
  it.each([
    ["/Users/sam/Desktop", ["Users", "sam", "Desktop"]],
    ["C:\\Users\\sam\\Desktop", ["C:", "Users", "sam", "Desktop"]],
    ["C:\\", ["C:"]],
    ["/", []],
  ])("reads %s", (hostPath, segments) => {
    expect(segmentsOf(hostPath)).toEqual(segments);
  });
});
