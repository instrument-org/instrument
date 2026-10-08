import { keptAtom } from "@/client/lib/kept-state";
import { openPlanSheet, trialPlanAtom } from "@/client/atoms/plan-sheet";
import { Button } from "@/client/components/ui/button";
import { useBillingStatus } from "@/client/hooks/use-billing-status";
import { useOpenExternalLink } from "@/client/hooks/use-open-external-link";
import {
  type BillingNoticeAction,
  noticeCopy,
  refusalNotice,
  upgradePlan,
  usageWarning,
  usageWarningText,
} from "@/client/lib/billing";
import { parsePlatformApiError } from "@/client/lib/parse-platform-api-error";
import { rpcClient } from "@/client/rpc/client";
import { SUPPORT_URL } from "@instrument-org/shared";
import { type SessionMessage } from "@instrument-org/workspace/client";
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle";
import { GaugeIcon } from "@phosphor-icons/react/Gauge";
import { PauseCircleIcon } from "@phosphor-icons/react/PauseCircle";
import { XIcon } from "@phosphor-icons/react/X";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtom, useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/** The least time between the billing reads a finished turn makes. */
const TURN_END_READ_GAP_MS = 15_000;

/**
 * Which 80% warning was dismissed, by its period: dismissing one holds until
 * the next period (or the next trial) reaches 80% again.
 */
const dismissedUsageWarningAtom = keptAtom<null | string>(
  "layout",
  "billing-usage-warning-dismissed.v1",
  null,
);

/**
 * What the chat says about the plan, over its reply box and never covering
 * it: a notice when our platform refused the turn (the trial ended, a limit
 * was reached, a payment failed, a plan is needed), turning into Continue
 * once the reason has gone; otherwise the quiet line at 80% of the trial or
 * of a window. The reply box stays usable throughout, for a model on the
 * person's own key or ChatGPT or Claude account.
 */
