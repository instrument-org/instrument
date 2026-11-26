import { measureHoldsWith } from "@instrument-org/shared/process-holds";
import { afterEach, expect, it, vi } from "vitest";

const warn = vi.fn();
vi.mock("./electron-logger", () => ({
  createScopedLogger: () => ({ warn }),
}));

const { describeStall, trackRPCForStalls, watchMainThreadStalls } =
  await import("./main-thread-stalls");

afterEach(() => {
  measureHoldsWith(() => 0);
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
  const onTick = vi.fn();
  watchMainThreadStalls({ onTick });

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

  // Every tick beats for the freeze watchdog, the late ones too.
  expect(onTick).toHaveBeenCalledTimes(4);
  // Judged once the watchdog has had time to count a hold.
  expect(warn).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1_500);
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

it("leaves out the time the whole process was held, each hold once", () => {
  vi.useFakeTimers();
  let lag = 0;
  let held = 0;
  measureHoldsWith(() => held);
  vi.spyOn(performance, "now").mockImplementation(() => Date.now() + lag);
  watchMainThreadStalls({ onTick: () => {} });
  vi.advanceTimersByTime(200);

  // A dark wake ten minutes on: main's tick runs before the watchdog has
  // counted the hold, which it does with up to a second more than main saw.
  lag = 600_000;
  vi.advanceTimersByTime(100);
  held = 600_900;
  // Main then works for three seconds before its next tick.
  lag += 3_000;
  vi.advanceTimersByTime(100);
  vi.advanceTimersByTime(1_500);

  // A sleep alone, counted before main's tick this time.
  held += 300_400;
  lag += 300_000;
  vi.advanceTimersByTime(100);
  vi.advanceTimersByTime(1_500);

  // The work, less the 900 ms the watchdog counted past main's lateness.
  expect(warn.mock.calls).toMatchInlineSnapshot(`
    [
      [
        "Main thread stalled for 2100ms",
        "outside RPC (in flight: billing.status)",
      ],
    ]
  `);
});
