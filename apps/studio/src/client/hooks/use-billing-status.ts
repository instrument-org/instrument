import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

const FRESH_MS = 15_000;

/**
 * The signed-in user's plan, trial, and usage windows, read again whenever
 * the window regains focus: a checkout or portal visit in the browser is the
 * usual reason it changed. Nothing is asked while signed out, since only an
 * account has a plan. `pollMs` reads it on a timer as well, for a screen
 * waiting on Stripe while the person may not have left the window.
 *
 * The API answers only a few status reads a minute per person, and several
 * screens read it at once, so a read a moment old is reused when another
 * screen mounts, and a focus change makes one read however many screens ask.
 */
export function useBillingStatus({ pollMs }: { pollMs?: number } = {}) {
  const { data: hasToken } = useQuery(
    rpcClient.auth.live.hasToken.experimental_liveOptions(),
  );
  const isSignedIn = hasToken === true;
  const { refetch, ...rest } = useQuery(
    rpcClient.billing.status.queryOptions({
      enabled: isSignedIn,
      refetchInterval: pollMs ?? false,
      refetchOnWindowFocus: false,
      staleTime: FRESH_MS,
    }),
  );
  const { data: windowFocusChanged } = useQuery(
    rpcClient.utils.events.windowFocusChanged.experimental_liveOptions(),
  );

  // Only a focus change after mounting reads again; the query's own
  // staleness covers the mount. A read already on its way is joined rather
  // than restarted, so every screen asking at once makes one request.
  const seenFocus = useRef(windowFocusChanged);
  useEffect(() => {
    if (seenFocus.current === windowFocusChanged) {
      return;
    }
    seenFocus.current = windowFocusChanged;
    if (isSignedIn) {
      void refetch({ cancelRefetch: false });
    }
  }, [windowFocusChanged, isSignedIn, refetch]);

  // Known to be signed out, rather than not yet known either way.
  const isSignedOut = hasToken === false;
  return { ...rest, isSignedIn, isSignedOut, refetch };
}
