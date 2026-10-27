import { describe, expect, it, vi } from "vitest";

import { type MissedPath, missedPathNotice } from "./locate-typed-path";

vi.mock("@/client/rpc/client", () => ({ rpcClient: {} }));

describe("missedPathNotice", () => {
  it.each<[MissedPath, string]>([
    // A share's root comes back from the system with a separator after it,
    // which says nothing about where it is.
    [
      { code: "UNKNOWN", kind: "failed", path: "\\\\10.255.255.1\\x\\" },
      "Instrument couldn’t open “\\\\10.255.255.1\\x”. The network share it’s on isn’t answering.",
    ],
    [
      { code: "EHOSTUNREACH", kind: "failed", path: "\\\\nas\\photos\\2024" },
      "Instrument couldn’t open “\\\\nas\\photos\\2024”. The drive it’s on isn’t answering.",
    ],
    // A drive's top keeps its separator, as the drive is written.
    [
      { code: "EIO", kind: "failed", path: "C:\\" },
      "Instrument couldn’t open “C:\\”. The drive it’s on isn’t answering.",
    ],
    [
      { kind: "missing", path: "/Users/sam/nothing/" },
      "There’s nothing at “sam/nothing”.",
    ],
    [
      { code: "UNKNOWN", kind: "failed", path: "/Volumes/odd" },
      "Instrument couldn’t open “/Volumes/odd”.",
    ],
    // A path that never parsed, or a look that never answered, may still
    // be there, so it is said as a failure to open.
    [
      { kind: "failed", path: "/Volumes/odd" },
      "Instrument couldn’t open “/Volumes/odd”.",
    ],
  ])("says %o as %s", (missed, notice) => {
    expect(missedPathNotice(missed)).toBe(notice);
  });
});
