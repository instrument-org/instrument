/**
 * What a guest's history comes back as in another window: the page it stood
 * on and the pages behind it, without the blank page every guest starts on.
 * A new guest can only be given its stack before its first load, and that load
 * lands on top of the stack and takes the place of any pages ahead, so those
 * are not kept. None for a guest that has been nowhere.
 */
export function historyToRestore<Entry extends { url: string }>(
  entries: readonly Entry[],
  index: number,
): { behind: Entry[]; url: string } | null {
  const url = entries[index]?.url;
  if (url === undefined || url === "about:blank") {
    return null;
  }
  return {
    behind: entries
      .slice(0, index)
      .filter((entry) => entry.url !== "about:blank"),
    url,
  };
}
