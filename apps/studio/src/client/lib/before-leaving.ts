/**
 * What a window has put off that has to reach main before the window goes:
 * a deletion held back while its toast offers Undo, typing waiting to be
 * written into its draft.
 *
 * Each job runs once, whichever comes first: its own time, or the window
 * going. A reload or a closed window runs them all on `beforeunload`, where
 * what each sends to main is on its way before the page is torn down. A quit
 * never unloads the page (it ends in `app.exit`), so main asks every window
 * first and waits until each has answered that its jobs have settled
 * (`electron-main/windows/finish-before-leaving.ts`).
 */

type Job = () => unknown;

const jobs = new Set<Job>();

/**
 * Runs `job` when the window goes, unless the returned function is called
 * first, which is how a job that ran on its own time or was taken back
 * leaves.
 */
export function finishBeforeLeaving(job: Job): () => void {
  jobs.add(job);
  return () => {
    jobs.delete(job);
  };
}

/** Runs every job still waiting, and settles once every one has. */
export async function finishAllBeforeLeaving(): Promise<void> {
  const running = [...jobs];
  jobs.clear();
  await Promise.allSettled(running.map(async (job) => job()));
}

/** Runs the jobs when the window unloads, and when main asks before a quit. Once per window. */
export function initBeforeLeaving() {
  window.addEventListener("beforeunload", () => {
    void finishAllBeforeLeaving();
  });
  window.api.onLeaving?.(finishAllBeforeLeaving);
}
