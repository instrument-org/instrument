import { createAlarmGate } from "@instrument-org/shared/alarms";
import { browserTargetOf, StoreId } from "@instrument-org/workspace/electron";
import { expect, it, vi } from "vitest";

import { createPutAwaySound, STRAY_SOUND_CHECK_MS } from "./put-away-sound";

const page = browserTargetOf(
  StoreId.TabSchema.parse("tab_01M3G55N35541T2M6SWPS72GMF"),
);

function setup({
  audible = true,
  closes = true,
  putAway = true,
}: { audible?: boolean; closes?: boolean; putAway?: boolean } = {}) {
  const state = { audible, putAway };
  const timers: { ms: number; run: () => void }[] = [];
  const close = vi.fn(() => {
    if (closes) {
      state.putAway = false;
      state.audible = false;
    }
  });
  const info = vi.fn<(line: string) => void>();
  const warn = vi.fn<(line: string) => void>();
  const check = createPutAwaySound({
    close,
    describe: () => "www.apple.com",
    gate: createAlarmGate(),
    info,
    isAudible: () => state.audible,
    isPutAway: () => state.putAway,
    later: (run, ms) => {
      timers.push({ ms, run });
    },
    warn,
  });
  const runTimers = () => {
    for (const timer of timers.splice(0)) {
      timer.run();
    }
  };
  return { check, close, info, runTimers, timers, warn };
}

it("closes a put-away page that makes sound and says so", () => {
  const { check, close, info, runTimers, timers, warn } = setup();
  check(page);
  expect(close).toHaveBeenCalledExactlyOnceWith(page);
  expect(info.mock.calls).toMatchInlineSnapshot(`
    [
      [
        "Closed a page a tab stepped away from, as it was playing sound (www.apple.com)",
      ],
    ]
  `);
  expect(timers.map((timer) => timer.ms)).toEqual([STRAY_SOUND_CHECK_MS]);
  runTimers();
  expect(warn).not.toHaveBeenCalled();
});

it.each([
  ["a silent put-away page", { audible: false }],
  ["a page its tab shows", { putAway: false }],
])("leaves %s alone", (_, options) => {
  const { check, close, timers } = setup(options);
  check(page);
  expect(close).not.toHaveBeenCalled();
  expect(timers).toEqual([]);
});

it("raises the alarm when a closed page still plays", () => {
  const { check, runTimers, warn } = setup({ closes: false });
  check(page);
  runTimers();
  expect(warn.mock.calls).toMatchInlineSnapshot(`
    [
      [
        "Stray sound: a page a tab stepped away from still plays 10s after it was closed (www.apple.com)",
      ],
    ]
  `);
});
