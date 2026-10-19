import {
  buildExceptionEvent,
  type ExceptionEvent,
} from "@instrument-org/shared/exceptions";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "" } }));
vi.mock("@/electron-main/rpc/publisher", () => ({
  publisher: { publish: vi.fn() },
}));
vi.mock("@/electron-main/lib/electron-logger", () => ({
  logger: { error: vi.fn() },
}));

const { collapseEvent } = await import("./exception-store");

const CONTEXTS = {
  app: {
    channel: "latest",
    flavor: "release",
    packaged: true,
    version: "2.0.0",
  },
  culture: { locale: "en-US", timeZone: "UTC" },
  os: { arch: "arm64", platform: "darwin", version: "26.1" },
  process: { rssMb: 400, uptimeMs: 1000 },
  runtime: { chrome: "1", electron: "1", node: "1" },
};

const event = (message: string, now: number, fn = "run") => {
  const error = new Error(message);
  error.stack = `Error: ${message}\n    at ${fn} (/app/out/main/index.js:1:1)`;
  return buildExceptionEvent(error, {
    breadcrumbs: [],
    contexts: CONTEXTS,
    defaultArea: "studio",
    now,
    paths: { appRoot: "/app" },
  });
};

describe("collapseEvent", () => {
  it("counts a fingerprint again, keeping the latest event and its first time", () => {
    const first = event("one", 1_000);
    const second = event("two", 2_000);
    const collapsed = collapseEvent(collapseEvent([], first), second);

    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]).toMatchObject({
      count: 2,
      exceptions: [{ value: "two" }],
      firstAt: 1_000,
      id: second.id,
      lastAt: 2_000,
    });
  });

  it("keeps distinct problems apart, the most recently seen last", () => {
    const a = event("a", 1_000, "readChat");
    const b = event("b", 2_000, "writeChat");
    const again = event("a again", 3_000, "readChat");
    const none: ExceptionEvent[] = [];
    const collapsed = [a, b, again].reduce(
      (events, next) => collapseEvent(events, next),
      none,
    );

    expect(
      collapsed.map((stored) => [stored.exceptions[0]?.value, stored.count]),
    ).toEqual([
      ["b", 1],
      ["a again", 2],
    ]);
  });

  it("drops the least recently seen past its limit", () => {
    const events = ["f1", "f2", "f3"].reduce(
      (kept, fn, index) => collapseEvent(kept, event(fn, index, fn), 2),
      collapseEvent([], event("f0", 0, "f0"), 2),
    );
    expect(events.map((stored) => stored.exceptions[0]?.value)).toEqual([
      "f2",
      "f3",
    ]);
  });
});
