import { logger } from "@/electron-main/lib/electron-logger";

const scopedLogger = logger.scope("boot");

// Boot is a fixed sequence of steps on the main thread, and a slow one there
// freezes the window rather than merely delaying it: the main process owns the
// native message loop, so Windows paints "Not Responding" over an app that is
// still starting. Timing each step is what turns "it hung on launch" in a
// support report into a named step in the log.
export async function timeBootStep<T>(
  name: string,
  run: () => Promise<T> | T,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await run();
  } finally {
    scopedLogger.info(
      `${name}: ${Math.round(performance.now() - startedAt)}ms`,
    );
  }
}
