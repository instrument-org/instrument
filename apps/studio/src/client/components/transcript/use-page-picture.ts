import { useGuest } from "@/client/hooks/use-browser-targets";
import { useTargetAgentLastAt } from "@/client/hooks/use-target-agent-activity";
import { getGuest } from "@/client/lib/browser-pool";
import { rpcClient } from "@/client/rpc/client";
import { type BrowserTargetId } from "@instrument-org/workspace/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef } from "react";

import { thumbnailKey } from "../window/use-page-thumbnail-housekeeping";

/** How long after a page loads, moves, or renames itself its picture is taken. */
const CHANGE_SETTLE_MS = 500;

/**
 * How long after an agent's last command in a page its picture is taken: one
 * command of the agent's arrives as a burst, and the page redraws after.
 */
const AGENT_SETTLE_MS = 1000;

/** How long after a picture that could not be taken, while none is shown, it is asked for again. */
const RETRY_MS = 2000;

/** How many pictures in a row may fail, while none is shown, before the next change is waited for. */
const RETRIES = 3;

type Picture = { url: null | string };

/**
 * A picture of the page, taken once its guest is ready, again shortly after
 * it loads, moves or renames itself and after each agent command in it, and
 * again a few times while none could be taken yet. A capture that finishes is
 * shown unless a newer one already is, so a newer capture that fails never
 * hides an older one that worked.
 */
export function usePagePicture(
  key: string,
  targetId: BrowserTargetId,
): string | undefined {
  const queryClient = useQueryClient();
  const queryKey = thumbnailKey(key);
  const picture = useQuery({
    queryFn: async (): Promise<Picture> => {
      const kept = await rpcClient.browser.thumbnails.get.call({ key });
      // A picture taken while the kept one was being read is the newer.
      const taken = queryClient.getQueryData<Picture>(queryKey);
      return taken?.url ? taken : kept;
    },
    queryKey,
    staleTime: Infinity,
  });
  const guest = useGuest(targetId);
  const asked = useRef(0);
  const shown = useRef(0);
  const misses = useRef(0);
  const retry = useRef<ReturnType<typeof setTimeout>>(undefined);
  const capture = useRef(() => {});
  useLayoutEffect(() => {
    capture.current = () => {
      clearTimeout(retry.current);
      // A guest not ready yet has nothing drawn to take; its arrival asks again.
      const webContentsId = getGuest(targetId)?.webContentsId;
      if (webContentsId === undefined) {
        return;
      }
      asked.current += 1;
      const mine = asked.current;
      const missed = () => {
        misses.current += 1;
        if (
          misses.current <= RETRIES &&
          !queryClient.getQueryData<Picture>(queryKey)?.url
        ) {
          retry.current = setTimeout(() => {
            capture.current();
          }, RETRY_MS);
        }
      };
      void rpcClient.browser.thumbnails.capture
        .call({ key, webContentsId })
        .then((result) => {
          if (!result.url) {
            missed();
            return;
          }
          misses.current = 0;
          if (mine > shown.current) {
            shown.current = mine;
            queryClient.setQueryData(queryKey, result);
          }
        })
        .catch(missed);
    };
  });
  useEffect(
    () => () => {
      clearTimeout(retry.current);
    },
    [],
  );
  useEffect(() => {
    if (!guest) {
      return;
    }
    let pending: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(pending);
      pending = setTimeout(() => {
        capture.current();
      }, CHANGE_SETTLE_MS);
    };
    const stops = (
      [
        "did-stop-loading",
        "did-navigate",
        "did-navigate-in-page",
        "page-title-updated",
      ] as const
    ).map((event) => guest.on(event, soon));
    // The page as it stands when its guest is ready, before anything changes it.
    soon();
    return () => {
      for (const stop of stops) {
        stop();
      }
      clearTimeout(pending);
    };
  }, [guest]);
  const agentAt = useTargetAgentLastAt(targetId);
  useEffect(() => {
    if (agentAt === undefined) {
      return;
    }
    const pending = setTimeout(() => {
      capture.current();
    }, AGENT_SETTLE_MS);
    return () => {
      clearTimeout(pending);
    };
  }, [agentAt]);
  return picture.data?.url ?? undefined;
}
