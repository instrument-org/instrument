/**
 * The most of a task's last words that travel in the note that wakes its
 * orchestrator. A ceiling rather than a budget: a task is told to end with a
 * receipt, and the longest one seen in real use is about half of this, so the
 * cut is for a task that pasted a report into its reply and nothing else. When
 * it cuts, the note says so where the text stops, so the orchestrator knows to
 * read the transcript rather than taking a truncated sentence for the whole.
 */
export const WAKE_SUMMARY_MAX_LENGTH = 4000;
