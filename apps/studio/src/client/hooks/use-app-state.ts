import { rpcClient } from "@/client/rpc/client";
import { type TaskId } from "@instrument-org/workspace/client";
import { skipToken, useQuery } from "@tanstack/react-query";

export function useAppState({ id }: { id: TaskId | typeof skipToken }) {
  return useQuery(
    rpcClient.workspace.app.state.live.byId.experimental_liveOptions({
      input: id === skipToken ? skipToken : { id },
    }),
  );
}
