import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { BrowserHandoffButton } from "@/client/components/browser-handoff-button";
import { useOpenExternalLink } from "@/client/hooks/use-open-external-link";
import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const INSTALL_URL = "https://code.claude.com/docs/en/setup";

/**
 * Connects the Claude account Claude Code is signed in to. Signing in is
 * Claude Code's own: a press opens a terminal at its sign-in when it is
 * signed out, and the button holds until it is signed in, which a window
 * regaining focus checks.
 */
export function ClaudeLoginButton({
  caption,
  className,
  onSuccess,
}: {
  /** Under the button; replaced by what to do next while the terminal has it. */
  caption: string;
  className?: string;
  onSuccess: () => void;
}) {
  const { data: status } = useQuery(
    rpcClient.claudePlan.live.status.experimental_liveOptions(),
  );
  const openLink = useOpenExternalLink();
  const [waiting, setWaiting] = useState(false);
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
      return result.status;
    }
    setWaiting(false);
    toast.success("Connected your Claude account", {
      description: result.modelName
        ? `New chats use ${result.modelName} from your subscription.`
        : "Its models are in the model picker.",
    });
    onSuccess();
    return result.status;
  };

  // Signed in from the terminal while the button held.
  useEffect(() => {
    if (waiting && status?.kind === "signed-in") {
      void connect();
    }
  });

  const continueWithClaude = async () => {
    setHint(undefined);
    const current = await connect();
    switch (current?.kind) {
      case "not-installed": {
        openLink(INSTALL_URL, { addReferral: false });
        setHint("Install Claude Code, sign in to it, then continue.");
        return;
      }
      case "outdated": {
        setHint(
          `Update Claude Code (${current.version} is too old), then continue.`,
        );
        return;
      }
      case "signed-out":
      case "not-a-plan": {
        setWaiting(true);
        const opened = await rpcClient.claudePlan.signIn.call({});
        if (!opened.opened && opened.command) {
          setHint(`Run ${opened.command} in a terminal.`);
        }
        return;
      }
      default: {
        return;
      }
    }
  };

  return (
    <div className="flex w-full flex-col items-center gap-y-2">
      <BrowserHandoffButton
        className={className}
        icon={<AIProviderIcon className="size-4" type="claude-plan" />}
        onCancel={() => {
          setWaiting(false);
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
          (waiting
            ? "Finish signing in to Claude in the terminal and your browser"
            : caption)}
      </p>
    </div>
  );
}
