import { instrumentWayCopy } from "@/client/lib/connect-copy";
import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";

/**
 * How the Instrument way in reads on every surface that offers it, from the
 * server's trial offer, or the copy of it this build shipped with until the
 * server answers (`offer-from-build.ts`).
 */
export function useInstrumentWay({
  enabled = true,
}: { enabled?: boolean } = {}) {
  const { data: offer } = useQuery({
    ...rpcClient.billing.offer.queryOptions(),
    enabled,
  });
  const copy = instrumentWayCopy(offer);
  return {
    ...copy,
    trialDays: copy.isTrial ? offer?.trial?.days : undefined,
  };
}

export type InstrumentWay = ReturnType<typeof useInstrumentWay>;
