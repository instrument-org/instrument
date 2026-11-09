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
  } catch (error) {
    // The step's name rides on the failure, so whatever reports the rejection
    // can say which step ended the boot, not just that one did.
    throw new Error(`Boot failed during ${name}`, { cause: error });
  } finally {
    scopedLogger.info(
      `${name}: ${Math.round(performance.now() - startedAt)}ms`,
    );
  }
}

/**
 * A synchronous step, timed as `timeBootStep` times one, without the await
 * that would let other work run between it and the next step.
 */
export function timeBootStepSync<T>(name: string, run: () => T): T {
  const startedAt = performance.now();
  try {
    return run();
  } catch (error) {
    throw new Error(`Boot failed during ${name}`, { cause: error });
  } finally {
    scopedLogger.info(
      `${name}: ${Math.round(performance.now() - startedAt)}ms`,
    );
  }
}

/**
 * A point the launch reached, in ms since the process started, which also
 * counts what no step times: Electron's own start and loading the main
 * bundle before the first step, and the gaps between steps.
 */
export function logBootMark(name: string): void {
  scopedLogger.info(`${name} at ${Math.round(performance.now())}ms`);
}
