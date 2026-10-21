/**
 * How many dictations are recording right now, in any window. Each one holds
 * `dictation.recording` open for as long as it records, and a window that
 * goes away (closed, reloaded, crashed) drops its call with it, so a count
 * can never outlive its recording and leave a stale prompt behind.
 */
let recording = 0;

/** Counts one recording until `signal` aborts. */
export async function holdDictation(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    return;
  }
  recording += 1;
  try {
    await new Promise<void>((resolve) => {
      signal?.addEventListener(
        "abort",
        () => {
          resolve();
        },
        { once: true },
      );
    });
  } finally {
    recording -= 1;
  }
}

/** Whether someone is dictating, which quitting would throw away. */
export function isDictationInProgress() {
  return recording > 0;
}
