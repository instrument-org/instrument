import { useWindow } from "@/client/components/window/context";
import { appMentionToken } from "@/client/lib/app-mention";
import { rpcClient } from "@/client/rpc/client";
import { useMutation } from "@tanstack/react-query";
import { toast } from "@/client/lib/toast";

/**
 * Connect on a service the directory lists: set up from the directory's
 * own way in, with no conversation, and open the app's page, where the card
 * asks for the sign-in or key. A way in the directory cannot finish alone
 * goes to the agent instead, as a request the person sends.
 */
export function useConnectFromDirectory() {
  const { ask, openScreen } = useWindow();
  const setUp = useMutation(
    rpcClient.apps.setUp.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't set up the app", { cause: error });
      },
    }),
  );
  return {
    connect: (
      entry: { name: string; slug: string },
      { another = false }: { another?: boolean } = {},
    ) => {
      setUp.mutate(
        { slug: entry.slug },
        {
          onSuccess: (result) => {
            if (result.kind === "set-up") {
              openScreen(`/apps/${result.slug}`);
            } else {
              ask(
                another
                  ? `Connect another ${appMentionToken(entry)} account`
                  : `Connect ${appMentionToken(entry)}`,
              );
            }
          },
        },
      );
    },
    isConnecting: setUp.isPending,
  };
}
