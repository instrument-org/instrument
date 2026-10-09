import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { BrowserHandoffButton } from "@/client/components/browser-handoff-button";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { InfoIcon } from "@phosphor-icons/react/Info";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";

/**
 * Adds OpenRouter by having it create a key in the browser, so nobody has to
 * copy one. While the browser has it, the button holds as Cancel and the line
 * under it says where to finish.
 */
export function ConnectOpenRouter({
  baseURL,
  displayName,
  onConnected,
  onFailed,
}: {
  baseURL?: string;
  displayName?: string;
  onConnected: () => void;
  onFailed: (message: string) => void;
}) {
  const [waiting, setWaiting] = useState(false);
  const [declined, setDeclined] = useState(false);
  // Counts presses, so a connect that settles after a newer one started
  // leaves the button to the newer one.
  const attempts = useRef(0);
  const connect = useMutation(
    rpcClient.providerConfig.connectOpenRouter.mutationOptions(),
  );

  const start = async () => {
    const attempt = ++attempts.current;
    setWaiting(true);
    setDeclined(false);
    const result = await connect
      .mutateAsync({ baseURL, displayName })
      .catch((error: unknown) => ({
        error:
          error instanceof Error
            ? error.message
            : "Couldn't connect OpenRouter",
        outcome: "failed" as const,
      }));
    if (attempt !== attempts.current) {
      return;
    }
    setWaiting(false);
    switch (result.outcome) {
      case "connected": {
        onConnected();
        return;
      }
      case "declined": {
        setDeclined(true);
        return;
      }
      case "failed": {
        onFailed(result.error);
        return;
      }
      case "canceled": {
        return;
      }
    }
  };

  return (
    <div className="flex flex-col gap-y-3">
      {declined && (
        <div className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2.5 text-xs text-muted-foreground">
          <InfoIcon className="mt-px size-3.5 shrink-0" />
          <p>
            OpenRouter didn&apos;t create a key, so nothing was added. You can
            connect again whenever you&apos;re ready.
          </p>
        </div>
      )}
      <BrowserHandoffButton
        className="w-full justify-center"
        icon={<AIProviderIcon className="size-4" type="openrouter" />}
        onCancel={() => {
          attempts.current++;
          setWaiting(false);
          void rpcClient.providerConfig.cancelConnectOpenRouter.call();
        }}
        onStart={() => {
          void start();
        }}
        size="lg"
        waiting={waiting}
      >
        Connect OpenRouter
      </BrowserHandoffButton>
      <p className="-mt-1 text-center text-xs text-muted-foreground">
        {waiting
          ? "Finish connecting OpenRouter in your browser"
          : `OpenRouter will open in your browser so you can create a key for ${APP_NAME}.`}
      </p>
    </div>
  );
}
