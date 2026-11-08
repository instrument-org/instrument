import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { rpcClient } from "@/client/rpc/client";
import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";

/**
 * The person's own pages in the window's browser, newest first, kept current
 * as the main process records them. Hidden pages (redirect hops, error
 * pages, the app's sign-in flow) and the pages agents visited are never in
 * it.
 *
 * `limit` is how many the caller shows, absent for a list it filters down
 * from. Read only while `enabled` and in the tab up, and the last answer
 * stands meanwhile.
 */
export function useRecentPages({
  enabled = true,
  limit,
}: { enabled?: boolean; limit?: number } = {}) {
  const isActiveTab = useIsActiveTab();
  const recent = useQuery(
    rpcClient.history.live.recent.experimental_liveOptions({
      // A key of its own rather than `enabled`, which would leave the read
      // running under an observer that only stopped looking at it.
      input: enabled && isActiveTab ? { limit } : skipToken,
      placeholderData: keepPreviousData,
    }),
  );
  return recent.data ?? [];
}

/** Start-page selections, re-read when the tab becomes active or bookmarks change. */
export function useBrowserStartPages(excludedUrls: string[]) {
  const isActiveTab = useIsActiveTab();
  const pages = useQuery(
    rpcClient.history.live.startPages.experimental_liveOptions({
      input: isActiveTab ? { excludedUrls } : skipToken,
    }),
  );
  return pages.data ?? { frequent: [], recent: [] };
}

/** A page as history lists it. */
export type HistoryPage = ReturnType<typeof useRecentPages>[number];

/**
 * The pages the address field may complete to: Chromium's significant ones,
 * newest first. Read only while `enabled`, and the last answer stands
 * meanwhile.
 */
export function useCompletionPages({
  enabled,
}: {
  enabled: boolean;
}): HistoryPage[] {
  const completions = useQuery(
    rpcClient.history.live.completions.experimental_liveOptions({
      input: enabled ? {} : skipToken,
      placeholderData: keepPreviousData,
    }),
  );
  return completions.data ?? [];
}

/**
 * Tells history the person is opening a page by its address, typed or from
 * a bookmark, which counts toward the page's place in the address field's
 * completions. Said before the page loads.
 */
export function noteTypedPage(url: string) {
  void rpcClient.history.noteTypedPage.call({ url }).catch(() => null);
}

/** Takes a page off the person's history. */
export function removeFromHistory(url: string) {
  void rpcClient.history.remove.call({ url }).catch(() => null);
}
