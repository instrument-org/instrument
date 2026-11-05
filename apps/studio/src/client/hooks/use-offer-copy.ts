import { offerCopy } from "@/client/lib/connect-copy";
import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";

/**
 * What Instrument's own row says on every surface that offers it, from the
 * server's offer, or the snapshot this build shipped with until the server
 * answers (`billing-offer-snapshot.ts`).
 */
export function useOfferCopy({ enabled = true }: { enabled?: boolean } = {}) {
  const { data: offer } = useQuery({
    ...rpcClient.billing.offer.queryOptions(),
    enabled,
  });
  const copy = offerCopy(offer);
  return {
    ...copy,
    trialDays: copy.isTrial ? offer?.trial?.days : undefined,
  };
}

export type OfferCopy = ReturnType<typeof useOfferCopy>;
