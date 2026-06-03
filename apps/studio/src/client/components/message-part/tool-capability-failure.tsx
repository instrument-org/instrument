import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "../ui/button";
import { ToolCardSection } from "./tool-card";

export function ToolCapabilityFailure({
  capabilityLabel,
  errorMessage,
  onRetry,
  providerGuardDescription,
  responseBody,
  retryMessage,
}: {
  capabilityLabel: string;
  errorMessage: string;
  onRetry: (message: string) => void;
  providerGuardDescription?: string;
  responseBody?: string;
  retryMessage: string;
}) {
  const [providerAdded, setProviderAdded] = useState(false);
  const { data: hasToken } = useQuery(
    rpcClient.auth.live.hasToken.experimental_liveOptions(),
  );

  async function openProviderGuard() {
    const result = await rpcClient.studioOverlay.show.call({
      kind: "login",
      props: hasToken ? { reason: "provider-required" } : undefined,
    });
    if (result.completed) {
      setProviderAdded(true);
    }
  }

  return (
    <ToolCardSection maxHeight="max-h-64">
      <div>
        <p className="text-sm text-muted-foreground">{errorMessage}</p>

        {responseBody && (
          <pre className="mt-3 max-h-32 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs whitespace-pre-wrap text-muted-foreground scrollbar-color scrollbar-thin">
            {responseBody}
          </pre>
        )}

        {providerGuardDescription && (
          <div className="mt-3 flex gap-2">
            {providerAdded ? (
              <Button
                onClick={() => {
                  onRetry(retryMessage);
                }}
                size="sm"
              >
                Retry {capabilityLabel}
              </Button>
            ) : (
              <Button
                onClick={() => {
                  void openProviderGuard();
                }}
                size="sm"
              >
                Add an AI Provider
              </Button>
            )}
          </div>
        )}
      </div>
    </ToolCardSection>
  );
}
