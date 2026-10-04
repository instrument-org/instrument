import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { isDefinedError } from "@orpc/client";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/** How long the button shows it is opening the browser before it can be pressed again. */
const OPENING_MS = 4000;

/**
 * Signs in with ChatGPT, the way Settings > Providers does: the browser opens
 * on OpenAI's sign-in, and the app runs on the plan once it comes back. A
 * press while a sign-in is waiting starts it again, for someone who closed
 * the browser tab.
 */
export function ChatGPTLoginButton({
  className,
  onSuccess,
}: {
  className?: string;
  onSuccess: () => void;
}) {
  const [opening, setOpening] = useState(false);
  const openingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [declinedAccountId, setDeclinedAccountId] = useState<string>();
  useEffect(
    () => () => {
      clearTimeout(openingTimer.current);
    },
    [],
  );
  const signIn = useMutation(
    rpcClient.chatgptPlan.signIn.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't sign in with ChatGPT", {
          description: isDefinedError(error) ? error.message : undefined,
        });
      },
      onSuccess: async (account) => {
        if (account?.state === "signed-in") {
          // The app opens on a chat next, so it waits for the plan's model
          // to be the default rather than open on the one before it.
          await rpcClient.chatgptPlan.chooseDefaultModel
            .call({ accountId: account.id })
            .catch(() => {});
          onSuccess();
        } else if (account?.state === "plan-disabled") {
          // Signed in, but the plan was not shared with the app, so there is
          // nothing to run on yet. The next press asks that account again.
          setDeclinedAccountId(account.id);
          toast.error(`${APP_NAME} isn't allowed to use your plan yet`, {
            description: "Continue with ChatGPT again and allow plan use.",
          });
        }
      },
    }),
  );

  return (
    <Button
      className={className}
      disabled={opening}
      onClick={() => {
        clearTimeout(openingTimer.current);
        setOpening(true);
        openingTimer.current = setTimeout(() => {
          setOpening(false);
        }, OPENING_MS);
        signIn.mutate({ accountId: declinedAccountId });
      }}
      type="button"
      variant="outline"
    >
      {opening ? (
        <Spinner delay={0} />
      ) : (
        <AIProviderIcon className="size-4" type="chatgpt" />
      )}
      Continue with ChatGPT
    </Button>
  );
}
