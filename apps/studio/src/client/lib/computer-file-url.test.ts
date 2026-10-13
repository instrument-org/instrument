import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  getComputerFileUrl,
  hostPathOfComputerFileUrl,
  resolveComputerFileBase,
} from "./computer-file-url";

vi.mock("../rpc/client", () => ({
  rpcClient: {
    utils: {
      computerFileBase: {
        call: () => Promise.resolve("instrument-file://token"),
      },
    },
  },
}));

beforeAll(async () => {
  await resolveComputerFileBase();
});

describe("getComputerFileUrl", () => {
  it.each([
    ["/Users/sam/notes.txt", "instrument-file://token/Users/sam/notes.txt"],
    // A backslash is a character a name can hold on a Mac or Linux.
    ["/Users/sam/a\\b.txt", "instrument-file://token/Users/sam/a%5Cb.txt"],
    [
      "C:\\Users\\sam\\notes.txt",
      "instrument-file://token/C%3A/Users/sam/notes.txt",
    ],
  ])("addresses %s at %s", (hostPath, url) => {
    expect(getComputerFileUrl({ hostPath })).toBe(url);
  });

  it.each(["/Users/sam/a\\b.txt", "C:\\Users\\sam\\notes.txt"])(
    "reads %s back off its URL",
    (hostPath) => {
      expect(hostPathOfComputerFileUrl(getComputerFileUrl({ hostPath }))).toBe(
        hostPath,
      );
    },
  );
});
