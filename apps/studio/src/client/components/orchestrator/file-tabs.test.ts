import { describe, expect, it } from "vitest";

import { mountOfHostPath } from "./file-tabs";

const CONVERSATION_FOLDERS = {
  home: { mountName: "Home", path: "/Users/casey" },
  workspace: {
    mountName: "Instrument",
    path: "/Users/casey/Documents/Instrument",
  },
};

const WINDOWS_FOLDERS = {
  home: { mountName: "Home", path: "C:\\Users\\casey" },
  workspace: {
    mountName: "Instrument",
    path: "C:\\Users\\casey\\Documents\\Instrument",
  },
};

describe("mountOfHostPath", () => {
  // A virtual path is POSIX wherever it came from, so a Windows path must not
  // carry its separators into one.
  it("reads a Windows path back through the deepest grant", () => {
    expect(
      mountOfHostPath(
        "C:\\Users\\casey\\Documents\\Instrument\\lisbon\\hotels.md",
        WINDOWS_FOLDERS,
      ),
    ).toBe("/mnt/Instrument/lisbon/hotels.md");
  });

  it("reads a POSIX path back", () => {
    expect(
      mountOfHostPath(
        "/Users/casey/Downloads/receipt.pdf",
        CONVERSATION_FOLDERS,
      ),
    ).toBe("/mnt/Home/Downloads/receipt.pdf");
  });

  it("answers the mount itself for the granted folder", () => {
    expect(mountOfHostPath("C:\\Users\\casey", WINDOWS_FOLDERS)).toBe(
      "/mnt/Home",
    );
  });

  it("answers nothing for a path no grant covers", () => {
    expect(
      mountOfHostPath("D:\\Archive\\2019.csv", WINDOWS_FOLDERS),
    ).toBeUndefined();
  });
});
