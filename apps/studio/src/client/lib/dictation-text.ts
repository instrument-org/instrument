/** A recording's length as `m:ss`. */
export function formatDictationClock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Puts dictated words at the end of what is already written, on a line of
 * their own when there is something there. Nothing already written is
 * replaced: only trailing spaces on the last line give way, and a box that
 * already ends on a fresh line is written on rather than given another.
 */
export function appendDictatedText(existing: string, dictated: string): string {
  const words = dictated.trim();
  if (!words) {
    return existing;
  }
  const base = existing.replace(/[ \t]+$/, "");
  if (!base.trim()) {
    return words;
  }
  return base.endsWith("\n") ? base + words : `${base}\n${words}`;
}
