import { openReportDialog } from "@/client/atoms/report-dialog";
import { openSettings } from "@/client/atoms/settings-modal";
import { ReplyNote, ReplyNoteButton } from "@/client/components/reply-note";
import { useBillingStatus } from "@/client/hooks/use-billing-status";
import {
  accountNotice,
  type BillingNotice,
  type BillingRefusal,
  isNoteDismissed,
  noteDismissalKey,
  noticeName,
  withNoteDismissed,
  featurePause,
  type NextStep,
  nextStepFor,
  type NoticeAction,
  refusalNotice,
  usageWarning,
  usageWarningText,
} from "@/client/lib/billing";
import {
  openAccount,
  openPlans,
  openWebsitePage,
} from "@/client/lib/billing-website";
import { keptAtom } from "@/client/lib/kept-state";
import { parsePlatformApiError } from "@/client/lib/parse-platform-api-error";
import { feedbackReport } from "@/client/lib/problem-reports";
import {
  hasUsageReturned,
  lastPlanAccountStop,
  planAccountNoteText,
  type PlanAccountStop,
} from "@/client/lib/plan-account-stop";
import { rpcClient } from "@/client/rpc/client";
import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import { OUR_MODELS } from "@instrument-org/shared";
import {
  type ChatId,
  type SessionMessage,
} from "@instrument-org/workspace/client";
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle";
import { GaugeIcon } from "@phosphor-icons/react/Gauge";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { ImageIcon } from "@phosphor-icons/react/Image";
import { WarningIcon } from "@phosphor-icons/react/Warning";
import { useQuery } from "@tanstack/react-query";
import { FcGoogle } from "react-icons/fc";
import { useInstrumentConnect } from "@/client/hooks/use-connect";
import { useAtom } from "jotai";
import { z } from "zod";
import { useEffect, useRef, useState } from "react";

/** The least time between the billing reads a finished turn makes. */
const TURN_END_READ_GAP_MS = 15_000;

/** The longest a note waits to redraw itself at a reset it names. */
const MAX_RESET_WAIT_MS = 24 * 60 * 60 * 1000;

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
 * When each note about something Instrument offers was last dismissed, by
 * `noteDismissalKey`: kept for the workspace, so a dismissal holds a week
 * across chats and launches.
 */
const dismissedNotesAtom = keptAtom<Record<string, number>>(
  "layout",
  "billing-notes-dismissed.v1",
  {},
  (value, initial) => {
    const parsed = z.record(z.string(), z.number()).safeParse(value);
    return parsed.success ? parsed.data : initial;
  },
);

/** What the reply box lends the note it draws: the flash a held send asks for, and its model picker. */
type ChatNoteContext = { nudge: number; openModelPicker: () => void };

/**
 * The note a chat has for its reply box about the account its model runs on.
 * `stop`: the next turn can't run, so a send is held and flashes the note.
 * `ready`: what stopped the chat has gone, and Continue sends the turn again.
 * `quiet`: worth knowing, and dismissible.
 * `holdsSend` is set only where the account as last read confirms the next
 * turn would be refused, so a note can never hold the box shut after the
 * trouble is fixed somewhere this app can't see.
 */
export type ChatNote = {
  holdsSend: boolean;
  rank: "quiet" | "ready" | "stop";
  render: (context: ChatNoteContext) => React.ReactNode;
};

/** The provider a model's address names, without needing the rest of it to parse. */
function providerOf(modelURI: AIGatewayModelURI.Type | undefined) {
  const query = modelURI?.split("?")[1];
  return query ? new URLSearchParams(query).get("provider") : null;
}

/**
 * The chat's one note about its account, for the reply box to draw above
 * itself. Only a chat whose model runs on that account gets one: a plan
 * Instrument refused, or one the status says the next turn would hit, shows
 * only while the chat is on Instrument's models, and a ChatGPT or Claude
 * plan's stop only while the chat is on that plan. Changing the model is
 * always a way out.
 */
