import {
  type AIGatewayModel,
  type AIGatewayModelURI,
} from "@instrument-org/ai-gateway/client";
import { APP_NAME, OUR_MODELS } from "@instrument-org/shared";
import {
  describeMessageError,
  type SessionMessage,
} from "@instrument-org/workspace/client";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { WarningIcon } from "@phosphor-icons/react/Warning";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { openLogin } from "../atoms/login-modal";
import { openSettings } from "../atoms/settings-modal";
import { useOpenExternalLink } from "../hooks/use-open-external-link";
import {
  parsePlatformApiError,
  requiresAutoModelRecovery,
} from "../lib/parse-platform-api-error";
import { readModelStatus } from "../lib/model-status";
import { cn } from "../lib/utils";
import { rpcClient } from "../rpc/client";
import { CopyButton } from "./copy-button";
import { DeveloperModeBadge } from "./tool-part/developer-mode-badge";
import { Button } from "./ui/button";
import { UpgradeSubscriptionAlert } from "./upgrade-subscription-alert";

interface ErrorAction {
  label: string;
  onClick: () => void;
}

type MessageErrorData = NonNullable<
  SessionMessage.Assistant["metadata"]["error"]
>;

interface MessageErrorProps {
  isAgentRunning: boolean;
  isDeveloperMode: boolean;
  isLastMessage: boolean;
  message: SessionMessage.Assistant;
  onContinue: () => void;
  /** Switches the chat to another model; the card offers no switch without it. */
  onModelChange?: (modelURI: AIGatewayModelURI.Type) => void;
  /** Sends the last message again; the card offers no retry without it. */
  onRunAgain?: () => void;
}

const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";

/**
 * A turn that ended in an error, said in our words with the way forward
 * beside it.
 *
 * Three layers, each asked for by the one before it. The card says what
 * happened and what to do, in a sentence of ours and the one or two actions
 * that fix it. Under Details, and only for someone entitled to read it, is the
 * provider's own account: the status, the request, the body it sent back,
 * whole and copyable, because that is what a person pastes into a support
 * thread. Nothing is clipped to a scrolling box inside the card; a body long
 * enough to need one is read by copying it.
 *
 * An error the session has already moved past is kept to its one-line
 * summary, since the turn after it is what the reader is following.
 */
