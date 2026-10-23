import { AddProviderForm } from "@/client/components/add-provider/form";
import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { BrandMark } from "@/client/components/brand-mark";
import { BrowserHandoffButton } from "@/client/components/browser-handoff-button";
import { ClaudeSignInCode } from "@/client/components/claude-sign-in-code";
import { StateArrival } from "@/client/components/state-arrival";
import {
  claudeWaitingLine,
  grokWaitingLine,
} from "@/client/components/connect-button";
import { TermsFooter } from "@/client/components/terms-footer";
import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import {
  useChatGPTConnect,
  useClaudeConnect,
  useGrokConnect,
  useInstrumentConnect,
} from "@/client/hooks/use-connect";
import { type ConnectFlow } from "@/client/hooks/use-connect-flow";
import {
  CONNECT_NAMES,
  CONNECT_PLANS,
  connectPageCopy,
  instrumentWayCopy,
  noCreditsPageCopy,
  type WaitingStage,
  waitingPageCopy,
} from "@/client/lib/connect-copy";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import {
  type ConnectOutcome,
  type ConnectProvider,
} from "@/shared/connect-outcome";
import { type AIProviderConfigId, APP_NAME } from "@instrument-org/shared";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise";
import { ClockIcon } from "@phosphor-icons/react/Clock";
import { WarningIcon } from "@phosphor-icons/react/Warning";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { FcGoogle } from "react-icons/fc";

import { noteConnectedWay } from "../connected-way";
import { BrandTile } from "../kit/brand-tile";
import { SetupPageSwitch } from "../kit/setup-page-switch";
import { SetupFooter, SetupPage } from "../kit/setup-page";
import { SetupRow, SetupRowList } from "../kit/setup-row";

type PlanProvider = Exclude<ConnectProvider, "instrument">;

const PLAN_PROVIDERS: PlanProvider[] = ["chatgpt", "claude", "grok"];

/** A page of the ways in. Kept in the step's own state, never saved. */
export type WaysInPage =
  | { kind: "key" }
  /** An OpenRouter key just added, on an account with nothing to spend. */
  | { kind: "no-credits"; providerId: AIProviderConfigId }
  | { kind: "outcome"; outcome: ConnectOutcome; provider: ConnectProvider }
  | { kind: "subscriptions" }
  | {
      kind: "waiting";
      /** A Grok code to show before xAI hands one out (a preview). */
      previewCode?: string;
      provider: PlanProvider;
    }
  /** The ways in, setup's first page of them. */
  | { kind: "ways" };

type Offer = RPCOutput["billing"]["offer"];

/**
 * Every way to bring AI to setup: Google's Instrument account (with its
 * trial), a ChatGPT, Claude or Grok subscription, or an API key, with the
 * wait while a sign-in is in the browser and the page for each answer that
 * isn't ready. Sign-in runs through the shared connect flows and its words
 * come from `connect-copy`; this only draws them. Any sign-in keeps the step
 * on screen (`hold`), so an account that connects and then turns out to have
 * no plan still lands on its answer here.
 *
 * The way-in step opens it on the ways; the plan step opens it on the
 * subscriptions or the key, for "Use it instead" while no free trial can
 * start, where Google is already done.
 */