export function useChatNote({
  chatId,
  isAgentRunning,
  messages,
  modelURI,
  onContinue,
}: {
  /** The chat a "Contact us" from the note sends feedback about. */
  chatId?: ChatId;
  isAgentRunning: boolean;
  messages: SessionMessage.WithParts[];
  modelURI: AIGatewayModelURI.Type | undefined;
  /** Sends the stopped turn again. */
  onContinue?: () => void;
}): ChatNote | undefined {
  const provider = providerOf(modelURI);
  const isOurs = provider === OUR_MODELS.providerType;
  const {
    data: status,
    dataUpdatedAt,
    isSignedIn,
    isSignedOut,
    refetch,
  } = useBillingStatus();
  // Whether a model on another connection could take a refused turn instead.
  const { data: modelsData } = useQuery(
    rpcClient.gateway.models.live.list.experimental_liveOptions(),
  );
  const hasOtherModel =
    modelsData?.models.some(
      (model) => model.params.provider !== OUR_MODELS.providerType,
    ) ?? false;
  const signIn = useInstrumentConnect();
  // When Start free trial sent the person to the website, so the trial
  // that starts there leads back into the chat.
  const [trialStartedAt, setTrialStartedAt] = useState<number>();
  const [dismissed, setDismissed] = useState<null | string>(null);
  const [dismissedWarning, setDismissedWarning] = useAtom(
    dismissedUsageWarningAtom,
  );
  const [dismissedNotes, setDismissedNotes] = useAtom(dismissedNotesAtom);
  const isOfferDismissed = (key: string) =>
    isNoteDismissed({
      blocksOwnSend: false,
      dismissedAt: dismissedNotes[key],
      now: Date.now(),
    });
  const dismissOffer = (key: string) => {
    setDismissedNotes((kept) => withNoteDismissed(kept, key, Date.now()));
  };

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
  const fromRefusal =
    refused && refusal
      ? refusalNotice({
          blocked: "models",
          now,
          refusal,
          refusedAt: new Date(refused.metadata.createdAt),
          status,
          statusReadAt: dataUpdatedAt,
        })
      : undefined;
  // A trial started from this note's button leads back into the chat once
  // the status has it running, whatever the stopped turn's record says.
  const startedTrial =
    trialStartedAt !== undefined &&
    status?.account.tier === "trial" &&
    status.account.state === "active"
      ? ({ after: "trial-started", kind: "resumed" } satisfies BillingNotice)
      : undefined;
  const billing = isOurs
    ? (fromRefusal ??
      (isSignedIn ? accountNotice(status) : undefined) ??
      startedTrial)
    : undefined;
  const planStop = lastPlanAccountStop({ isAgentRunning, messages });
  const plan =
    planStop && planStop.stop.provider === provider ? planStop : undefined;

  // A note that names a reset redraws itself once it passes, so "until 3:40
  // PM" turns into Continue without waiting on anything else to change.
  const resetsAt =
    billing?.kind === "blocked"
      ? billing.resetsAt
      : plan?.stop.kind === "usage-limit"
        ? plan.stop.resetsAt
        : undefined;
  const [, redraw] = useState(0);
  useEffect(() => {
    const wait = resetsAt ? resetsAt.getTime() - Date.now() : 0;
    if (wait <= 0 || wait > MAX_RESET_WAIT_MS) {
      return;
    }
    const timer = setTimeout(() => {
      redraw((count) => count + 1);
      void refetch();
    }, wait + 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [resetsAt, refetch]);

  const act = (action: NoticeAction) => {
    switch (action.kind) {
      case "choose-plan":
      case "upgrade": {
        openPlans(action.plan);
        break;
      }
      case "contact": {
        openReportDialog(feedbackReport({ chatId, surface: "usage-limit" }));
        break;
      }
      case "continue": {
        onContinue?.();
        break;
      }
      case "sign-in": {
        void signIn.start(undefined);
        break;
      }
      case "start-trial": {
        setTrialStartedAt(Date.now());
        openPlans(action.plan);
        break;
      }
      case "update-card": {
        openAccount();
        break;
      }
      case "website": {
        if (action.page) {
          openWebsitePage(action.page, action.plan);
        }
        break;
      }
      default: {
        action.kind satisfies never;
      }
    }
  };

  if (billing) {
    const key = `${refused?.id ?? (billing === startedTrial ? `trial:${trialStartedAt ?? 0}` : "account")}:${noticeName(billing)}`;
    const isReady = billing.kind === "resumed";
    if (!(isReady && dismissed === key)) {
      return {
        holdsSend:
          !isReady && isSignedIn && accountNotice(status) !== undefined,
        rank: isReady ? "ready" : "stop",
        render: (context) => (
          <BillingNote
            context={context}
            isReady={isReady}
            name={noticeName(billing)}
            onAct={(action) => {
              if (action.kind === "continue") {
                setDismissed(key);
                setTrialStartedAt(undefined);
              }
              act(action);
            }}
            onDismiss={
              isReady
                ? () => {
                    setDismissed(key);
                    setTrialStartedAt(undefined);
                  }
                : undefined
            }
            step={nextStepFor(
              {
                blocked: "models",
                notice: billing,
                otherModelCan: hasOtherModel,
                status,
              },
              now,
            )}
          />
        ),
      };
    }
  }

  if (plan) {
    const key = `${plan.messageId}:${plan.stop.kind}`;
    const isReady = hasUsageReturned(plan.stop, now);
    if (!(isReady && dismissed === key)) {
      // Whether a ChatGPT or Claude plan has room again is the provider's to
      // say, so the note never holds a send: the next turn is how to find out.
      return {
        holdsSend: false,
        rank: isReady ? "ready" : "stop",
        render: (context) => (
          <PlanAccountNote
            context={context}
            isReady={isReady}
            now={now}
            onContinue={() => {
              setDismissed(key);
              onContinue?.();
            }}
            onDismiss={() => {
              setDismissed(key);
            }}
            stop={plan.stop}
          />
        ),
      };
    }
  }

  // An image nothing connected could make, or that Instrument refused, in
  // any chat whatever its model: the free account, or what the account can
  // do about its plan. The image never stopped the chat, so the note holds
  // nothing back and can be set aside.
  const image = refused ? imageBlock(messages) : undefined;
  const imageNotice: BillingNotice | undefined =
    image?.kind === "sign-in"
      ? isSignedOut
        ? { kind: "sign-in" }
        : undefined
      : image && refused
        ? refusalNotice({
            blocked: "images",
            now,
            refusal: image.refusal,
            refusedAt: new Date(refused.metadata.createdAt),
            status,
            statusReadAt: dataUpdatedAt,
          })
        : undefined;
  const imageKey =
    imageNotice && refused && `${refused.id}:image:${noticeName(imageNotice)}`;
  // Dismissing an offer holds a week for the reason, across chats; a ready
  // note goes for this turn alone.
  const imageOffer =
    imageNotice && imageNotice.kind !== "resumed"
      ? noteDismissalKey("images", noticeName(imageNotice))
      : undefined;
  if (
    imageNotice &&
    imageKey &&
    dismissed !== imageKey &&
    !(imageOffer && isOfferDismissed(imageOffer))
  ) {
    const isReady = imageNotice.kind === "resumed";
    return {
      holdsSend: false,
      rank: isReady ? "ready" : "quiet",
      render: (context) => (
        <BillingNote
          context={context}
          icon={isReady ? undefined : ImageIcon}
          isBusy={signIn.waiting}
          isReady={isReady}
          quiet
          name={noticeName(imageNotice)}
          onAct={(action) => {
            if (action.kind === "continue") {
              setDismissed(imageKey);
            }
            act(action);
          }}
          onDismiss={() => {
            if (imageOffer) {
              dismissOffer(imageOffer);
            } else {
              setDismissed(imageKey);
            }
          }}
          step={nextStepFor(
            {
              blocked: "images",
              notice: imageNotice,
              otherModelCan: false,
              status,
            },
            now,
          )}
        />
      ),
    };
  }

  // A search our endpoint refused while the free allowance is spent ran on
  // another search instead (a basic one, or the model's own provider's); the
  // chat says so quietly, until the reset.
  const searchPause = isSignedIn
    ? lastSearchPause(messages, status, now)
    : undefined;
  const searchOffer = noteDismissalKey("search", "paused");
  if (searchPause && !isOfferDismissed(searchOffer)) {
    return {
      holdsSend: false,
      rank: "quiet",
      render: (context) => (
        <BillingNote
          context={context}
          icon={MagnifyingGlassIcon}
          isReady={false}
          name="limit-reached"
          onAct={act}
          onDismiss={() => {
            dismissOffer(searchOffer);
          }}
          quiet
          step={nextStepFor(
            {
              blocked: "search",
              notice: {
                kind: "blocked",
                ...(searchPause.next && { next: searchPause.next }),
                outcome: "limit-reached",
                refused: true,
                ...(searchPause.resetsAt && { resetsAt: searchPause.resetsAt }),
              },
              otherModelCan: false,
              status,
            },
            now,
          )}
        />
      ),
    };
  }

  const warning = isOurs
    ? usageWarning(isSignedIn ? status : undefined)
    : undefined;
  if (!warning || warning.key === dismissedWarning) {
    return undefined;
  }
  const upgradeTo = status?.account.upgradeTo;
  const canGoUp = warning.kind === "trial" || upgradeTo !== undefined;
  return {
    holdsSend: false,
    rank: "quiet",
    render: () => (
      <ReplyNote
        action={
          canGoUp && (
            <ReplyNoteButton
              onClick={() => {
                openPlans(warning.kind === "trial" ? undefined : upgradeTo);
              }}
            >
              See plans
            </ReplyNoteButton>
          )
        }
        data-billing-usage-warning={warning.kind}
        icon={GaugeIcon}
        onDismiss={() => {
          setDismissedWarning(warning.key);
        }}
        tone="neutral"
      >
        {usageWarningText(warning, now)}
      </ReplyNote>
    ),
  };
}

/**
 * A note about Instrument's account: what `nextStep` says and the way
 * forward it offers, and Change model beside it where another model could do
 * the job. A ready one, or one that asks nothing of the chat (signing in),
 * is neutral; the rest are a warning.
 */
function BillingNote({
  context,
  icon,
  isBusy = false,
  isReady,
  name,
  onAct,
  onDismiss,
  quiet = false,
  step,
}: {
  context: ChatNoteContext;
  icon?: typeof WarningIcon;
  /** A sign-in under way, which holds its button. */
  isBusy?: boolean;
  isReady: boolean;
  /** What the note is about (`noticeName`), for tests and the debug pages to find it by. */
  name: string;
  onAct: (action: NoticeAction) => void;
  onDismiss?: () => void;
  /**
   * Something that stopped on its own while the chat goes on (an image, a
   * search): neutral, never the warning a stopped chat gets.
   */
  quiet?: boolean;
  step: NextStep;
}) {
  const { action } = step;
  return (
    <ReplyNote
      action={
        <>
          {action && (
            <ReplyNoteButton
              disabled={action.kind === "sign-in" && isBusy}
              emphasis={
                action.kind === "continue" ||
                action.kind === "choose-plan" ||
                action.kind === "sign-in" ||
                action.kind === "start-trial" ||
                action.kind === "update-card" ||
                action.kind === "website"
              }
              onClick={() => {
                onAct(action);
              }}
            >
              {action.kind === "sign-in" && (
                <FcGoogle className="size-3.5 rounded-full bg-white p-px" />
              )}
              {action.label}
            </ReplyNoteButton>
          )}
          {step.changeModel && (
            <ReplyNoteButton onClick={context.openModelPicker}>
              Change model
            </ReplyNoteButton>
          )}
        </>
      }
      data-billing-notice={name}
      icon={icon ?? (isReady ? CheckCircleIcon : WarningIcon)}
      nudge={context.nudge}
      onDismiss={onDismiss}
      tone={isReady || quiet ? "neutral" : "warn"}
    >
      <span className="font-medium">{step.title}</span>
      {step.line && ` ${step.line}`}
    </ReplyNote>
  );
}

/**
 * A stop the person's own ChatGPT or Claude plan made: when its usage comes
 * back, with its usage in Settings and Change model beside it, then Continue
 * once it has.
 */
function PlanAccountNote({
  context,
  isReady,
  now,
  onContinue,
  onDismiss,
  stop,
}: {
  context: ChatNoteContext;
  isReady: boolean;
  now: Date;
  onContinue: () => void;
  onDismiss: () => void;
  stop: PlanAccountStop;
}) {
  const text = planAccountNoteText(stop, now);
  if (isReady) {
    return (
      <ReplyNote
        action={
          <ReplyNoteButton emphasis onClick={onContinue}>
            Continue
          </ReplyNoteButton>
        }
        data-plan-account-note="usage-returned"
        icon={CheckCircleIcon}
        onDismiss={onDismiss}
        tone="neutral"
      >
        <span className="font-medium">{text}</span>
      </ReplyNote>
    );
  }
  return (
    <ReplyNote
      action={
        <>
          {stop.kind === "usage-limit" && (
            <ReplyNoteButton
              onClick={() => {
                openSettings(
                  stop.provider === "claude-account"
                    ? {
                        providerUsage: "claude-account",
                        setting: "claude-account",
                        tab: "Providers",
                      }
                    : { setting: stop.provider, tab: "Providers" },
                );
              }}
            >
              See usage
            </ReplyNoteButton>
          )}
          <ReplyNoteButton onClick={context.openModelPicker}>
            Change model
          </ReplyNoteButton>
        </>
      }
      data-plan-account-note={stop.kind}
      icon={WarningIcon}
      nudge={context.nudge}
      tone="warn"
    >
      <span className="font-medium">{text}</span>
    </ReplyNote>
  );
}

/**
 * The pause behind the conversation's last turn's web search, when our
 * endpoint refused it for the spent free allowance and the status still says
 * search is paused (or has not said, and the refusal's reset is ahead), with
 * the way past it the platform gave.
 */
function lastSearchPause(
  messages: SessionMessage.WithParts[],
  status: Parameters<typeof featurePause>[0],
  now: Date,
) {
  const refusal = lastTurnParts(messages)
    .map((part) =>
      part.type === "tool-web_search" &&
      part.state === "output-available" &&
      part.output.state === "success"
        ? part.output.platformRefusal
        : undefined,
    )
    .findLast((found) => found?.code === "usage-limit-exceeded");
  if (!refusal) {
    return undefined;
  }
  const refusedUntil = refusal.resetsAt
    ? new Date(refusal.resetsAt)
    : undefined;
  const pause = status
    ? featurePause(status, "search", now)
    : refusedUntil && refusedUntil > now
      ? { next: refusal.next, resetsAt: refusedUntil }
      : undefined;
  if (!pause) {
    return undefined;
  }
  const next = pause.next ?? refusal.next;
  return { ...(next && { next }), resetsAt: pause.resetsAt };
}

/**
 * What the last turn's last image call ran into: nothing connected that
 * makes images (`sign-in`, since an account would), or Instrument's refusal
 * for the plan. The turn is every reply since the last thing the person said.
 */
function imageBlock(
  messages: SessionMessage.WithParts[],
):
  | { kind: "refused"; refusal: BillingRefusal }
  | { kind: "sign-in" }
  | undefined {
  const part = lastTurnParts(messages).findLast(
    (candidate) => candidate.type === "tool-generate_image",
  );
  if (
    part?.type !== "tool-generate_image" ||
    part.state !== "output-available" ||
    part.output.state !== "failure"
  ) {
    return undefined;
  }
  if (part.output.errorType === "no-image-model") {
    return { kind: "sign-in" };
  }
  return part.output.errorType === "refused" && part.output.refusal
    ? { kind: "refused", refusal: part.output.refusal }
    : undefined;
}

/** The parts of the replies since the last thing the person said, in order. */
function lastTurnParts(messages: SessionMessage.WithParts[]) {
  const start = messages.findLastIndex((message) => message.role === "user");
  return messages.slice(start + 1).flatMap((message) => message.parts);
}
