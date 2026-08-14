import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import { OUR_MODELS } from "@instrument-org/shared";
import { type SessionMessage } from "@instrument-org/workspace/client";
import { WarningIcon } from "@phosphor-icons/react/Warning";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { describeMessageError } from "../lib/describe-message-error";
import {
  parsePlatformApiError,
  requiresAutoModelRecovery,
} from "../lib/parse-platform-api-error";
import { rpcClient } from "../rpc/client";
import {
  CollapsiblePartMainContent,
  CollapsiblePartTrigger,
} from "./collapsible-part";
import { DeveloperModeBadge } from "./tool-part/developer-mode-badge";
import { ToolPartListItemCompact } from "./tool-part/list-item-compact";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { UpgradeSubscriptionAlert } from "./upgrade-subscription-alert";

interface MessageErrorProps {
  isAgentRunning: boolean;
  isDeveloperMode: boolean;
  isLastMessage: boolean;
  message: SessionMessage.Assistant;
  onContinue: () => void;
  onModelChange: (modelURI: AIGatewayModelURI.Type) => void;
  onRunAgain: () => void;
  onStartNewTask?: () => void;
}

export function MessageError({
  isAgentRunning,
  isDeveloperMode,
  isLastMessage,
  message,
  onContinue,
  onModelChange,
  onRunAgain,
  onStartNewTask,
}: MessageErrorProps) {
  const error = message.metadata.error;
  const showActions = isLastMessage && !isAgentRunning;
  const defaultExpanded = isLastMessage && !isAgentRunning;
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [lastDefaultExpanded, setLastDefaultExpanded] =
    useState(defaultExpanded);
  if (defaultExpanded !== lastDefaultExpanded) {
    setLastDefaultExpanded(defaultExpanded);
    setIsExpanded(defaultExpanded);
  }
  const { data: modelsData } = useQuery(
    rpcClient.gateway.models.live.list.experimental_liveOptions(),
  );
  const { models } = modelsData ?? {};

  if (!error) {
    return null;
  }

  const isAborted = error.kind === "aborted";
  const platformError = parsePlatformApiError(message);
  const isStaleInsufficientCredits =
    platformError?.code === "insufficient-credits" && !isLastMessage;
  // The session went on past this one, so whatever was throttling or failing
  // has already been waited out -- the machine retries both of these. Reporting
  // it above a turn that then succeeded describes a problem the user does not
  // have.
  const classification =
    "classification" in error ? error.classification : undefined;
  const isRecoveredRetry =
    (classification === "rate-limit" || classification === "transient") &&
    !isLastMessage;

  // Normally hidden errors are still shown in developer mode via the generic renderer
  const isDevOnlyVisible =
    isDeveloperMode &&
    (isAborted || isStaleInsufficientCredits || isRecoveredRetry);

  if (!isDevOnlyVisible) {
    // Hide old or useless errors for non-developer mode
    if (isAborted || isStaleInsufficientCredits || isRecoveredRetry) {
      return null;
    }

    if (platformError?.code === "insufficient-credits") {
      return <UpgradeSubscriptionAlert onContinue={onContinue} />;
    }
  }

  if (showActions && platformError && requiresAutoModelRecovery(message)) {
    const autoModel = models?.find((m) => m.providerId === OUR_MODELS.text.id);
    // The message names the model, because the recorded model carries a display
    // name and the platform error only knows the id it was asked for.
    const modelName = message.metadata.aiGatewayModel?.name.trim();

    return (
      <Alert>
        <AlertTitle>
          {modelName ? `${modelName} is unavailable` : "Model unavailable"}
        </AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <span>{platformError.message || error.message}</span>
          {autoModel && (
            <div className="flex">
              <Button
                onClick={() => {
                  onModelChange(autoModel.uri);
                  toast.success("Switched to Auto model");
                }}
                size="sm"
              >
                Switch to Auto Mode
              </Button>
            </div>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  const { detail, summary } = describeMessageError(error);

  // A model on the user's own key answers about an account they hold. Its
  // rejection names the tier, the reset window, or the key that was refused,
  // and every one of those is something they can go and fix -- so it is shown,
  // not buried. Only our own provider writes about an account they have no part
  // in. A message that never recorded a provider counts as ours, so an unknown
  // errs toward saying less rather than leaking more.
  const provider = message.metadata.aiGatewayModel?.params.provider;
  const isOwnKeyProvider =
    provider !== undefined && provider !== OUR_MODELS.providerType;

  const getErrorTitle = () => {
    switch (error.kind) {
      case "api-call":
      case "api-key":
      case "invalid-tool-input":
      case "no-such-tool": {
        return "Model error";
      }
      default: {
        return "Error";
      }
    }
  };

  const mainContent = (
    <ToolPartListItemCompact isExpanded={isExpanded}>
      {isDevOnlyVisible && <DeveloperModeBadge />}
      <span className="shrink-0 text-error-700/80 dark:text-error-300/80">
        <WarningIcon className="size-3" />
      </span>
      <span className="shrink-0 font-medium text-error-700/80 dark:text-error-300/80">
        {getErrorTitle()}
      </span>
      <span className="flex-1" />
      <span className="shrink-0 text-error-700/60 dark:text-error-300/60">
        {summary}
      </span>
    </ToolPartListItemCompact>
  );

  return (
    <div className="w-full">
      <Collapsible
        className="w-full"
        onOpenChange={setIsExpanded}
        open={isExpanded}
      >
        <CollapsibleTrigger asChild>
          <CollapsiblePartTrigger>{mainContent}</CollapsiblePartTrigger>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CollapsiblePartMainContent
            footer={
              showActions && onStartNewTask ? (
                <div className="mt-2 flex gap-2">
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={onStartNewTask}
                        size="sm"
                        variant="outline"
                      >
                        Start new task
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>
                        Opens a blank task. Nothing carries over, but this one
                        stays in your list, so you can copy over anything you
                        still need.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                  <Button onClick={onRunAgain} size="sm">
                    Try again
                  </Button>
                </div>
              ) : undefined
            }
          >
            <div className="mb-2">{detail}</div>

            {/* Everything below is the provider's own account of the failure,
                written for whoever integrates against it. On our own provider
                that means upstream models the user never chose and remedies on
                a vendor account they have no part in, so it is shown only to
                someone who asked for that layer. On their own key it is the
                truer answer and the one they can act on. */}
            {(isDeveloperMode || isOwnKeyProvider) && (
              <>
                <div className="mb-2">
                  <div className="mb-1 font-semibold">Error:</div>
                  <pre className="font-mono text-xs wrap-break-word whitespace-pre-wrap">
                    {error.message}
                  </pre>
                </div>

                {error.kind === "api-call" && (
                  <div className="space-y-1">
                    <div>
                      <strong>API:</strong> {error.name}
                    </div>
                    <div className="break-all">
                      <strong>URL:</strong> {error.url}
                    </div>
                    {error.statusCode && (
                      <div>
                        <strong>Status:</strong> {error.statusCode}
                      </div>
                    )}
                    {error.responseBody && (
                      <div>
                        <strong>Response:</strong>
                        <pre className="mt-1 max-h-32 overflow-y-auto rounded-sm bg-muted p-2 text-xs wrap-break-word whitespace-pre-wrap">
                          {error.responseBody}
                        </pre>
                      </div>
                    )}
                  </div>
                )}

                {error.kind === "invalid-tool-input" && (
                  <div>
                    <div className="mb-1 font-semibold">Input:</div>
                    <pre className="max-h-32 overflow-y-auto rounded-sm border bg-muted p-2 font-mono text-xs wrap-break-word whitespace-pre-wrap">
                      {error.input}
                    </pre>
                  </div>
                )}

                {error.kind === "no-such-tool" && (
                  <div>
                    <strong>Tool:</strong> {error.toolName}
                  </div>
                )}
              </>
            )}
          </CollapsiblePartMainContent>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
