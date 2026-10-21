import { AddProviderForm } from "@/client/components/add-provider/form";
import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { BrandMark } from "@/client/components/brand-mark";
import { BrowserHandoffButton } from "@/client/components/browser-handoff-button";
import { ClaudeSignInCode } from "@/client/components/claude-sign-in-code";
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
import { CONNECT_NAMES, connectPageCopy } from "@/client/lib/connect-copy";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import {
  type ConnectOutcome,
  type ConnectProvider,
} from "@/shared/connect-outcome";
import { APP_NAME } from "@instrument-org/shared";
import { ClockIcon } from "@phosphor-icons/react/Clock";
import { WarningIcon } from "@phosphor-icons/react/Warning";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { FcGoogle } from "react-icons/fc";

import { SetupFooter, SetupPage } from "../kit/setup-page";
import { SetupRow } from "../kit/setup-row";
import { BrandTile, WayCard } from "../kit/way-card";

type PlanProvider = Exclude<ConnectProvider, "instrument">;

const PLAN_PROVIDERS: PlanProvider[] = ["chatgpt", "claude", "grok"];

/** The plans each subscription counts, as the subscription list says them. */
const SUBSCRIPTION_LINES: Record<PlanProvider, string> = {
  chatgpt: "Plus, Pro or another paid plan",
  claude: "Pro, Max or another paid plan",
  grok: "SuperGrok or X Premium+",
};

/** A page of the ways in. Kept in the step's own state, never saved. */
export type WaysInPage =
  | { kind: "key" }
  | { kind: "outcome"; outcome: ConnectOutcome; provider: ConnectProvider }
  | { kind: "subscriptions" }
  | {
      kind: "waiting";
      /** A Grok code to show before xAI hands one out (a preview). */
      previewCode?: string;
      provider: PlanProvider;
    }
  | { kind: "welcome" };

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
 * The way-in step opens it on Welcome; the plan step opens it on the
 * subscriptions, for "Use it instead", where Google is already done.
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

  switch (page.kind) {
    case "welcome": {
      return (
        <WelcomePage
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
                  setPage({ kind: "welcome" });
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
          onContinue={onDone}
          onKey={openKey}
          outcome={page.outcome}
          provider={page.provider}
        />
      );
    }
    case "key": {
      return (
        <KeyPage
          onAdded={onDone}
          onBack={() => {
            setPage(keyFrom);
          }}
        />
      );
    }
  }
}

/** The free trial's length, when the offer has one this account can start. */
function trialDays(offer: Offer | undefined) {
  const trial = offer?.trial;
  return trial && trial.available !== false && trial.mode !== "intro"
    ? { cardRequired: trial.cardRequired, days: trial.days }
    : undefined;
}

function WelcomePage({
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
      hero={<BrandMark className="size-24 drop-shadow-md" />}
      subtitle={`${APP_NAME} is a desktop app for doing your best work with AI. It works in your files and its own browser, and connects with all your favorite apps.`}
      title={`Welcome to ${APP_NAME}`}
    >
      <div className="mt-8 flex w-85 flex-col gap-2">
        <BrowserHandoffButton
          className="h-11 w-full text-base"
          icon={
            <span className="flex size-5 items-center justify-center rounded-full bg-white">
              <FcGoogle className="size-3.5" />
            </span>
          }
          onCancel={google.cancel}
          onStart={onGoogle}
          variant="brand"
          waiting={google.waiting}
        >
          Try for free with Google
        </BrowserHandoffButton>
        <Button
          className="h-11 w-full text-base"
          disabled={google.waiting}
          onClick={onSubscription}
          variant="default"
        >
          <span className="flex items-center gap-1">
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
      <button
        className="mt-8 text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        disabled={google.waiting}
        onClick={onKey}
        type="button"
      >
        Or add an API provider manually
      </button>
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
      <div className="mt-8 flex w-115 max-w-full flex-col gap-2">
        {PLAN_PROVIDERS.map((provider) => (
          <SetupRow
            end={
              <Button
                className="rounded-full px-4"
                onClick={() => {
                  onSignIn(provider);
                }}
                size="sm"
              >
                Sign in
              </Button>
            }
            icon={<SubscriptionMark provider={provider} />}
            key={provider}
            line={SUBSCRIPTION_LINES[provider]}
            title={CONNECT_NAMES[provider]}
          />
        ))}
      </div>
    </SetupPage>
  );
}