export function WaysIn({
  hold,
  initial,
  offerInstrument,
  onDone,
  onLeave,
}: {
  hold: () => void;
  initial: WaysInPage;
  /** Signed out: Google and its trial are offered beside the rest. */
  offerInstrument: boolean;
  /** A way in is ready (or out of usage and kept), or a key was added. */
  onDone: () => void;
  /** Back from the first page, for a step with a page of its own before. */
  onLeave?: () => void;
}) {
  const flows = {
    chatgpt: useChatGPTConnect(),
    claude: useClaudeConnect(),
    grok: useGrokConnect(),
    instrument: useInstrumentConnect(),
  };
  const [page, setPage] = useState<WaysInPage>(initial);
  // Where Back and Cancel return to from a sign-in's wait.
  const [waitedFrom, setWaitedFrom] = useState<WaysInPage>(initial);
  const { data: offer } = useQuery(rpcClient.billing.offer.queryOptions());

  const connect = (provider: ConnectProvider) => {
    // One sign-in at a time: the browser has room for one.
    for (const other of Object.keys(flows) as ConnectProvider[]) {
      if (other !== provider) {
        flows[other].cancel();
      }
    }
    hold();
    const from = page.kind === "waiting" ? waitedFrom : page;
    setWaitedFrom(from);
    if (provider !== "instrument") {
      setPage({ kind: "waiting", provider });
    }
    void flows[provider].start().then((result) => {
      if (!result) {
        return;
      }
      const { outcome } = result;
      if (outcome.kind === "canceled") {
        setPage(from);
      } else if (outcome.kind === "ready") {
        noteConnectedWay({ kind: "sign-in", provider });
        onDone();
      } else {
        setPage({ kind: "outcome", outcome, provider });
      }
    });
  };

  // Where Back returns to from the key page.
  const [keyFrom, setKeyFrom] = useState<WaysInPage>(initial);
  const openKey = () => {
    hold();
    setKeyFrom(page);
    setPage({ kind: "key" });
  };

  const leaveWait = (provider: PlanProvider) => {
    flows[provider].cancel();
    setPage(waitedFrom);
  };

  const shown = (): ReactNode => {
    switch (page.kind) {
      case "ways": {
        return (
          <WaysPage
            google={flows.instrument}
            onGoogle={() => {
              connect("instrument");
            }}
            onKey={openKey}
            onSubscription={() => {
              setPage({ kind: "subscriptions" });
            }}
          />
        );
      }
      case "subscriptions": {
        return (
          <SubscriptionsPage
            offerInstrument={offerInstrument}
            onBack={
              initial.kind === "subscriptions"
                ? onLeave
                : () => {
                    setPage({ kind: "ways" });
                  }
            }
            onSignIn={connect}
          />
        );
      }
      case "waiting": {
        const { provider } = page;
        const flow = flows[provider];
        const claudeStatus = flows.claude.status;
        const line =
          flow.phase === "checking"
            ? `Checking your ${CONNECT_NAMES[provider]} plan`
            : provider === "grok"
              ? grokWaitingLine(flows.grok.userCode ?? page.previewCode)
              : provider === "claude" &&
                  (claudeStatus?.install?.state === "downloading" ||
                    claudeStatus?.finishing)
                ? claudeWaitingLine(claudeStatus)
                : `Waiting for ${CONNECT_NAMES[provider]}…`;
        const stage: WaitingStage =
          provider === "claude" &&
          claudeStatus?.install?.state === "downloading"
            ? "preparing"
            : flow.phase === "checking" ||
                (provider === "claude" && claudeStatus?.finishing)
              ? "back"
              : "browser";
        const claudeLink =
          provider === "claude" &&
          flows.claude.phase === "signing-in" &&
          flows.claude.status?.signingIn
            ? flows.claude.status.signInLink
            : undefined;
        return (
          <WaitingPage
            below={
              claudeLink && (
                <ClaudeSignInCode
                  className="mt-4 w-100 text-center"
                  link={claudeLink}
                />
              )
            }
            line={line}
            onCancel={() => {
              leaveWait(provider);
            }}
            provider={provider}
            stage={stage}
          />
        );
      }
      case "outcome": {
        return (
          <OutcomePage
            flows={flows}
            offer={offer}
            offerInstrument={offerInstrument}
            onBack={() => {
              setPage(waitedFrom);
            }}
            onConnect={connect}
            onContinue={() => {
              noteConnectedWay({ kind: "sign-in", provider: page.provider });
              onDone();
            }}
            onKey={openKey}
            outcome={page.outcome}
            provider={page.provider}
          />
        );
      }
      case "key": {
        return (
          <KeyPage
            onAdded={(providerConfigId) => {
              if (providerConfigId) {
                noteConnectedWay({ kind: "key", providerConfigId });
              }
              onDone();
            }}
            onBack={
              keyFrom.kind === "key" && onLeave
                ? onLeave
                : () => {
                    setPage(keyFrom);
                  }
            }
            onNoCredits={(providerId) => {
              setPage({ kind: "no-credits", providerId });
            }}
          />
        );
      }
      case "no-credits": {
        return (
          <NoCreditsPage
            flows={flows}
            offer={offer}
            offerInstrument={offerInstrument}
            onBack={() => {
              setPage({ kind: "key" });
            }}
            onConnect={connect}
            onCredited={() => {
              noteConnectedWay({
                kind: "key",
                providerConfigId: page.providerId,
              });
              onDone();
            }}
            providerId={page.providerId}
          />
        );
      }
    }
  };
  return (
    <SetupPageSwitch depth={WAYS_IN_DEPTH[page.kind]} page={page.kind}>
      {shown()}
    </SetupPageSwitch>
  );
}

