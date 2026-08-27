import { captureClientEvent } from "@/client/lib/capture-client-event";
import { rpcClient } from "@/client/rpc/client";
import { addRef } from "@instrument-org/shared";
import { isDefinedError } from "@orpc/client";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

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
        const errorMessage = isDefinedError(error)
          ? error.message
          : "An unknown error occurred";

        try {
          await navigator.clipboard.writeText(variables.url);
          toast.error("Unable to open link in your browser", {
            description: (
              <div className="w-full space-y-1">
                <div className="text-sm">Link copied to clipboard.</div>
                <code className="block w-full overflow-x-auto rounded-sm bg-muted px-1 py-0.5 text-xs">
                  {variables.url}
                </code>
                <div className="text-xs text-muted-foreground">
                  Error: {errorMessage}
                </div>
              </div>
            ),
          });
        } catch {
          toast.error("Unable to open link in your browser", {
            description: errorMessage,
          });
        }
      },
    }),
  );

  return (
    href: string,
    { addReferral = true }: { addReferral?: boolean } = {},
  ) => {
    const finalUrl = addReferral ? addRef(href) : href;
    captureClientEvent("external_link.clicked", {
      external_url: finalUrl,
    });
    // Fire-and-forget: mutateAsync rejects on failure, and because this handler
    // is never awaited that rejection surfaces as an unhandled rejection
    // (captured by PostHog). mutate() routes failures through onError (toast +
    // clipboard copy) without leaking.
    mutation.mutate({ url: finalUrl });
  };
}
