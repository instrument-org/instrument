import { BrowserHandoffButton } from "@/client/components/browser-handoff-button";
import { toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import { type SignInOutcome } from "@/shared/sign-in-outcome";
import { APP_NAME } from "@instrument-org/shared";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { FcGoogle } from "react-icons/fc";

/**
 * Signs in with Google in the user's browser. While the browser has it, the
 * button holds as Cancel and the caption above it says where to finish.
 */
export function GoogleLoginButton({
  caption,
  className,
  onLogin,
  onSuccess,
  onWaitingChange,
}: {
  /** Above the button; replaced by where to finish while the browser has it. */
  caption?: ReactNode;
  className?: string;
  onLogin: () => Promise<SignInOutcome>;
  onSuccess?: () => void;
  /** Told when the button starts and stops holding. */
  onWaitingChange?: (waiting: boolean) => void;
}) {
  const [waiting, setWaiting] = useState(false);
  // Counts presses, so a sign-in that settles after a newer one started
  // leaves the button to the newer one.
  const attempts = useRef(0);

  useEffect(() => {
    onWaitingChange?.(waiting);
  }, [onWaitingChange, waiting]);

  const login = async () => {
    const attempt = ++attempts.current;
    setWaiting(true);
    const outcome = await onLogin().catch(() => "failed" as const);
    if (attempt !== attempts.current) {
      return;
    }
    setWaiting(false);
    if (outcome === "signed-in") {
      onSuccess?.();
    }
    if (outcome === "sign-up-refused") {
      toast.error(`${APP_NAME} isn't open to new accounts yet`, {
        description: "You can still use your own ChatGPT, Claude or Grok plan.",
      });
    }
  };

  return (
    <div className="flex w-full flex-col items-center gap-y-4">
      {waiting ? (
        <p className="text-xs leading-4.5 font-medium text-foreground/80">
          Finish signing in with Google in your browser
        </p>
      ) : (
        caption
      )}
      <BrowserHandoffButton
        className={className}
        icon={<FcGoogle />}
        onCancel={() => {
          attempts.current++;
          setWaiting(false);
          void rpcClient.auth.cancelSignIn.call();
        }}
        onStart={() => {
          void login();
        }}
        variant="default"
        waiting={waiting}
      >
        Continue with Google
      </BrowserHandoffButton>
    </div>
  );
}
