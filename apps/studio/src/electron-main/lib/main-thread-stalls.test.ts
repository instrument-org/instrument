import { afterEach, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  powerMonitor: { on: vi.fn() },
}));
const warn = vi.fn();
vi.mock("./electron-logger", () => ({
  createScopedLogger: () => ({ warn }),
}));

const { describeStall, trackRPCForStalls, watchMainThreadStalls } =
  await import("./main-thread-stalls");

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  warn.mockClear();
});

it.each([
  [[], [], "outside RPC"],
  [["utils.prepareDrag"], [], "during utils.prepareDrag"],
  [
    ["utils.prepareDrag"],
    ["billing.status", "utils.prepareDrag"],
    "during utils.prepareDrag (in flight: billing.status)",
  ],
  [
    [],
    ["billing.status", "billing.status"],
    "outside RPC (in flight: billing.status)",
  ],
])("describes ran %j with %j in flight", (ran, inFlight, expected) => {
  expect(describeStall(new Set(ran), inFlight)).toBe(expected);
});

it("names a call that ran during a stall, and one only waiting across it apart", async () => {
  vi.useFakeTimers();
  let lag = 0;
  vi.spyOn(performance, "now").mockImplementation(() => Date.now() + lag);
  watchMainThreadStalls();

  // A request waiting on the network for the whole stretch.
  void trackRPCForStalls({
    next: () => new Promise(() => {}),
    path: ["billing", "status"],
  });
  vi.advanceTimersByTime(200);

  // A handler that runs and settles, then the thread stalls.
  await trackRPCForStalls({
    next: () => Promise.resolve(),
    path: ["utils", "prepareDrag"],
  });
  lag = 600;
  vi.advanceTimersByTime(100);

  // A later stall with nothing running.
  lag = 1200;
  vi.advanceTimersByTime(100);

  expect(warn.mock.calls).toMatchInlineSnapshot(`
    [
      [
        "Main thread stalled for 600ms",
        "during utils.prepareDrag (in flight: billing.status)",
      ],
      [
        "Main thread stalled for 600ms",
        "outside RPC (in flight: billing.status)",
      ],
    ]
  `);
});
