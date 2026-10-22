import { powerMonitor } from "electron";

import { getDevLogFilePath } from "../dev-file-logger";
import { createScopedLogger, getMainLogFilePath } from "../electron-logger";
import createSamplerWorker from "./worker?nodeWorker";
import {
  BEAT_MS,
  HEARTBEAT_SLOT,
  HEARTBEAT_SLOTS,
  type StallLogTarget,
  SUSPENDED_SLOT,
} from "./watch";

const log = createScopedLogger("stallSampler");

/**
 * Starts the stall sampler: a worker thread that watches a heartbeat main
 * bumps every {@link BEAT_MS} and logs, while main is still stalled, that it
 * has gone a second or more without answering. Main's own stall timer
 * (`main-thread-stalls.ts`) reports a stall only once it is over, so a hang
 * that never ends, or ends in a kill, is what this one is for.
 *
 * It writes to the log that is being kept: the dev log in development, and
 * `main.log` in a build, which is what Settings offers to send. On unless
 * `INSTRUMENT_STALL_SAMPLER=0`: it costs one idle thread and a timer.
 */
export function startStallSampler() {
  if (process.env.INSTRUMENT_STALL_SAMPLER === "0") {
    return;
  }
  const buffer = new SharedArrayBuffer(
    HEARTBEAT_SLOTS * Int32Array.BYTES_PER_ELEMENT,
  );
  const heartbeat = new Int32Array(buffer);

  const devLog = getDevLogFilePath();
  const target: StallLogTarget | undefined =
    process.env.NODE_ENV === "development"
      ? devLog === undefined
        ? undefined
        : { format: "jsonl", path: devLog }
      : { format: "text", path: getMainLogFilePath() };

  try {
    const worker = createSamplerWorker({ workerData: { buffer, target } });
    worker.unref();
    worker.on("error", (error) => {
      log.warn("The stall sampler stopped", error);
    });
  } catch (error) {
    log.warn("Could not start the stall sampler", error);
    return;
  }

  const beat = setInterval(() => {
    Atomics.add(heartbeat, HEARTBEAT_SLOT, 1);
  }, BEAT_MS);
  beat.unref();

  // A sleeping computer is not a stall.
  powerMonitor.on("suspend", () => {
    Atomics.store(heartbeat, SUSPENDED_SLOT, 1);
  });
  powerMonitor.on("resume", () => {
    Atomics.add(heartbeat, HEARTBEAT_SLOT, 1);
    Atomics.store(heartbeat, SUSPENDED_SLOT, 0);
  });
}