/** How far into the ways in each page is, so going to a shallower one reads as Back. */
const WAYS_IN_DEPTH: Record<WaysInPage["kind"], number> = {
  key: 1,
  "no-credits": 2,
  outcome: 3,
  subscriptions: 1,
  waiting: 2,
  ways: 0,
};

/**
 * How the person brings AI: Google, a subscription they pay for, or a key.
 * Welcome is on the folder step before it, so this page goes straight to
 * the question.
 */
function WaysPage({
  google,
  onGoogle,
  onKey,
  onSubscription,
}: {
  google: ConnectFlow<void>;
  onGoogle: () => void;
  onKey: () => void;
  onSubscription: () => void;
}) {
  const line = google.waiting
    ? "Finish signing in with Google in your browser."
    : undefined;
  return (
    <SetupPage
      align="center"
      footer={<TermsFooter className="px-8 pt-5 pb-6" />}
      subtitle="Sign in with Google, or use a subscription or key you already pay for."
      title="How would you like to use AI?"
    >
      <div className="mt-10 flex w-95 max-w-full flex-col gap-3">
        <BrowserHandoffButton
          className="h-10 w-full text-base"
          icon={<FcGoogle className="size-4" />}
          onCancel={google.cancel}
          onStart={onGoogle}
          variant="default"
          waiting={google.waiting}
        >
          Continue with Google
        </BrowserHandoffButton>
        <Button
          className="h-10 w-full bg-white/30 text-base text-foreground dark:bg-white/5"
          disabled={google.waiting}
          onClick={onSubscription}
          variant="outline"
        >
          <span className="flex items-center gap-1.5">
            {PLAN_PROVIDERS.map((provider) => (
              <SubscriptionMark
                className="size-4"
                key={provider}
                provider={provider}
              />
            ))}
          </span>
          Use an existing subscription
        </Button>
      </div>
      {line && (
        <p className="mt-3 text-center text-xs text-muted-foreground">{line}</p>
      )}
      <Button
        className="mt-3 h-9 px-5 text-muted-foreground"
        disabled={google.waiting}
        onClick={onKey}
        variant="ghost"
      >
        Or add an API provider manually
      </Button>
    </SetupPage>
  );
}

function SubscriptionsPage({
  offerInstrument,
  onBack,
  onSignIn,
}: {
  offerInstrument: boolean;
  onBack?: () => void;
  onSignIn: (provider: PlanProvider) => void;
}) {
  return (
    <SetupPage
      footer={<SetupFooter next="none" onBack={onBack} />}
      subtitle={
        offerInstrument
          ? `${APP_NAME} will use it for AI. You'll sign in on their site, and you'll have the option to add a free ${APP_NAME} account after that.`
          : `${APP_NAME} will use it for AI. You'll sign in on their site.`
      }
      title="Which subscription do you have?"
    >
      <SetupRowList className="mt-7">
        {PLAN_PROVIDERS.map((provider) => (
          <SubscriptionRow
            key={provider}
            onSignIn={() => {
              onSignIn(provider);
            }}
            provider={provider}
          />
        ))}
      </SetupRowList>
    </SetupPage>
  );
}

