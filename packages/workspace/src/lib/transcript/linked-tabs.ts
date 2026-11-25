import { type TranscriptMessage } from "./transcript-message";

/** The web page a linked tab was on when its reply's turn ended. */
export interface LinkedTab {
  title?: string;
  url: string;
}

/** The pages of the tabs these replies linked, by tab id, the latest reply's winning. */
export function linkedTabsOf(
  replies: readonly TranscriptMessage[],
): ReadonlyMap<string, LinkedTab> | undefined {
  const found = new Map<string, LinkedTab>();
  for (const { parts } of replies) {
    for (const part of parts) {
      if (part.type === "data-linkedTabs") {
        for (const { id, ...page } of part.data.tabs) {
          found.set(id, page);
        }
      }
    }
  }
  return found.size === 0 ? undefined : found;
}
