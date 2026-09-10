/**
 * The most of a task's last words that travel in the note that wakes its
 * orchestrator. Its own module, importing nothing, so the prompts that tell
 * either side about the cut (the task's `who_reads_you`, the orchestrator's
 * briefing rules, the `task` command's help) interpolate the number the wake
 * applies rather than a copy of it.
 */
export const WAKE_SUMMARY_MAX_LENGTH = 400;
