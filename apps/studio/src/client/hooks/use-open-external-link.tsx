import { rpcClient } from "@/client/rpc/client";
import { addRef } from "@instrument-org/shared";
import { useMutation } from "@tanstack/react-query";
import { toast } from "@/client/lib/toast";

/**
 * Hand a URL to the OS browser, reporting a refusal where the user can act on
 * it.
 *
 * Its own hook rather than something only the anchor does, because a link
 * inside a task offers this as one of two destinations rather than as what a
 * click does, and both spellings have to fail the same way: the failure is the
 * only part of leaving the app the user ever sees.
 */
export function useOpenExternalLink() {
  const mutation = useMutation(
    rpcClient.utils.openExternalLink.mutationOptions({
      onError: async (error, variables) => {
        const copied = await navigator.clipboard
          .writeText(variables.url)
          .then(
            () => true,
            () => false,
          );
        toast.error("Couldn't open the link in your browser", {
          cause: error,
          description: copied
            ? "The link is copied, so you can paste it into your browser."
            : undefined,
        });
      },
    }),
  );

  return (
    href: string,
    { addReferral = true }: { addReferral?: boolean } = {},
  ) => {
    const finalUrl = addReferral ? addRef(href) : href;
    // Fire-and-forget: mutateAsync rejects on failure, and because this handler
    // is never awaited that rejection surfaces as an unhandled rejection
    // (captured by PostHog). mutate() routes failures through onError (toast +
    // clipboard copy) without leaking.
    mutation.mutate({ url: finalUrl });
  };
}