/** A subscription in a list of ways in: its tile, its paid plans, Sign in. */
function SubscriptionRow({
  onSignIn,
  provider,
}: {
  onSignIn: () => void;
  provider: PlanProvider;
}) {
  return (
    <SetupRow
      end={
        <Button className="w-29" onClick={onSignIn}>
          Sign in
        </Button>
      }
      icon={
        <BrandTile size={40}>
          <SubscriptionMark provider={provider} />
        </BrandTile>
      }
      inList
      line={CONNECT_PLANS[provider]}
      title={CONNECT_NAMES[provider]}
    />
  );
}

/**
 * A subscription's sign-in, from Claude Code getting ready through the browser
 * to its plan being checked, the title and the line under it settling in anew
 * at each stage.
 */
function WaitingPage({
  below,
  line,
  onCancel,
  provider,
  stage,
}: {
  below?: ReactNode;
  line: ReactNode;
  onCancel: () => void;
  provider: PlanProvider;
  stage: WaitingStage;
}) {
  const copy = waitingPageCopy(provider, stage);
  return (
    <SetupPage
      align="center"
      footer={<SetupFooter next="off" onBack={onCancel} />}
      hero={
        <BrandTile>
          <SubscriptionMark provider={provider} />
        </BrandTile>
      }
      subtitle={
        <StateArrival as="span" className="block" ring={false} state={stage}>
          {copy.subtitle}
        </StateArrival>
      }
      title={
        <StateArrival as="span" className="block" ring={false} state={stage}>
          {copy.title}
        </StateArrival>
      }
    >
      <div className="mt-8 flex max-w-130 items-center gap-3 text-sm text-muted-foreground">
        <Spinner className="size-4 shrink-0" delay={0} />
        <span data-waiting-line>{line}</span>
        <Button className="h-7.5 px-4 text-xs" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {below}
    </SetupPage>
  );
}

/**
 * How a sign-in ended when it isn't ready: the way in's mark with what went
 * wrong, the shared words, a row for each other way still open, and links
 * to a key and to trying again. Out of usage keeps the account and goes on.
 */
function OutcomePage({
  flows,
  offer,
  offerInstrument,
  onBack,
  onConnect,
  onContinue,
  onKey,
  outcome,
  provider,
}: {
  flows: Record<ConnectProvider, ConnectFlow<void>>;
  offer: Offer | undefined;
  offerInstrument: boolean;
  onBack: () => void;
  onConnect: (provider: ConnectProvider) => void;
  onContinue: () => void;
  onKey: () => void;
  outcome: ConnectOutcome;
  provider: ConnectProvider;
}) {
  const copy = connectPageCopy(outcome, provider);
  const isOutOfUsage = outcome.kind === "out-of-usage";
  const retry =
    outcome.kind === "no-plan"
      ? `I've upgraded. Try ${CONNECT_NAMES[provider]} again`
      : outcome.kind === "out-of-usage" || outcome.kind === "sign-up-refused"
        ? undefined
        : `Try ${provider === "instrument" ? "Google" : CONNECT_NAMES[provider]} again`;
  return (
    <SetupPage
      align="center"
      footer={
        <SetupFooter
          next={isOutOfUsage ? "quiet" : "none"}
          onBack={onBack}
          onContinue={onContinue}
        />
      }
      hero={
        <BrandTile
          badge={
            isOutOfUsage ? (
              <ClockIcon weight="bold" />
            ) : (
              <WarningIcon weight="bold" />
            )
          }
        >
          {provider === "instrument" ? (
            <BrandMark className="size-10" />
          ) : (
            <SubscriptionMark provider={provider} />
          )}
        </BrandTile>
      }
      subtitle={copy?.subtitle}
      title={copy?.title}
    >
      <OtherWays
        flows={flows}
        instrumentLabel={outcome.kind === "no-plan" ? "Learn more" : undefined}
        offer={offer}
        offerInstrument={offerInstrument && provider !== "instrument"}
        onConnect={onConnect}
        providers={PLAN_PROVIDERS.filter((other) => other !== provider)}
      />
      <OutcomeLinks
        keyLabel="Use your own API key"
        onKey={onKey}
        retry={
          retry
            ? {
                label: retry,
                onClick: () => {
                  onConnect(provider);
                },
              }
            : undefined
        }
      />
    </SetupPage>
  );
}

