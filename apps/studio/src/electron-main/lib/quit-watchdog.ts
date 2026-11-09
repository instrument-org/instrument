import { Worker } from "node:worker_threads";

/**
 * Ends this process `ms` from now, from a thread of its own. A quit's own
 * deadline is a timer on the main thread, so a main thread stuck in a loop or
 * a native call never reaches it, and the app stays running with no window;
 * this one fires whatever the main thread is doing. Unref'd, so a quit that
 * finishes in time exits as it would without it.
 */
export function armQuitWatchdog(ms: number): void {
  const worker = new Worker(
    `setTimeout(() => process.kill(${process.pid}, "SIGKILL"), ${ms});`,
    { eval: true },
  );
  worker.unref();
}
