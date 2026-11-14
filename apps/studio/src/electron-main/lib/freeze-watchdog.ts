import { alarms } from "@instrument-org/shared/alarms";
import { app } from "electron";
import path from "node:path";

import createFreezeWorker from "./freeze-watchdog-worker?nodeWorker";
import { createScopedLogger, getLogFileForWorkers } from "./electron-logger";
import {
  describeFreeze,
  FREEZE_MARKER_FILE,
  type FreezeRecovered,
  type FreezeWatchdogData,
} from "./main-thread-freezes";

const log = createScopedLogger("mainThread");

/**
 * Starts the worker that notices a frozen main thread (`main-thread-freezes.ts`)
 * and gives back the heartbeat it watches, for a timer on the main thread to
 * call. The worker is unref'd, so it never keeps the app from exiting.
 *
 * A freeze that ends is logged once more from here, through the alarms gate,
 * with how long it lasted; its start was logged by the worker.
 */
export function startFreezeWatchdog(): { beat: () => void } {
  const buffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const beats = new Int32Array(buffer);
  try {
    const worker = createFreezeWorker({
      name: "freeze-watchdog",
      workerData: {
        beats: buffer,
        logFile: getLogFileForWorkers(),
        markerPath: path.join(app.getPath("userData"), FREEZE_MARKER_FILE),
        pid: process.pid,
        version: app.getVersion(),
      } satisfies FreezeWatchdogData,
    });
    worker.unref();
    worker.on("message", (message: FreezeRecovered) => {
      alarms.raise(
        "main-thread-freeze",
        () =>
          `Main thread came back from a freeze of ${describeFreeze(message.recovered)}`,
        (line) => {
          log.warn(line);
        },
      );
    });
    worker.on("error", (error) => {
      log.warn(new Error("The freeze watchdog stopped", { cause: error }));
    });
  } catch (error) {
    log.warn(
      new Error("Could not start the freeze watchdog", { cause: error }),
    );
  }
  return {
    beat: () => {
      Atomics.add(beats, 0, 1);
    },
  };
}
