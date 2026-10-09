import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";

/**
 * The person's own pages in the window's browser, newest first, kept current
 * as the main process records them. Hidden pages (redirect hops, error
 * pages, the app's sign-in flow) and the pages agents visited are never in
 * it.
 */
export function useRecentPages() {
  const recent = useQuery(
    rpcClient.history.live.recent.experimental_liveOptions({ input: {} }),
  );
  return recent.data ?? [];
}

/** A page as history lists it. */
export type HistoryPage = ReturnType<typeof useRecentPages>[number];

/** The pages the address field may complete to: Chromium's significant ones, newest first. */
export function useCompletionPages(): HistoryPage[] {
  const completions = useQuery(
    rpcClient.history.live.completions.experimental_liveOptions({ input: {} }),
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
