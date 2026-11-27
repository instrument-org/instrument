import { openLogin } from "@/client/atoms/login-modal";
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

  function openProviderGuard() {
    openLogin(undefined, () => {
      setProviderAdded(true);
    });
  }

  return (
    <ToolCardSection collapsedHeight={256}>
      <div>
        <p className="text-sm text-muted-foreground">{errorMessage}</p>

        {responseBody && (
          <div className="mt-3 rounded-lg bg-muted">
            <pre className="max-h-32 scrollbar-thin scrollbar-color overflow-auto scroll-fade-y p-3 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {responseBody}
            </pre>
          </div>
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
                  openProviderGuard();
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