/** A subscription's sign-in, while the browser has it and while its plan is checked. */
function WaitingPage({
  below,
  line,
  onCancel,
  provider,
}: {
  below?: ReactNode;
  line: ReactNode;
  onCancel: () => void;
  provider: PlanProvider;
}) {
  const name = CONNECT_NAMES[provider];
  return (
    <SetupPage
      align="center"
      footer={<SetupFooter next="off" onBack={onCancel} />}
      hero={
        <BrandTile>
          <SubscriptionMark provider={provider} />
        </BrandTile>
      }
      subtitle={`We opened ${name} in your browser. ${APP_NAME} picks it up as soon as you're done.`}
      title={`Finish signing in to ${name}`}
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
 * wrong, the shared words, a card for each other way still open, and links
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
  const others = PLAN_PROVIDERS.filter((other) => other !== provider);
  const trial = trialDays(offer);
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
      <div className="mt-8 flex max-w-full items-stretch justify-center gap-3">
        {offerInstrument && provider !== "instrument" && (
          <WayCard
            icons={<BrandMark className="size-12" />}
            line={
              trial
                ? `Sign in with Google and get ${String(trial.days)} days free.${trial.cardRequired ? "" : " No card needed."}`
                : `Sign in with Google and choose a plan.`
            }
            title={trial ? `Try ${APP_NAME} free` : `Use ${APP_NAME}'s AI`}
          >
            <BrowserHandoffButton
              onCancel={flows.instrument.cancel}
              onStart={() => {
                onConnect("instrument");
              }}
              variant="brand"
              waiting={flows.instrument.waiting}
            >
              {trial ? "Start free trial" : "Continue with Google"}
            </BrowserHandoffButton>
          </WayCard>
        )}
        {others.map((other) => (
          <WayCard
            icons={
              <BrandTile size={40}>
                <SubscriptionMark provider={other} />
              </BrandTile>
            }
            key={other}
            line={`Works with a paid ${CONNECT_NAMES[other]} plan.`}
            title={`Use ${CONNECT_NAMES[other]} instead`}
          >
            <Button
              onClick={() => {
                onConnect(other);
              }}
            >
              Continue with {CONNECT_NAMES[other]}
            </Button>
          </WayCard>
        ))}
      </div>
      <p className="mt-6 flex items-center gap-3 text-sm text-muted-foreground">
        <LinkButton onClick={onKey}>Use your own API key</LinkButton>
        {retry && (
          <>
            <span aria-hidden>·</span>
            <LinkButton
              onClick={() => {
                onConnect(provider);
              }}
            >
              {retry}
            </LinkButton>
          </>
        )}
      </p>
    </SetupPage>
  );
}

function LinkButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className="hover:text-foreground hover:underline"
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

/**
 * The key way in: the app's Add a provider form, with OpenRouter's browser
 * sign-in inside it. A key the provider accepts ends the step.
 */
function KeyPage({
  onAdded,
  onBack,
}: {
  onAdded: () => void;
  onBack: () => void;
}) {
  const { data: providers } = useQuery(
    rpcClient.providerConfig.live.list.experimental_liveOptions(),
  );
  return (
    <SetupPage
      footer={<SetupFooter next="none" onBack={onBack} />}
      subtitle="Use a key from an AI company you already pay. They bill you directly."
      title="Add an AI provider"
    >
      <div className="mt-6 w-120 max-w-full">
        <AddProviderForm
          onSuccess={onAdded}
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
