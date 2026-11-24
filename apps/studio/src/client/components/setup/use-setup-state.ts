import { rpcClient } from "@/client/rpc/client";
import { type SetupState, type SetupStep } from "@/shared/setup";
import { useMutation, useQuery } from "@tanstack/react-query";
import { atom, useSetAtom } from "jotai";

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

/**
 * The step a page keeps on screen past the moment its facts settle it, until
 * that page answers or finishes (`hold`), or setup is finished around it.
 */
export const heldSetupStepAtom = atom<null | {
  isNewStepOnly: boolean;
  step: SetupStep;
}>(null);

/** Finishes setup, letting go of a page held on screen. */
export function useFinishSetup() {
  const setHeld = useSetAtom(heldSetupStepAtom);
  const { mutate } = useMutation(rpcClient.setup.finish.mutationOptions());
  return () => {
    setHeld(null);
    mutate(undefined);
  };
}
