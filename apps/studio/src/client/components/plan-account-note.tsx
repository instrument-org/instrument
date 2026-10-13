import { openLogin } from "@/client/atoms/login-modal";
import { openSettings } from "@/client/atoms/settings-modal";
import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { ReplyNote, ReplyNoteButton } from "@/client/components/reply-note";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { useOpenExternalLink } from "@/client/hooks/use-open-external-link";
import {
  describeReset,
  hasUsageReturned,
  lastPlanAccountStop,
  otherPlanAccount,
  type PlanAccountProvider,
  type PlanAccountStop,
  planAccountName,
  planAccountNoteText,
} from "@/client/lib/plan-account-stop";
import { rpcClient } from "@/client/rpc/client";
import {
  type AIGatewayModel,
  type AIGatewayModelURI,
} from "@instrument-org/ai-gateway/client";
import { APP_NAME, OUR_MODELS } from "@instrument-org/shared";
import { type SessionMessage } from "@instrument-org/workspace/client";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/ArrowSquareOut";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle";
import { ClockIcon } from "@phosphor-icons/react/Clock";
import { GaugeIcon } from "@phosphor-icons/react/Gauge";
import { KeyIcon } from "@phosphor-icons/react/Key";
import { WarningIcon } from "@phosphor-icons/react/Warning";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";

/**
 * The stop the chat's last turn ended on because of the person's ChatGPT or
 * Claude plan, until a new turn starts or they choose to wait it out.
 */
export function usePlanAccountNote({
  isAgentRunning,
  messages,
}: {
  isAgentRunning: boolean;
  messages: SessionMessage.WithParts[];
}) {
  const [waitingOn, setWaitingOn] = useState<null | string>(null);
  const found = lastPlanAccountStop({ isAgentRunning, messages });
  if (!found || found.messageId === waitingOn) {
    return null;
  }
  return {
    stop: found.stop,
    wait: () => {
      setWaitingOn(found.messageId);
    },
  };
}

/** The best model on a plan account the person has connected, if any. */
function planModel(
  models: AIGatewayModel.Type[] | undefined,
  provider: PlanAccountProvider,
) {
  const usable = (models ?? []).filter(
    (model) => model.params.provider === provider && !model.restricted,
  );
  return (
    usable.find((model) => model.tags.includes("default")) ??
    usable.find((model) => model.tags.includes("recommended")) ??
    usable[0]
  );
}

/**
 * The note over the reply box when a turn stopped on the person's ChatGPT or
 * Claude plan. Out of usage, it says when the plan comes back and offers the
 * ways to keep going in the meantime; with an account that cannot be used here, it offers to
 * connect another AI. Once a reset time has passed it offers to continue.
 */
export function PlanAccountNote({
  onContinue,
  onKeepGoing,
  onWait,
  stop,
}: {
  /** Runs the stopped turn again on the model the chat has. */
  onContinue: () => void;
  /** Moves the chat to another model and runs the stopped turn on it. */
  onKeepGoing: (modelURI: AIGatewayModelURI.Type) => void;
  /** Sets the note aside until the next turn. */
  onWait: () => void;
  stop: PlanAccountStop;
}) {
  const { data: modelsData } = useQuery(
    rpcClient.gateway.models.live.list.experimental_liveOptions(),
  );
  const { data: hasToken } = useQuery(
    rpcClient.auth.live.hasToken.experimental_liveOptions(),
  );
  const openLink = useOpenExternalLink();
  const now = useNowUntil(
    stop.kind === "usage-limit" ? stop.resetsAt : undefined,
  );

  if (stop.kind === "not-eligible") {
    return (
      <ReplyNote
        action={
          <ReplyNoteButton
            onClick={() => {
              openSettings({ tab: "Providers" });
            }}
          >
            Connect another AI
          </ReplyNoteButton>
        }
        data-plan-account-note="not-eligible"
        icon={WarningIcon}
        tone="warn"
      >
        {planAccountNoteText(stop, now)}
      </ReplyNote>
    );
  }

  if (hasUsageReturned(stop, now)) {
    return (
      <ReplyNote
        action={
          <ReplyNoteButton emphasis onClick={onContinue}>
            Continue
          </ReplyNoteButton>
        }
        data-plan-account-note="usage-back"
        icon={CheckCircleIcon}
        iconClassName="text-brand-600 dark:text-brand-300"
        onDismiss={onWait}
        tone="neutral"
      >
        {planAccountNoteText(stop, now)}
      </ReplyNote>
    );
  }

  const models = modelsData?.models;
  const auto = models?.find((model) => model.providerId === OUR_MODELS.text.id);
  const other = otherPlanAccount(stop.provider);
  const otherModel = planModel(models, other);
  return (
    <ReplyNote
      action={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <ReplyNoteButton>
              Switch AI
              <CaretDownIcon className="size-3 text-foreground/50" />
            </ReplyNoteButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-70" side="top">
            <DropdownMenuLabel className="text-[11px] text-muted-foreground">
              Keep going with
            </DropdownMenuLabel>
            <DropdownMenuItem
              onSelect={() => {
                if (hasToken && auto) {
                  onKeepGoing(auto.uri);
                } else {
                  openLogin({ instrumentOnly: true });
                }
              }}
            >
              <AIProviderIcon
                className="size-4"
                type={OUR_MODELS.providerType}
              />
              {APP_NAME}'s AI
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                if (otherModel) {
                  onKeepGoing(otherModel.uri);
                } else {
                  openSettings({ tab: "Providers" });
                }
              }}
            >
              <AIProviderIcon className="size-4" type={other} />
              {planAccountName(other)}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                openSettings({ showNewProviderDialog: true, tab: "Providers" });
              }}
            >
              <KeyIcon />
              Your own API key
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {stop.provider === "chatgpt-account" && !stop.resetsAt && (
              <DropdownMenuItem
                onSelect={() => {
                  openLink(CHATGPT_USAGE_URL, { addReferral: false });
                }}
              >
                <ArrowSquareOutIcon />
                See your usage in ChatGPT
              </DropdownMenuItem>
            )}
            {stop.provider === "claude-account" && (
              <DropdownMenuItem
                onSelect={() => {
                  openSettings({
                    providerUsage: "claude-account",
                    setting: "claude-account",
                    tab: "Providers",
                  });
                }}
              >
                <GaugeIcon />
                See your Claude usage limits
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={onWait}>
              <ClockIcon />
              {stop.resetsAt
                ? `Wait until ${describeReset(stop.resetsAt, now)}`
                : "Wait for it to come back"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
      data-plan-account-note="usage-limit"
      icon={WarningIcon}
      tone="warn"
    >
      {planAccountNoteText(stop, now)}
    </ReplyNote>
  );
}

/** The time now, read again when `until` comes round so the note can change. */
function useNowUntil(until: Date | undefined) {
  const [, setTick] = useState(0);
  const untilMs = until?.getTime();
  useEffect(() => {
    if (untilMs === undefined) {
      return;
    }
    const wait = untilMs - Date.now();
    if (wait <= 0) {
      return;
    }
    // Timers past 2^31 ms fire at once, so a far reset is not watched.
    if (wait > 2 ** 31 - 1) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setTick((tick) => tick + 1);
    }, wait + 500);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [untilMs]);
  return new Date();
}