/**
 * An OpenRouter key whose account has nothing to spend: every other way in,
 * another key, and a check again once credits are added.
 */
function NoCreditsPage({
  flows,
  offer,
  offerInstrument,
  onBack,
  onConnect,
  onCredited,
  providerId,
}: {
  flows: Record<ConnectProvider, ConnectFlow<void>>;
  offer: Offer | undefined;
  offerInstrument: boolean;
  /** Back to the key page, also "Use a different API key". */
  onBack: () => void;
  onConnect: (provider: ConnectProvider) => void;
  onCredited: () => void;
  providerId: AIProviderConfigId;
}) {
  const [check, setCheck] = useState<"checking" | "idle" | "still-none">(
    "idle",
  );
  const noCreditsCopy = noCreditsPageCopy();
  const checkAgain = async () => {
    setCheck("checking");
    if (await hasNoCredits(providerId)) {
      setCheck("still-none");
    } else {
      onCredited();
    }
  };
  return (
    <SetupPage
      align="center"
      footer={<SetupFooter next="none" onBack={onBack} />}
      hero={
        <BrandTile badge={<WarningIcon weight="bold" />}>
          <AIProviderIcon colored type="openrouter" />
        </BrandTile>
      }
      subtitle={noCreditsCopy.subtitle}
      title={noCreditsCopy.title}
    >
      <OtherWays
        flows={flows}
        offer={offer}
        offerInstrument={offerInstrument}
        onConnect={onConnect}
        providers={PLAN_PROVIDERS}
      />
      <OutcomeLinks
        keyLabel="Use a different API key"
        onKey={onBack}
        retry={{
          busy: check === "checking",
          label: "I've added credits. Try again",
          onClick: () => {
            void checkAgain();
          },
        }}
      />
      {check === "still-none" && (
        <p className="mt-2 text-sm text-muted-foreground">
          OpenRouter still shows no credits. It can take a minute for new ones
          to show up.
        </p>
      )}
    </SetupPage>
  );
}

/**
 * The ways in still open, as rows in one card: Instrument with its trial
 * when the offer has one (and this account isn't signed in yet), then each
 * subscription.
 */
function OtherWays({
  flows,
  instrumentLabel,
  offer,
  offerInstrument,
  onConnect,
  providers,
}: {
  flows: Record<ConnectProvider, ConnectFlow<void>>;
  /** What Instrument's button says while a trial can start. */
  instrumentLabel?: string;
  offer: Offer | undefined;
  offerInstrument: boolean;
  onConnect: (provider: ConnectProvider) => void;
  providers: PlanProvider[];
}) {
  const instrument = instrumentWayCopy(offer);
  return (
    <SetupRowList className="mt-8">
      {offerInstrument && (
        <SetupRow
          end={
            <BrowserHandoffButton
              className="px-5"
              onCancel={flows.instrument.cancel}
              onStart={() => {
                onConnect("instrument");
              }}
              variant="brand"
              waiting={flows.instrument.waiting}
            >
              {instrument.isTrial
                ? (instrumentLabel ?? instrument.action)
                : instrument.action}
            </BrowserHandoffButton>
          }
          icon={<BrandMark className="size-12 shrink-0" />}
          inList
          line={instrument.line}
          title={instrument.title}
        />
      )}
      {providers.map((provider) => (
        <SubscriptionRow
          key={provider}
          onSignIn={() => {
            onConnect(provider);
          }}
          provider={provider}
        />
      ))}
    </SetupRowList>
  );
}

