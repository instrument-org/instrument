import fs from "node:fs";
import path from "node:path";
import { workerData } from "node:worker_threads";

import {
  BEAT_MS,
  createStallWatch,
  formatStallLine,
  HEARTBEAT_SLOT,
  type StallLogTarget,
  SUSPENDED_SLOT,
} from "./watch";

// The sampler's thread. It reads the heartbeat main bumps and, when main goes
// quiet, writes the line itself: main's logger is on the thread that stalled,
// and a hang that never ends would otherwise leave nothing at all.

// `as`: workerData is untyped; `index.ts` is its one sender.
const { buffer, target } = workerData as {
  buffer: SharedArrayBuffer;
  target: StallLogTarget | undefined;
};
const heartbeat = new Int32Array(buffer);
const watch = createStallWatch(performance.now());

setInterval(() => {
  const silent = watch.sample({
    beat: Atomics.load(heartbeat, HEARTBEAT_SLOT),
    now: performance.now(),
    suspended: Atomics.load(heartbeat, SUSPENDED_SLOT) === 1,
  });
  if (silent === undefined || !target) {
    return;
  }
  const line = formatStallLine({
    format: target.format,
    message: `Main thread has not answered for ${silent}ms and is still stalled`,
    time: new Date(),
  });
  try {
    fs.mkdirSync(path.dirname(target.path), { recursive: true });
    // Appended by path, one write per line: the dev log's stream and
    // electron-log's file transport append to the same file, and a rotation
    // moves it under them.
    fs.appendFileSync(target.path, line);
  } catch {
    // A log that cannot be written loses this line, and nothing else.
  }
}, BEAT_MS);
