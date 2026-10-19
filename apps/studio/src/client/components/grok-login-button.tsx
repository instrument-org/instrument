import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { BrowserHandoffButton } from "@/client/components/browser-handoff-button";
import { rpcClient } from "@/client/rpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/client/lib/toast";

/**
 * Signs in with Grok, the way Settings > Providers does: xAI's page opens in
 * the browser with a code filled in, and the caption shows the same code so it
 * can be matched. The button holds as Cancel until the sign-in comes back.
 */
export function GrokLoginButton({
  caption,
  className,
  onSuccess,
  onWaitingChange,
}: {
  /** Under the button; replaced by the code to enter while the browser has it. */
  caption: string;
  className?: string;
  onSuccess: () => void;
  /** Told when the button starts and stops holding. */
  onWaitingChange?: (waiting: boolean) => void;
}) {
  const [waiting, setWaiting] = useState(false);
  // Counts presses, so a sign-in that settles after a newer one started
  // leaves the button to the newer one.
  const attempts = useRef(0);
  const signIn = useMutation(rpcClient.grokAccount.signIn.mutationOptions());
  const { data: status } = useQuery({
    ...rpcClient.grokAccount.live.status.experimental_liveOptions(),
    enabled: waiting,
  });
  const userCode = waiting ? status?.pending?.userCode : undefined;

  useEffect(() => {
    onWaitingChange?.(waiting);
  }, [onWaitingChange, waiting]);

  const continueWithGrok = async () => {
    const attempt = ++attempts.current;
    setWaiting(true);
    const result = await signIn.mutateAsync({}).catch((error: unknown) => ({
      error: error instanceof Error ? error.message : "Sign-in failed",
      outcome: "failed" as const,
    }));
    if (attempt !== attempts.current) {
      return;
    }
    if (result.outcome === "failed") {
      setWaiting(false);
      toast.error("Couldn't sign in with Grok", { cause: result.error });
      return;
    }
    const { account } = result;
    if (result.outcome !== "signed-in" || !account) {
      setWaiting(false);
      return;
    }
    if (account.state === "no-subscription") {
      // Signed in, with nothing to run on: the account stays in Settings,
      // and this page stays for another way in.
      setWaiting(false);
      toast.error(`${account.label} doesn’t have a Grok plan`, {
        description: "You need SuperGrok or X Premium+ to use it here.",
      });
      return;
    }
    // The app opens on a chat next, so it waits for the account's model to
    // be the default rather than open on the one before it.
    await rpcClient.grokAccount.chooseDefaultModel
      .call({ accountId: account.id })
      .catch(() => {});
    onSuccess();
  };

  return (
    <div className="flex w-full flex-col items-center gap-y-2">
      <BrowserHandoffButton
        className={className}
        icon={<AIProviderIcon className="size-4" type="grok-account" />}
        onCancel={() => {
          attempts.current++;
          setWaiting(false);
          void rpcClient.grokAccount.cancelSignIn.call();
        }}
        onStart={() => {
          void continueWithGrok();
        }}
        variant="outline"
        waiting={waiting}
      >
        Continue with Grok
      </BrowserHandoffButton>
      <p className="text-center text-xs text-foreground/60">
        {userCode ? (
          <>
            Enter{" "}
            <span className="font-mono font-medium text-foreground select-all">
              {userCode}
            </span>{" "}
            on the page that opened in your browser
          </>
        ) : waiting ? (
          "Finish signing in with Grok in your browser"
        ) : (
          caption
        )}
      </p>
    </div>
  );
}