/** Under the rows: another key, and trying the same way in again. */
function OutcomeLinks({
  keyLabel,
  onKey,
  retry,
}: {
  keyLabel: string;
  onKey: () => void;
  retry?: { busy?: boolean; label: string; onClick: () => void };
}) {
  return (
    <div className="mt-4 flex items-center text-muted-foreground">
      <Button
        className="h-9 px-5 text-muted-foreground"
        onClick={onKey}
        variant="ghost"
      >
        {keyLabel}
      </Button>
      {retry && (
        <>
          <span aria-hidden className="text-sm text-gray-400">
            ·
          </span>
          <Button
            className="h-9 px-5 text-muted-foreground"
            disabled={retry.busy}
            onClick={retry.onClick}
            variant="ghost"
          >
            {retry.busy ? <Spinner delay={0} /> : <ArrowClockwiseIcon />}
            {retry.label}
          </Button>
        </>
      )}
    </div>
  );
}

/** Whether an OpenRouter config's key has nothing left to spend. */
async function hasNoCredits(providerId: AIProviderConfigId) {
  const result = await rpcClient.providerConfig.credits
    .call({ id: providerId })
    .catch(() => undefined);
  return result !== undefined && result.credits.remaining <= 0;
}

/**
 * The key way in: the app's Add a provider form, with OpenRouter's browser
 * sign-in inside it. A key the provider accepts ends the step, unless it's
 * an OpenRouter key on an account with no credits.
 */
function KeyPage({
  onAdded,
  onBack,
  onNoCredits,
}: {
  /** The key added, by its config, when the list says which it is. */
  onAdded: (providerConfigId?: AIProviderConfigId) => void;
  onBack: () => void;
  onNoCredits: (providerId: AIProviderConfigId) => void;
}) {
  const { data: providers } = useQuery(
    rpcClient.providerConfig.live.list.experimental_liveOptions(),
  );
  // The configs from before this page, so the one the form adds is the new one.
  const [known, setKnown] = useState<Set<AIProviderConfigId>>();
  if (providers && !known) {
    setKnown(new Set(providers.map((provider) => provider.id)));
  }
  const added = async () => {
    const list = await rpcClient.providerConfig.list
      .call({})
      .catch(() => undefined);
    const fresh = known
      ? list?.find((provider) => !known.has(provider.id))
      : undefined;
    if (fresh?.type === "openrouter" && (await hasNoCredits(fresh.id))) {
      onNoCredits(fresh.id);
    } else {
      onAdded(fresh?.id);
    }
  };
  return (
    <SetupPage
      footer={<SetupFooter next="none" onBack={onBack} />}
      subtitle="Use a key from an AI company you already pay. They bill you directly."
      title="Add an AI provider"
    >
      <div className="mt-6 w-120 max-w-full">
        <AddProviderForm
          onSuccess={() => {
            void added();
          }}
          providers={providers ?? []}
          showTitle={false}
          submitLabel="Continue"
        />
      </div>
    </SetupPage>
  );
}

const SUBSCRIPTION_TYPES = {
  chatgpt: "chatgpt-account",
  claude: "claude-account",
  grok: "grok-account",
} as const;

/** A subscription's mark, in its brand's colors where it has them. */
function SubscriptionMark({
  className,
  provider,
}: {
  className?: string;
  provider: PlanProvider;
}) {
  return (
    <AIProviderIcon
      className={className}
      colored
      type={SUBSCRIPTION_TYPES[provider]}
    />
  );
}
