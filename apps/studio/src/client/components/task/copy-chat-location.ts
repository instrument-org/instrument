import { rpcClient } from "@/client/rpc/client";
import { toast } from "@/client/lib/toast";
import { useMutation } from "@tanstack/react-query";

/**
 * Copies where a chat's session lives on this computer, for pasting to a
 * coding agent. The main process puts the text together and copies it, so a
 * menu item calls this with nothing fetched. Behind developer mode.
 */
export function useCopyChatLocation() {
  // The stable `mutate` rather than the mutation object, which is new on
  // every render: a list that copies through this hook memoizes on it.
  const { mutate } = useMutation(
    rpcClient.chatLocation.copy.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't copy the chat location", { cause: error });
      },
      onSuccess: () => {
        toast.success("Copied the chat location");
      },
    }),
  );
  return mutate;
}