export function ChatBillingNotice({
  isAgentRunning,
  messages,
  onContinue,
}: {
  isAgentRunning: boolean;
  messages: SessionMessage.WithParts[];
  /** Sends the stopped turn again. */
  onContinue?: () => void;
}) {
  const {
    data: status,
    dataUpdatedAt,
    isSignedIn,
    refetch,
  } = useBillingStatus();
  const { data: offer } = useQuery({
    ...rpcClient.billing.offer.queryOptions(),
    enabled: isSignedIn,
  });
  const openLink = useOpenExternalLink();
  const portal = useMutation(
    rpcClient.billing.openPortal.mutationOptions({
      onError: () => {
        toast.error("Couldn't open billing");
      },
    }),
  );
  const trialPlan = useAtomValue(trialPlanAtom);
  const [dismissedNotice, setDismissedNotice] = useState<null | string>(null);
  const [dismissedWarning, setDismissedWarning] = useAtom(
    dismissedUsageWarningAtom,
  );

  // The turn the conversation ended on: its last reply, unless something has
  // been said since. Context the session records after a turn is neither.
  const last = messages.findLast(
    (message) => message.role === "assistant" || message.role === "user",
  );
  const refused =
    !isAgentRunning && last?.role === "assistant" ? last : undefined;
  const refusal = refused ? parsePlatformApiError(refused) : null;
  const refusedId = refusal ? refused?.id : undefined;

  // A finished turn spent some of the plan and a refusal is news about the
  // account, so what billing says is read again as each turn ends rather than
  // at the next focus: that is what moves the 80% line and the notices.
  // The API allows ten status reads a minute, so a run of short turns reads
  // it at most every 15 seconds; a new refusal is always read, once.
  const readRefusal = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (isAgentRunning || !isSignedIn) {
      return;
    }
    const isNewRefusal =
      refusedId !== undefined && readRefusal.current !== refusedId;
    if (
      isNewRefusal ||
      new Date().getTime() - dataUpdatedAt > TURN_END_READ_GAP_MS
    ) {
      readRefusal.current = refusedId;
      void refetch();
    }
  }, [isAgentRunning, refusedId, isSignedIn, refetch, dataUpdatedAt]);

  const now = new Date();
  const notice =
    refused && refusal
      ? refusalNotice({
          now,
          offer,
          refusal,
          refusedAt: new Date(refused.metadata.createdAt),
          status,
          statusReadAt: dataUpdatedAt,
        })
      : undefined;
  const noticeKey = notice && refused ? `${refused.id}:${notice.kind}` : null;

  const act = (kind: BillingNoticeAction) => {
    switch (kind) {
      case "choose-plan": {
        openPlanSheet({ preselect: trialPlan ?? undefined });
        break;
      }
      case "contact-support": {
        openLink(SUPPORT_URL);
        break;
      }
      case "continue": {
        setDismissedNotice(noticeKey);
        onContinue?.();
        break;
      }
      case "update-card": {
        portal.mutate(undefined);
        break;
      }
      case "upgrade": {
        openPlanSheet({ preselect: upgradePlan(offer, status)?.key });
        break;
      }
      default: {
        kind satisfies never;
      }
    }
  };

  if (notice && noticeKey !== dismissedNotice) {
    const copy = noticeCopy(notice, now);
    const isGood = notice.kind === "resumed";
    // Laid out against its own width: beside a narrow chat the button drops
    // under the words rather than squeezing them into a column.
    return (
      <div className="@container mb-1.5">
        <div
          className="flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-xl bg-muted/60 py-2 pr-1.5 pl-3"
          data-billing-notice={notice.kind}
          role="status"
        >
          {isGood ? (
            <CheckCircleIcon className="size-4 shrink-0 text-brand-600 dark:text-brand-300" />
          ) : (
            <PauseCircleIcon className="size-4 shrink-0 text-warning-700 dark:text-warning-300" />
          )}
          <div className="min-w-0 flex-1 @max-md:basis-[calc(100%-4rem)]">
            <div className="text-[13px] font-medium text-foreground">
              {copy.title}
            </div>
            <div className="text-xs text-muted-foreground">{copy.line}</div>
          </div>
          {copy.action && (
            <Button
              className="shrink-0 @max-md:order-last @max-md:ml-6.5"
              disabled={copy.action.kind === "update-card" && portal.isPending}
              onClick={() => {
                if (copy.action) {
                  act(copy.action.kind);
                }
              }}
              size="sm"
              variant={isGood ? "brand" : "default"}
            >
              {copy.action.label}
            </Button>
          )}
          <DismissButton
            onDismiss={() => {
              setDismissedNotice(noticeKey);
            }}
          />
        </div>
      </div>
    );
  }

  const warning = usageWarning(isSignedIn ? status : undefined);
  if (!warning || warning.key === dismissedWarning) {
    return null;
  }
  const canGoUp =
    warning.kind === "trial" || upgradePlan(offer, status) !== undefined;
  return (
    <div
      className="mb-1.5 flex items-center gap-2 rounded-xl bg-muted/60 py-1 pr-1 pl-3 text-xs text-muted-foreground"
      data-billing-usage-warning={warning.kind}
      role="status"
    >
      <GaugeIcon className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        {usageWarningText(warning, now)}
      </span>
      {canGoUp && (
        <Button
          className="h-auto shrink-0 p-0 text-xs font-medium text-foreground"
          onClick={() => {
            openPlanSheet({
              preselect:
                warning.kind === "trial"
                  ? undefined
                  : upgradePlan(offer, status)?.key,
            });
          }}
          variant="link"
        >
          See plans
        </Button>
      )}
      <DismissButton
        onDismiss={() => {
          setDismissedWarning(warning.key);
        }}
      />
    </div>
  );
}

function DismissButton({ onDismiss }: { onDismiss: () => void }) {
  return (
    <button
      aria-label="Dismiss"
      className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={onDismiss}
      type="button"
    >
      <XIcon className="size-3.5" />
    </button>
  );
}
