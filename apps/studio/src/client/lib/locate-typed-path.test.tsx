import { describe, expect, it, vi } from "vitest";

import { type MissedPath, missedPathNotice } from "./locate-typed-path";

vi.mock("@/client/rpc/client", () => ({ rpcClient: {} }));

describe("missedPathNotice", () => {
  it.each<[MissedPath, string, string]>([
    // A share's root comes back from the system with a separator after it,
    // which says nothing about where it is.
    [
      { code: "UNKNOWN", kind: "failed", path: "\\\\10.255.255.1\\x\\" },
      "\\\\10.255.255.1\\x\\",
      "Can’t open “\\\\10.255.255.1\\x”. The network share it’s on isn’t answering.",
    ],
    [
      { code: "EHOSTUNREACH", kind: "failed", path: "\\\\nas\\photos\\2024" },
      "\\\\nas\\photos\\2024",
      "Can’t open “\\\\nas\\photos\\2024”. The drive it’s on isn’t answering.",
    ],
    // A drive's top keeps its separator, as the drive is written.
    [
      { code: "EIO", kind: "failed", path: "C:\\" },
      "C:\\",
      "Can’t open “C:\\”. The drive it’s on isn’t answering.",
    ],
    // Named as typed: the home folder stays `~`.
    [
      { kind: "missing", path: "/Users/sam/nothing/" },
      "~/nothing/",
      "Can’t find “~/nothing”",
    ],
    [
      { code: "UNKNOWN", kind: "failed", path: "/Volumes/odd" },
      "/Volumes/odd",
      "Can’t open “/Volumes/odd”.",
    ],
    // A path that never parsed, or a look that never answered, may still
    // be there, so it is said as a failure to open.
    [
      { kind: "failed", path: "/Volumes/odd" },
      "/Volumes/odd",
      "Can’t open “/Volumes/odd”.",
    ],
  ])("says %o typed as %s as %s", (missed, written, notice) => {
    expect(missedPathNotice(missed, written)).toBe(notice);
  });
});
