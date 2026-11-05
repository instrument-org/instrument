import { SkeletonText } from "@/client/components/ui/skeleton";
import { instrumentWayCopy } from "@/client/lib/connect-copy";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode } from "react";

/**
 * How the Instrument way in reads on every surface that offers it, from the
 * server's trial offer. While the offer is unknown the words are placeholders
 * as wide as the trial's, since the words for no trial would be read as the
 * answer and then change. Only the words wait: everything around them works
 * in the meantime, signing in included, which doesn't need the offer.
 *
 * The wait ends with the first failed attempt rather than the last retry, or
 * when the offer can't be asked for while offline, on the words for no trial.
 * An answer that comes later still replaces them. Each new reader of an offer
 * that failed waits again, so a server back since never shows the wrong words.
 */
export function useInstrumentWay({
  enabled = true,
}: { enabled?: boolean } = {}): {
  action: ReactNode;
  isTrial: boolean;
  isWaiting: boolean;
  line: ReactNode;
  title: ReactNode;
  trialDays: number | undefined;
} {
  const {
    data: offer,
    failureCount,
    fetchStatus,
  } = useQuery({ ...rpcClient.billing.offer.queryOptions(), enabled });
  const isWaiting =
    offer === undefined && fetchStatus === "fetching" && failureCount === 0;
  const copy = instrumentWayCopy(offer);
  return {
    action: isWaiting ? (
      <SkeletonText>Start free trial</SkeletonText>
    ) : (
      copy.action
    ),
    isTrial: copy.isTrial,
    isWaiting,
    line: isWaiting ? (
      <SkeletonText>Sign in with Google for 7 days free.</SkeletonText>
    ) : (
      copy.line
    ),
    title: isWaiting ? (
      <SkeletonText>{`Try ${APP_NAME} free`}</SkeletonText>
    ) : (
      copy.title
    ),
    trialDays: copy.isTrial ? offer?.trial?.days : undefined,
  };
}

export type InstrumentWay = ReturnType<typeof useInstrumentWay>;
