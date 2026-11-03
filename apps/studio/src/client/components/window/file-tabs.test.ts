import { describe, expect, it } from "vitest";

import { reachablePath } from "./file-tabs";

const CONVERSATION_FOLDERS = {
  home: { path: "/Users/casey" },
  workspace: { path: "/Users/casey/Documents/Instrument" },
};

const WINDOWS_FOLDERS = {
  home: { path: "C:\\Users\\casey" },
  workspace: { path: "C:\\Users\\casey\\Documents\\Instrument" },
};

describe("reachablePath", () => {
  it("answers a Windows path a grant covers as it is", () => {
    expect(
      reachablePath(
        "C:\\Users\\casey\\Documents\\Instrument\\lisbon\\hotels.md",
        WINDOWS_FOLDERS,
      ),
    ).toBe("C:\\Users\\casey\\Documents\\Instrument\\lisbon\\hotels.md");
  });

  it("answers a POSIX path a grant covers as it is", () => {
    expect(
      reachablePath("/Users/casey/Downloads/receipt.pdf", CONVERSATION_FOLDERS),
    ).toBe("/Users/casey/Downloads/receipt.pdf");
  });

  it("answers the granted folder itself", () => {
    expect(reachablePath("C:\\Users\\casey", WINDOWS_FOLDERS)).toBe(
      "C:\\Users\\casey",
    );
  });

  it("answers nothing for a path no grant covers", () => {
    expect(
      reachablePath("D:\\Archive\\2019.csv", WINDOWS_FOLDERS),
    ).toBeUndefined();
  });
});
