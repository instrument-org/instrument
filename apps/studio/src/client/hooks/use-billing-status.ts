import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

/**
 * The signed-in user's plan, trial, and usage windows, read again whenever
 * the window regains focus: a checkout or portal visit in the browser is the
 * usual reason it changed. Nothing is asked while signed out, since only an
 * account has a plan. `pollMs` reads it on a timer as well, for a screen
 * waiting on Stripe while the person may not have left the window.
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
    }),
  );
  const { data: windowFocusChanged } = useQuery(
    rpcClient.utils.events.windowFocusChanged.experimental_liveOptions(),
  );

  useEffect(() => {
    if (isSignedIn) {
      void refetch();
    }
  }, [windowFocusChanged, isSignedIn, refetch]);

  return { ...rest, isSignedIn, refetch };
}
