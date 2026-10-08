import { type SetupState } from "@/client/components/onboarding/setup/flow";
import { workLabels } from "@/client/components/onboarding/setup/tasks-starters";
import { rpcClient } from "@/client/rpc/client";
import { skipToken, useQuery } from "@tanstack/react-query";

/**
 * Writing the person's tasks: the one call setup spends AI on, made with the
 * model their way in set as the default, from what fills their week. It
 * starts as they leave "What fills your week?", so it runs while they choose
 * a look, and the tasks page reads the same call. It is not made when their
 * way in is out of usage, when their own key is kept out of setup, or when
 * no model is set yet; the tasks page offers starter tasks then.
 *
 * `status` is "off" when the call will not be made, "writing" while it is
 * out, and "done" or "failed" once it is back. `retry` makes it again.
 */
export function useTaskWriting(state: SetupState) {
  const { isOutOfUsage, useAIDuringSetup, work, workOther } = state.answers;
  const { data: modelURI, isPending: isModelPending } = useQuery(
    rpcClient.preferences.live.defaultModelURI.experimental_liveOptions(),
  );
  const mayWrite = !isOutOfUsage && !(state.way === "key" && !useAIDuringSetup);
  const hasStarted = state.step === "look" || state.step === "tasks";
  const query = useQuery(
    rpcClient.workspace.setup.writeTasks.queryOptions({
      input:
        mayWrite && hasStarted && modelURI
          ? { modelURI, work: workLabels(work), workOther }
          : skipToken,
      retry: false,
      staleTime: Number.POSITIVE_INFINITY,
    }),
  );
  const willWrite = mayWrite && (isModelPending || modelURI !== undefined);
  const status = !willWrite
    ? "off"
    : query.isError
      ? "failed"
      : query.data
        ? "done"
        : "writing";
  return {
    data: query.data,
    retry: () => {
      void query.refetch();
    },
    status,
  } as const;
}