export function MessageError({
  isAgentRunning,
  isDeveloperMode,
  isLastMessage,
  message,
  onContinue,
  onModelChange,
  onRunAgain,
}: MessageErrorProps) {
  const error = message.metadata.error;
  const { data: modelsData } = useQuery(
    rpcClient.gateway.models.live.list.experimental_liveOptions(),
  );
  const { data: hasToken } = useQuery(
    rpcClient.auth.live.hasToken.experimental_liveOptions(),
  );
  const openLink = useOpenExternalLink();
  const [showDetails, setShowDetails] = useState(false);
  const [expandedPast, setExpandedPast] = useState(false);

  if (!error) {
    return null;
  }

  const platformError = parsePlatformApiError(message);
  const classification =
    "classification" in error ? error.classification : undefined;
  // Each of these describes a problem the user no longer has: a turn they
  // stopped themselves, credits they have since topped up, or a throttle the
  // machine waited out before the turn that followed succeeded.
  const isHiddenFromReader =
    error.kind === "aborted" ||
    (platformError?.code === "insufficient-credits" && !isLastMessage) ||
    ((classification === "rate-limit" || classification === "transient") &&
      !isLastMessage);
  if (isHiddenFromReader && !isDeveloperMode) {
    return null;
  }
  if (!isHiddenFromReader && platformError?.code === "insufficient-credits") {
    return <UpgradeSubscriptionAlert onContinue={onContinue} />;
  }

  const provider = message.metadata.aiGatewayModel?.params.provider;
  // A model on the user's own key answers about an account they hold, so its
  // own account of the failure is theirs to read. Ours writes about upstream
  // models and vendor accounts they have no part in, so it stays behind
  // developer mode. A message that recorded no provider counts as ours.
  const isOwnKeyProvider =
    provider !== undefined && provider !== OUR_MODELS.providerType;
  const canReadProviderText = isDeveloperMode || isOwnKeyProvider;
  const showActions = isLastMessage && !isAgentRunning;

  const { detail, summary } = describeForProvider(describeMessageError(error), {
    classification,
    provider,
  });
  const modelName = message.metadata.aiGatewayModel?.name.trim();
  const needsAutoRecovery =
    !!platformError && requiresAutoModelRecovery(message);
  const title = needsAutoRecovery
    ? modelName
      ? `${modelName} is unavailable`
      : "Model unavailable"
    : summary;
  const body = needsAutoRecovery
    ? platformError.message || error.message
    : detail;
  // Unclassified, our sentence is only that something failed, so the
  // provider's own line is the one that says what; on a classified error ours
  // already says it better.
  const providerLine =
    canReadProviderText &&
    (classification === undefined || classification === "unknown")
      ? providerSentence(error)
      : undefined;

  const actions = errorActions({
    instrumentOffer:
      classification === "usage-limit" && isPlanProvider(provider)
        ? hasToken === undefined
          ? undefined
          : hasToken
            ? modelsData?.models.find(isAuto)
            : "sign-up"
        : undefined,
    switchTo: needsAutoRecovery
      ? recoveryFor(message.metadata.aiGatewayModel?.uri, modelsData?.models)
      : undefined,
    classification,
    kind: error.kind,
    onModelChange,
    onRunAgain,
    openLink,
    provider,
  });

  const past = !isLastMessage;
  if (past && !expandedPast) {
    return (
      <button
        className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-black/3 dark:hover:bg-white/3"
        onClick={() => {
          setExpandedPast(true);
        }}
        type="button"
      >
        {isHiddenFromReader && <DeveloperModeBadge />}
        <WarningIcon className="size-3.5 shrink-0 text-warning-700 dark:text-warning-300" />
        <span className="truncate">{title}</span>
      </button>
    );
  }

  return (
    <div
      className="w-full rounded-xl border border-black/8 bg-card px-4 py-3.5 text-sm dark:border-white/8"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <WarningIcon className="mt-0.5 size-4 shrink-0 text-warning-700 dark:text-warning-300" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            {isHiddenFromReader && <DeveloperModeBadge />}
            <span className="font-medium text-foreground">{title}</span>
          </div>
          <p className="text-muted-foreground">{body}</p>
          {providerLine && (
            <p className="text-muted-foreground/80">{providerLine}</p>
          )}

          {(showActions && actions.length > 0) || canReadProviderText ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {showActions &&
                actions.map((action, index) => (
                  <Button
                    key={action.label}
                    onClick={action.onClick}
                    size="sm"
                    variant={index === 0 ? "default" : "outline"}
                  >
                    {action.label}
                  </Button>
                ))}
              {canReadProviderText && (
                <Button
                  aria-expanded={showDetails}
                  className="text-muted-foreground"
                  onClick={() => {
                    setShowDetails(!showDetails);
                  }}
                  size="sm"
                  variant="ghost"
                >
                  <CaretRightIcon
                    className={cn(
                      "transition-transform",
                      showDetails && "rotate-90",
                    )}
                  />
                  Details
                </Button>
              )}
            </div>
          ) : null}

          {canReadProviderText && showDetails && (
            <ErrorDetails error={error} message={message} />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Our sentence, naming the service when we know which one refused. Instrument
 * reaches several, so "the provider" leaves the reader to work out which
 * account hit its limit or signed them out.
 */
function describeForProvider(
  described: { detail: string; summary: string },
  {
    classification,
    provider,
  }: { classification: string | undefined; provider: string | undefined },
): { detail: string; summary: string } {
  if (provider === "claude-plan") {
    if (classification === "usage-limit") {
      return {
        detail: `You've reached your Claude subscription's usage limit. It starts over when the window resets; Settings shows when. Until then, switch to another model.`,
        summary: "Claude usage limit reached",
      };
    }
    if (classification === "auth") {
      return {
        detail:
          "Claude Code isn't signed in to your Claude account anymore. Sign in again from Settings, or switch to another model.",
        summary: "Signed out of Claude",
      };
    }
    return described;
  }
  if (provider !== "chatgpt") {
    return described;
  }
  if (classification === "usage-limit") {
    return {
      detail: `You've reached the limit your ChatGPT plan allows ${APP_NAME}. Review it in ChatGPT's usage settings, or switch to another model.`,
      summary: "ChatGPT usage limit reached",
    };
  }
  if (classification === "auth") {
    return {
      detail:
        "Sign in with ChatGPT again to keep using your plan, or switch to another model.",
      summary: "Signed out of ChatGPT",
    };
  }
  return described;
}

function detailFacts(
  error: MessageErrorData,
  message: SessionMessage.Assistant,
): [string, string][] {
  const model = message.metadata.aiGatewayModel;
  const facts: [string, string][] = [["Error", error.message]];
  if (model) {
    facts.push([
      "Model",
      [model.name.trim(), model.providerName].filter(Boolean).join(" · "),
    ]);
  }
  if (error.kind === "api-call") {
    if (error.statusCode !== undefined) {
      facts.push(["Status", String(error.statusCode)]);
    }
    facts.push(["Request", error.url]);
  }
  if (error.kind === "no-such-tool") {
    facts.push(["Tool", error.toolName]);
  }
  return facts;
}

function detailsText(facts: [string, string][], body: string | undefined) {
  const lines = facts.map(([label, value]) => `${label}: ${value}`);
  return body ? [...lines, "", body].join("\n") : lines.join("\n");
}

/**
 * A plan the user brings, whose limit is theirs to reach. Running out offers
 * Instrument's own models, as a choice and never as a silent fallback.
 */
function isPlanProvider(provider: string | undefined) {
  return provider === "chatgpt" || provider === "claude-plan";
}

function errorActions({
  instrumentOffer,
  switchTo,
  classification,
  kind,
  onModelChange,
  onRunAgain,
  openLink,
  provider,
}: {
  /** Instrument's Auto to switch to, or signing up for Instrument to get it. */
  instrumentOffer: AIGatewayModel.Type | "sign-up" | undefined;
  switchTo: AIGatewayModel.Type | undefined;
  classification: string | undefined;
  kind: MessageErrorData["kind"];
  onModelChange: ((modelURI: AIGatewayModelURI.Type) => void) | undefined;
  onRunAgain: (() => void) | undefined;
  openLink: ReturnType<typeof useOpenExternalLink>;
  provider: string | undefined;
}): ErrorAction[] {
  const tryAgain = onRunAgain
    ? [{ label: "Try again", onClick: onRunAgain }]
    : [];
  const providerSettings = {
    label: "Open provider settings",
    onClick: () => {
      openSettings({ tab: "Providers" });
    },
  };

  if (switchTo && onModelChange) {
    const name = isAuto(switchTo) ? "Auto" : switchTo.name.trim();
    return [
      {
        label: `Switch to ${name}`,
        onClick: () => {
          onModelChange(switchTo.uri);
          toast.success(`Switched to ${name}`);
        },
      },
    ];
  }
  if (classification === "usage-limit") {
    const offer: ErrorAction[] =
      instrumentOffer === "sign-up"
        ? [
            {
              label: `Try ${APP_NAME}`,
              onClick: () => {
                openLogin({ hideManualProvider: true });
              },
            },
          ]
        : instrumentOffer && onModelChange
          ? [
              {
                label: "Switch to Auto",
                onClick: () => {
                  onModelChange(instrumentOffer.uri);
                  toast.success("Switched to Auto");
                },
              },
            ]
          : [];
    if (provider === "claude-plan") {
      return [...offer, providerSettings, ...tryAgain];
    }
    return provider === "chatgpt"
      ? [
          ...offer,
          {
            label: "Manage usage",
            onClick: () => {
              openLink(CHATGPT_USAGE_URL, { addReferral: false });
            },
          },
          ...tryAgain,
        ]
      : [providerSettings, ...tryAgain];
  }
  if (classification === "auth" || kind === "api-key") {
    if (provider === OUR_MODELS.providerType) {
      return tryAgain;
    }
    return provider === "chatgpt" || provider === "claude-plan"
      ? [{ ...providerSettings, label: "Sign in again" }, ...tryAgain]
      : [providerSettings, ...tryAgain];
  }
  return tryAgain;
}

/**
 * Everything the provider said, laid out to be read and copied rather than
 * scrolled: the facts in a short list, then the body it sent back, whole.
 */
function ErrorDetails({
  error,
  message,
}: {
  error: MessageErrorData;
  message: SessionMessage.Assistant;
}) {
  const facts = detailFacts(error, message);
  const responseBody =
    error.kind === "api-call" && error.responseBody
      ? prettyBody(error.responseBody)
      : undefined;
  const toolInput =
    error.kind === "invalid-tool-input" ? error.input : undefined;

  return (
    <div className="relative mt-2 flex flex-col gap-3 rounded-lg bg-black/3 p-3 pr-10 text-xs dark:bg-white/3">
      <CopyButton
        className="absolute top-2 right-2 size-6 rounded-sm p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
        iconSize={14}
        label="Copy error details"
        onCopy={() =>
          navigator.clipboard.writeText(
            detailsText(facts, responseBody ?? toolInput),
          )
        }
        tooltip="Copy error details"
      />
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        {facts.map(([label, value]) => (
          <div className="contents" key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      {(responseBody ?? toolInput) && (
        <pre className="font-mono break-words whitespace-pre-wrap text-foreground">
          {responseBody ?? toolInput}
        </pre>
      )}
    </div>
  );
}

function prettyBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

/**
 * The one sentence a provider wrote for a person, pulled out of its body
 * when it has one: `error.message` in the shapes providers share, else the
 * error's own message.
 */
function providerSentence(error: MessageErrorData): string {
  if (error.kind === "api-call" && error.responseBody) {
    try {
      const parsed: unknown = JSON.parse(error.responseBody);
      const nested =
        typeof parsed === "object" && parsed !== null && "error" in parsed
          ? parsed.error
          : undefined;
      if (
        typeof nested === "object" &&
        nested !== null &&
        "message" in nested &&
        typeof nested.message === "string"
      ) {
        return nested.message;
      }
    } catch {
      // Not JSON: the error's own message stands.
    }
  }
  return error.message;
}

const isAuto = (model: AIGatewayModel.Type) =>
  model.providerId === OUR_MODELS.text.id;

/**
 * What to move a turn to after our gateway refused its model: whatever the
 * composer would offer for the same model (its next release, or the same
 * model through another connection), and Auto when the list still thinks the
 * model is fine, since the gateway refusing it says otherwise.
 */
function recoveryFor(
  failedURI: AIGatewayModelURI.Type | undefined,
  models: AIGatewayModel.Type[] | undefined,
): AIGatewayModel.Type | undefined {
  const status = readModelStatus({
    dismissedOffers: new Set(),
    models,
    modelURI: failedURI,
  });
  const fix =
    status.kind === "gone" || status.kind === "restricted"
      ? status.fix
      : status.kind === "newer"
        ? status.newer
        : undefined;
  return fix ?? models?.find(isAuto);
}
