import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { BrowserHandoffButton } from "@/client/components/browser-handoff-button";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "@/client/lib/toast";

/**
 * Signs in with ChatGPT, the way Settings > Providers does: the browser opens
 * on OpenAI's sign-in, and the app runs on the plan once it comes back. While
 * the browser has it, the button holds as Cancel and the caption under it
 * says where to finish.
 */
export function ChatGPTLoginButton({
  caption,
  className,
  onSuccess,
}: {
  /** Under the button; replaced by where to finish while the browser has it. */
  caption: string;
  className?: string;
  onSuccess: () => void;
}) {
  const [waiting, setWaiting] = useState(false);
  // Counts presses, so a sign-in that settles after a newer one started
  // leaves the button to the newer one.
  const attempts = useRef(0);
  const [declinedAccountId, setDeclinedAccountId] = useState<string>();
  const signIn = useMutation(rpcClient.chatgptAccount.signIn.mutationOptions());

  const continueWithChatGPT = async () => {
    const attempt = ++attempts.current;
    setWaiting(true);
    const result = await signIn
      .mutateAsync({ accountId: declinedAccountId })
      .catch((error: unknown) => ({
        error: error instanceof Error ? error.message : "Sign-in failed",
        outcome: "failed" as const,
      }));
    if (attempt !== attempts.current) {
      return;
    }
    switch (result.outcome) {
      case "signed-in": {
        // The app opens on a chat next, so it waits for the plan's model to
        // be the default rather than open on the one before it. The button
        // holds until then, since the sign-in is not done for the user until
        // it is.
        if (result.account) {
          await rpcClient.chatgptAccount.chooseDefaultModel
            .call({ accountId: result.account.id })
            .catch(() => {});
        }
        onSuccess();
        return;
      }
      case "plan-off": {
        // Signed in, but the plan was not shared with the app, so there is
        // nothing to run on yet. The next press asks that account again.
        setWaiting(false);
        setDeclinedAccountId(result.account?.id);
        toast.error(`${APP_NAME} isn't allowed to use your plan yet`, {
          description: "Continue with ChatGPT again and allow plan use.",
        });
        return;
      }
      case "failed": {
        setWaiting(false);
        toast.error("Couldn't sign in with ChatGPT", { cause: result.error });
        return;
      }
      case "canceled":
      case "declined": {
        setWaiting(false);
        return;
      }
    }
  };

  return (
    <div className="flex w-full flex-col items-center gap-y-2">
      <BrowserHandoffButton
        className={className}
        icon={<AIProviderIcon className="size-4" type="chatgpt-account" />}
        onCancel={() => {
          attempts.current++;
          setWaiting(false);
          void rpcClient.chatgptAccount.cancelSignIn.call();
        }}
        onStart={() => {
          void continueWithChatGPT();
        }}
        variant="outline"
        waiting={waiting}
      >
        Continue with ChatGPT
      </BrowserHandoffButton>
      <p className="text-center text-xs text-foreground/60">
        {waiting ? "Finish signing in with ChatGPT in your browser" : caption}
      </p>
    </div>
  );
}
