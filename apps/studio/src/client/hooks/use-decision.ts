import { rpcClient, type RPCInput, type RPCOutput } from "@/client/rpc/client";
import {
  type QueryKey,
  skipToken,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import ms from "ms";

export type DecisionAsk = Omit<
  RPCInput["workspace"]["decision"]["ask"],
  "usage"
>;
/** Why an ask is made and for what, which the record of model requests files it under. */
export type DecisionUsage = RPCInput["workspace"]["decision"]["ask"]["usage"];
export type DecisionAnswer = RPCOutput["workspace"]["decision"]["ask"];

/**
 * Whether asking the decision model would send anything, as the workspace
 * answers it without a request: false with no Instrument sign-in and no
 * OpenRouter key, and for a minute after asking failed. Undefined until
 * known. Read again after a short while when asked for, since signing in
 * changes it.
 */
export function useDecisionModelAvailable(enabled: boolean) {
  const available = useQuery(
    rpcClient.workspace.decision.available.queryOptions({
      enabled,
      retry: false,
      staleTime: ms("10 seconds"),
    }),
  );
  // A check that fails is no answer to wait on: nothing is asked.
  return available.isError ? false : available.data;
}

/**
 * One question set asked of the decision model, the way every caller in the
 * app asks: sent only once the workspace says the model can answer, each
 * `key` asked once and its answer kept, never retried, and a failure taken
 * as the model being out of reach rather than shown. A caller draws nothing
 * for the model when `available` is false, and shows that it is asking only
 * while `isAsking`, so there is no state that says the model is looking when
 * nothing was sent, and none that names a failure.
 *
 * `ask` is undefined while there is nothing to ask, and a list when one ask
 * is split across requests to stay under the API's cap on questions; their
 * answers come back as one. `checkAvailable` reads
 * whether the model can answer ahead of the first ask (a search box being
 * typed in), so the answer is known before it is needed.
 */
export function useDecision({
  ask,
  checkAvailable = ask !== undefined,
  keepPrevious,
  key,
  usage,
}: {
  ask: DecisionAsk | DecisionAsk[] | undefined;
  checkAvailable?: boolean;
  /**
   * Whether the last answer stands in while the next is asked, given the key
   * it answered; an answer that would read as one about this ask, such as
   * the same words a letter shorter, rather than blanking in between.
   */
  keepPrevious?: (previousKey: QueryKey) => boolean;
  key: QueryKey;
  usage: DecisionUsage;
}) {
  const available = useDecisionModelAvailable(checkAvailable);
  const queryClient = useQueryClient();
  const sending = ask !== undefined && available === true;
  const query = useQuery<DecisionAnswer>({
    placeholderData: keepPrevious
      ? (previous, previousQuery) =>
          previousQuery && keepPrevious(previousQuery.queryKey.slice(1))
            ? previous
            : undefined
      : undefined,
    queryFn: sending
      ? async ({ signal }) => {
          try {
            const asked = await Promise.all(
              [ask]
                .flat()
                .map((one) =>
                  rpcClient.workspace.decision.ask.call(
                    { ...one, usage },
                    { signal },
                  ),
                ),
            );
            const [first, ...rest] = asked;
            if (!first) {
              throw new Error("A decision ask needs at least one request");
            }
            return rest.reduce(
              (merged, next) => ({
                ...merged,
                answers: { ...merged.answers, ...next.answers },
              }),
              first,
            );
          } catch (error) {
            // The workspace leaves the model alone for a while after this,
            // and says so; saying it here too saves every caller asking the
            // workspace again before that check would be read.
            if (!signal.aborted) {
              queryClient.setQueryData(
                rpcClient.workspace.decision.available.queryKey(),
                false,
              );
            }
            throw error;
          }
        }
      : skipToken,
    queryKey: ["decision", ...key],
    retry: false,
    retryOnMount: false,
    staleTime: Infinity,
  });
  return {
    /** The answer for `key`, or the one `keepPrevious` let stand in for it. */
    answer: sending ? query.data : undefined,
    available,
    /** Whether a request is out. */
    isAsking: sending && query.isFetching,
  };
}
