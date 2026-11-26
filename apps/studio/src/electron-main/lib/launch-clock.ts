// What the launch's first moments looked like, read before the logger is up:
// `boot.ts` imports this first, so its evaluation stamps when the main
// process's entry began.

/** When the main process's entry began, in ms since the process started. */
export const mainEnteredAt = performance.now();

/** When Electron was ready, in ms since the process started. */
export let readyAt: number | undefined;

/** Called once, as `ready` fires. */
export function noteReady() {
  readyAt ??= performance.now();
}
