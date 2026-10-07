import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { BrowserHandoffButton } from "@/client/components/browser-handoff-button";
import { ClaudeSignInCode } from "@/client/components/claude-sign-in-code";
import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * Connects a Claude account, the way Continue with ChatGPT does: one press
 * gets Claude Code ready when it is not yet, then the sign-in finishes on
 * Anthropic's page in the browser. Already signed in, it connects at once.
 */
export function ClaudeLoginButton({
  caption,
  className,
  onSuccess,
}: {
  /** Under the button; replaced by what is happening while it holds. */
  caption: string;
  className?: string;
  onSuccess: () => void;
}) {
  const { data: status } = useQuery(
    rpcClient.claudePlan.live.status.experimental_liveOptions(),
  );
  const [pressed, setPressed] = useState(false);
  const [hint, setHint] = useState<string>();
  const connecting = useRef(false);

  const connect = async () => {
    if (connecting.current) {
      return;
    }
    connecting.current = true;
    const result = await rpcClient.claudePlan.connect.call({}).finally(() => {
      connecting.current = false;
    });
    if (result.status.kind !== "signed-in") {
      return;
    }
    setPressed(false);
    toast.success("Connected your Claude account", {
      description: result.modelName
        ? `New chats use ${result.modelName} from your subscription.`
        : "Its models are in the model picker.",
    });
    onSuccess();
  };

  // Signed in from the browser while the button held.
  useEffect(() => {
    if (pressed && status?.kind === "signed-in") {
      void connect();
    }
  });

  const continueWithClaude = async () => {
    setHint(undefined);
    setPressed(true);
    if (status?.kind === "signed-in") {
      await connect();
      return;
    }
    const result = await rpcClient.claudePlan.signIn.call({});
    if (!result.opened) {
      setPressed(false);
      setHint(
        result.command
          ? `Run ${result.command} in a terminal.`
          : "Claude Code couldn't be set up on this computer.",
      );
    }
  };

  const installing = status?.install?.state === "downloading";
  const waiting =
    pressed && (installing || status?.signingIn === true || !status);

  return (
    <div className="flex w-full flex-col items-center gap-y-2">
      <BrowserHandoffButton
        className={className}
        icon={<AIProviderIcon className="size-4" type="claude-plan" />}
        onCancel={() => {
          setPressed(false);
          void rpcClient.claudePlan.cancelSignIn.call({});
        }}
        onStart={() => {
          void continueWithClaude();
        }}
        variant="outline"
        waiting={waiting}
      >
        Continue with Claude
      </BrowserHandoffButton>
      <p className="text-center text-xs text-foreground/60">
        {hint ??
          (status?.install?.state === "downloading"
            ? `Getting Claude Code ready, ${installPercent(status.install)}% done`
            : pressed && status?.signingIn
              ? "Finish signing in to Claude in your browser"
              : caption)}
      </p>
      {pressed && status?.signingIn && status.signInLink && (
        <ClaudeSignInCode className="w-full" link={status.signInLink} />
      )}
    </div>
  );
}

function installPercent({
  received,
  total,
}: {
  received: number;
  total: number;
}) {
  return total > 0 ? Math.round((received / total) * 100) : 0;
}
