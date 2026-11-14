import { parentPort, workerData } from "node:worker_threads";

import {
  type FreezeWatchdogData,
  runFreezeWatchdog,
} from "./main-thread-freezes";

// The worker `startFreezeWatchdog` starts. `workerData` is what that call
// built, typed there.
runFreezeWatchdog(workerData as FreezeWatchdogData, (message) => {
  parentPort?.postMessage(message);
});
