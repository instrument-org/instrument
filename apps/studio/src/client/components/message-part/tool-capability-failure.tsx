import { useState } from "react";

import { AIProviderGuardDialog } from "../ai-provider-guard-dialog";
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
  const [showProviderGuard, setShowProviderGuard] = useState(false);
  const [providerAdded, setProviderAdded] = useState(false);

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
                  setShowProviderGuard(true);
                }}
                size="sm"
              >
                Add an AI Provider
              </Button>
            )}
            <AIProviderGuardDialog
              onOpenChange={setShowProviderGuard}
              onSuccess={() => {
                setProviderAdded(true);
              }}
              open={showProviderGuard}
            />
          </div>
        )}
      </div>
    </ToolCardSection>
  );
}
