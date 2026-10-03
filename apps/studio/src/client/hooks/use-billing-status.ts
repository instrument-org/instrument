import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

/**
 * The signed-in user's plan, trial, and usage windows, read again whenever
 * the window regains focus: a checkout or portal visit in the browser is the
 * usual reason it changed.
 */
export function useBillingStatus() {
  const { refetch, ...rest } = useQuery(
    rpcClient.billing.status.queryOptions(),
  );
  const { data: windowFocusChanged } = useQuery(
    rpcClient.utils.events.windowFocusChanged.experimental_liveOptions(),
  );

  useEffect(() => {
    void refetch();
  }, [windowFocusChanged, refetch]);

  return { ...rest, refetch };
}
