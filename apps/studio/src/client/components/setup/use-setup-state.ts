import { rpcClient } from "@/client/rpc/client";
import { type SetupState } from "@/shared/setup";
import { useQuery } from "@tanstack/react-query";

/**
 * Where setup is, from the window's first render: the preload's read as the
 * window loaded, then `setup.live.state` as it changes. Null outside Electron
 * until the live state answers.
 */
export function useSetupState(): null | SetupState {
  const { data } = useQuery({
    ...rpcClient.setup.live.state.experimental_liveOptions(),
    initialData: window.api.initialSetupState ?? undefined,
  });
  return data ?? null;
}

/** Whether setup is drawn over the window. */
export function useIsSetupUp() {
  return (useSetupState()?.step ?? null) !== null;
}
