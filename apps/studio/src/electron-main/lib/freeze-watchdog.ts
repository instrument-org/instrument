import { alarms } from "@instrument-org/shared/alarms";
import { measureHoldsWith } from "@instrument-org/shared/process-holds";
import { app } from "electron";
import path from "node:path";

import createFreezeWorker from "./freeze-watchdog-worker?nodeWorker";
import { diagnosticsDirOf } from "./diagnostics-dir";
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
 * with how long it lasted; its start was logged by the worker. The time the
 * worker finds the whole process held is what `heldMs` reads from then on.
 */
export function startFreezeWatchdog(): { beat: () => void } {
  const buffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const beats = new Int32Array(buffer);
  const heldBuffer = new SharedArrayBuffer(BigInt64Array.BYTES_PER_ELEMENT);
  const held = new BigInt64Array(heldBuffer);
  measureHoldsWith(() => Number(Atomics.load(held, 0)));
  try {
    const worker = createFreezeWorker({
      name: "freeze-watchdog",
      workerData: {
        beats: buffer,
        held: heldBuffer,
        logFile: getLogFileForWorkers(),
        markerPath: path.join(diagnosticsDirOf(app), FREEZE_MARKER_FILE),
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
