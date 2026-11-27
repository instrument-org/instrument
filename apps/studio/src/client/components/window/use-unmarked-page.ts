import { rpcClient } from "@/client/rpc/client";
import { useEffect, useEffectEvent, useState } from "react";

/**
 * Whether a page a link from outside named while nothing was there may be
 * drawn: only once the file there is found to carry no downloaded mark, as a
 * link to a page already there is judged (`isFromInternet`), since a page a
 * site drops at the path later must never run from the link. Asked whenever
 * `page` or `look` changes (the file looked for again: it went, came back,
 * Try Again), and false from that change until the answer comes. A marked
 * page goes to `onMarked`; one not there yet stays undrawn until the next
 * look. `page` is undefined for a file that needs no asking.
 */
export function useUnmarkedPage({
  look,
  onMarked,
  page,
}: {
  look: string;
  onMarked: (page: string) => void;
  page: string | undefined;
}): boolean {
  const [unmarked, setUnmarked] = useState<string>();
  const [asked, setAsked] = useState({ look, page });
  if (asked.look !== look || asked.page !== page) {
    setAsked({ look, page });
    setUnmarked(undefined);
  }
  const marked = useEffectEvent(onMarked);
  useEffect(() => {
    if (page === undefined) {
      return;
    }
    let isStale = false;
    void rpcClient.files.downloadMark
      .call({ path: page })
      // An answer that never came is taken as marked: a page is never drawn
      // on a guess.
      .catch(() => ({ mark: "marked" }))
      .then(({ mark }) => {
        if (isStale) {
          return;
        }
        if (mark === "marked") {
          marked(page);
        } else if (mark === "unmarked") {
          setUnmarked(page);
        }
      });
    return () => {
      isStale = true;
    };
    // Asked again at each look, though the look itself says nothing.
  }, [page, look]);
  return page !== undefined && unmarked === page;
}
