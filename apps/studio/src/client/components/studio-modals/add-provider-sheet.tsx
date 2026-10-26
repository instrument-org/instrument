import { AddProviderForm } from "@/client/components/add-provider/form";
import { BrandMark } from "@/client/components/brand-mark";
import { BrowserHandoffButton } from "@/client/components/browser-handoff-button";
import { ClaudeSignInCode } from "@/client/components/claude-sign-in-code";
import {
  ConnectIcon,
  claudeWaitingLine,
  grokWaitingLine,
} from "@/client/components/connect-button";
import { type LastConnection } from "@/client/components/setup/last-connection";
import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import {
  useChatGPTConnect,
  useClaudeConnect,
  useGrokConnect,
  useInstrumentConnect,
} from "@/client/hooks/use-connect";
import {
  type ConnectFlow,
  type ConnectResult,
} from "@/client/hooks/use-connect-flow";
import {
  type PlanProvider,
  useConnectedPlans,
} from "@/client/hooks/use-connected-plans";
import {
  CONNECT_NAMES,
  CONNECT_PLANS,
  connectPageCopy,
  instrumentWayCopy,
  waitingPageCopy,
} from "@/client/lib/connect-copy";
import { showConnectToast } from "@/client/lib/connect-toast";
import {
  MAIN_MODEL_TITLE,
  MainModelList,
  useMainModelChoice,
} from "@/client/components/setup/steps/model";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  type ConnectOutcome,
  type ConnectProvider,
} from "@/shared/connect-outcome";
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle";
import { ClockIcon } from "@phosphor-icons/react/Clock";
import { KeyIcon } from "@phosphor-icons/react/Key";
import { WarningIcon } from "@phosphor-icons/react/Warning";
import { useQuery } from "@tanstack/react-query";
import { type AIProviderConfigId } from "@instrument-org/shared";
import { type ReactNode, useState } from "react";

const PLAN_PROVIDERS: PlanProvider[] = ["chatgpt", "claude", "grok"];

type View =
  | { kind: "answer"; outcome: ConnectOutcome; provider: ConnectProvider }
  | { kind: "key" }
  | { kind: "list" }
  /** A way in connected or a key was added: its main model, as setup asks it. */
  | { kind: "model"; connection?: LastConnection };

/**
 * The Add a provider sheet: the plans people already pay for (ChatGPT,
 * Claude, Grok) and an API key, with the ones already connected marked.
 * Each plan connects right in its row, through the same flow as setup; an
 * answer other than ready takes the sheet over, in setup's words, with the
 * other ways in beside it and a way to try again. Signed out of Instrument,
 * its free trial is offered too, and its Google sign-in hands the account
 * to what comes next (`onInstrumentSignedIn`). Once a plan connects, or a
 * key is added, the sheet asks for the main model the way setup does, which
 * is where the default for new chats changes.
 */
export function AddProviderSheet({
  onComplete,
  onDone,
  onInstrumentSignedIn,
}: {
  /** A way in connected, or a key was added. */
  onComplete: () => void;
  /** Closed without adding one. */
  onDone: () => void;
  /** Signed in to Instrument with Google. */
  onInstrumentSignedIn: (result: ConnectResult) => void;
}) {
  const flows = {
    chatgpt: useChatGPTConnect(),
    claude: useClaudeConnect(),
    grok: useGrokConnect(),
    instrument: useInstrumentConnect(),
  };
  const connected = useConnectedPlans();
  const { data: hasToken } = useQuery(
    rpcClient.auth.live.hasToken.experimental_liveOptions(),
  );
  const { data: providerConfigs } = useQuery(
    rpcClient.providerConfig.live.list.experimental_liveOptions(),
  );
  const [view, setView] = useState<View>({ kind: "list" });
  // The keys from before the key page, so the one the form adds is the new one.
  const [knownKeys, setKnownKeys] = useState<Set<AIProviderConfigId>>();
  const keyAdded = async () => {
    const list = await rpcClient.providerConfig.list
      .call({})
      .catch(() => undefined);
    const fresh = list?.find((config) => !knownKeys?.has(config.id));
    setView({
      kind: "model",
      connection: fresh && { kind: "key", providerConfigId: fresh.id },
    });
  };
  const openKey = () => {
    setKnownKeys(new Set(providerConfigs?.map((config) => config.id)));
    setView({ kind: "key" });
  };

  const settle = (provider: ConnectProvider, result: ConnectResult) => {
    const { outcome } = result;
    if (outcome.kind === "canceled") {
      return;
    }
    if (outcome.kind === "ready" && provider === "instrument") {
      onInstrumentSignedIn(result);
      return;
    }
    if (outcome.kind === "ready") {
      showConnectToast(result, provider);
      setView({ kind: "model", connection: { kind: "sign-in", provider } });
      return;
    }
    setView({ kind: "answer", outcome, provider });
  };
  const connect = (provider: ConnectProvider) => {
    // One sign-in at a time: the browser has room for one.
    for (const other of Object.keys(flows) as ConnectProvider[]) {
      if (other !== provider) {
        flows[other].cancel();
      }
    }
    void flows[provider].start().then((result) => {
      if (result) {
        settle(provider, result);
      }
    });
  };

  const rowFor = (provider: ConnectProvider, title?: string) => (
    <ConnectRow
      connected={provider !== "instrument" && (connected?.[provider] ?? false)}
      flow={flows[provider]}
      key={provider}
      onCancel={flows[provider].cancel}
      onStart={() => {
        connect(provider);
      }}
      provider={provider}
      title={title}
      waitingLine={waitingLineFor(provider, flows)}
      below={
        provider === "claude" &&
        flows.claude.phase === "signing-in" &&
        flows.claude.status?.signingIn &&
        flows.claude.status.signInLink && (
          <ClaudeSignInCode
            className="mt-2 pl-11"
            link={flows.claude.status.signInLink}
          />
        )
      }
    />
  );
  const trialRow = hasToken === false && rowFor("instrument");

  if (view.kind === "model") {
    return <ModelView connection={view.connection} onDone={onComplete} />;
  }

  // Back from the browser while the plan is checked: the sheet waits with
  // it, as setup does, rather than leaving the wait to one line in a row.
  const returning = PLAN_PROVIDERS.find(
    (provider) =>
      flows[provider].phase === "checking" ||
      (provider === "claude" &&
        flows.claude.phase === "signing-in" &&
        flows.claude.status?.finishing),
  );
  if (returning) {
    return (
      <ReturningView
        line={waitingLineFor(returning, flows)}
        onCancel={flows[returning].cancel}
        provider={returning}
      />
    );
  }

  if (view.kind === "key") {
    return (
      <div className="px-8 pt-8 pb-8">
        <AddProviderForm
          onBack={() => {
            setView({ kind: "list" });
          }}
          onSuccess={() => {
            void keyAdded();
          }}
          providers={providerConfigs ?? []}
          submitLabel="Add"
        />
      </div>
    );
  }

  if (view.kind === "answer") {
    const copy = connectPageCopy(view.outcome, view.provider);
    const retrying = flows[view.provider];
    return (
      <SheetFrame
        footer={
          <>
            <Button
              onClick={() => {
                setView({ kind: "list" });
              }}
              variant="ghost"
            >
              Back
            </Button>
            <BrowserHandoffButton
              onCancel={retrying.cancel}
              onStart={() => {
                connect(view.provider);
              }}
              waiting={retrying.waiting}
            >
              Try {CONNECT_NAMES[view.provider]} again
            </BrowserHandoffButton>
          </>
        }
      >
        <div className="flex flex-col items-center text-center">
          <AnswerMark outcome={view.outcome} provider={view.provider} />
          <h2 className="font-serif text-[22px] font-medium text-foreground">
            {copy?.title}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {retrying.waiting
              ? waitingLineFor(view.provider, flows)
              : copy?.subtitle}
          </p>
        </div>
        <div className="mt-6 w-full space-y-2">
          {PLAN_PROVIDERS.filter((provider) => provider !== view.provider).map(
            (provider) =>
              rowFor(provider, `Use ${CONNECT_NAMES[provider]} instead`),
          )}
          {view.provider !== "instrument" && trialRow}
          <KeyRow onAdd={openKey} />
        </div>
      </SheetFrame>
    );
  }

  return (
    <SheetFrame
      footer={
        <Button onClick={onDone} variant="outline">
          Done
        </Button>
      }
    >
      <h2 className="font-serif text-[22px] font-medium text-foreground">
        Add an AI provider
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Use a plan you already pay for, or a key from an AI company.
      </p>
      <div className="mt-6 space-y-2">
        {trialRow}
        {PLAN_PROVIDERS.map((provider) => rowFor(provider))}
        <KeyRow onAdd={openKey} />
      </div>
    </SheetFrame>
  );
}

/**
 * Setup's main model step in the sheet: the same list and line, with Skip
 * leaving the default where it is and Done making the one picked the
 * default for new chats.
 */
function ModelView({
  connection,
  onDone,
}: {
  /** What was just connected, whose models the list holds to. */
  connection?: LastConnection;
  onDone: () => void;
}) {
  const choice = useMainModelChoice(connection);
  return (
    <SheetFrame
      footer={
        <>
          <Button onClick={onDone} variant="ghost">
            Skip
          </Button>
          <Button
            disabled={choice.isLoading || choice.isSaving}
            onClick={() => {
              choice.save(onDone);
            }}
            variant="brand"
          >
            Done
          </Button>
        </>
      }
    >
      <h2 className="font-serif text-[22px] font-medium text-foreground">
        {MAIN_MODEL_TITLE}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{choice.subtitle}</p>
      <MainModelList choice={choice} className="mt-6" />
    </SheetFrame>
  );
}

/** Signed in and back from the browser, while the plan is checked. */
function ReturningView({
  line,
  onCancel,
  provider,
}: {
  line: ReactNode;
  onCancel: () => void;
  provider: PlanProvider;
}) {
  const copy = waitingPageCopy(provider, "back");
  return (
    <SheetFrame
      footer={
        <Button onClick={onCancel} variant="ghost">
          Cancel
        </Button>
      }
    >
      <div className="flex flex-col items-center py-6 text-center">
        <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-muted">
          <ConnectIcon className="size-7" provider={provider} />
        </div>
        <h2 className="font-serif text-[22px] font-medium text-foreground">
          {copy.title}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{copy.subtitle}</p>
        <div className="mt-6 flex items-center gap-3 text-sm text-muted-foreground">
          <Spinner className="size-4 shrink-0" delay={0} />
          <span data-waiting-line>{line}</span>
        </div>
      </div>
    </SheetFrame>
  );
}

function SheetFrame({
  children,
  footer,
}: {
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex flex-1 flex-col px-8 pt-8 pb-6">{children}</div>
      <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-t border-border px-6 [&>:only-child]:ml-auto">
        {footer}
      </div>
    </div>
  );
}

/** One way in: its mark and plans, and Continue, Connected, or the wait. */
function ConnectRow({
  below,
  connected,
  flow,
  onCancel,
  onStart,
  provider,
  title,
  waitingLine,
}: {
  below?: ReactNode;
  connected: boolean;
  flow: ConnectFlow<void>;
  onCancel: () => void;
  onStart: () => void;
  provider: ConnectProvider;
  /** In place of the way in's own name, as "Use Claude instead". */
  title?: string;
  waitingLine: ReactNode;
}) {
  const isTrial = provider === "instrument";
  const { data: offer } = useQuery({
    ...rpcClient.billing.offer.queryOptions(),
    enabled: isTrial,
  });
  const instrument = instrumentWayCopy(offer);
  return (
    <div
      className="rounded-xl border border-border bg-card px-4 py-3"
      data-connect-row={provider}
    >
      <div className="flex items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center">
          {isTrial ? (
            <BrandMark className="size-8" />
          ) : (
            <ConnectIcon className="size-5" provider={provider} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {title ?? (isTrial ? instrument.title : CONNECT_NAMES[provider])}
          </p>
          <p className="text-xs text-muted-foreground">
            {flow.waiting
              ? waitingLine
              : isTrial
                ? instrument.line
                : CONNECT_PLANS[provider]}
          </p>
        </div>
        {connected ? (
          <span className="flex shrink-0 items-center gap-1 text-[13px] text-muted-foreground">
            <CheckCircleIcon className="size-4 text-brand-600 dark:text-brand-400" />
            Connected
          </span>
        ) : (
          <BrowserHandoffButton
            className="shrink-0"
            onCancel={onCancel}
            onStart={onStart}
            size="sm"
            variant={isTrial ? "default" : "outline"}
            waiting={flow.waiting}
          >
            Continue
          </BrowserHandoffButton>
        )}
      </div>
      {below}
    </div>
  );
}

function KeyRow({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex size-8 shrink-0 items-center justify-center">
        <KeyIcon className="size-5 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">An API key</p>
        <p className="text-xs text-muted-foreground">
          Anthropic, OpenAI, OpenRouter and more
        </p>
      </div>
      <Button className="shrink-0" onClick={onAdd} size="sm" variant="outline">
        Add key
      </Button>
    </div>
  );
}

/** The way in's mark, badged with what the answer is about. */
function AnswerMark({
  outcome,
  provider,
}: {
  outcome: ConnectOutcome;
  provider: ConnectProvider;
}) {
  const Badge = outcome.kind === "out-of-usage" ? ClockIcon : WarningIcon;
  return (
    <div className="relative mb-4 flex size-14 items-center justify-center rounded-2xl bg-muted">
      <ConnectIcon className="size-7" provider={provider} />
      <span
        className={cn(
          "absolute -right-1 -bottom-1 flex size-6 items-center justify-center rounded-full bg-background ring-1 ring-border",
          "text-warning-700 dark:text-warning-300",
        )}
      >
        <Badge className="size-3.5" weight="fill" />
      </span>
    </div>
  );
}

function waitingLineFor(
  provider: ConnectProvider,
  flows: {
    claude: ReturnType<typeof useClaudeConnect>;
    grok: ReturnType<typeof useGrokConnect>;
  } & Record<ConnectProvider, ConnectFlow<void>>,
): ReactNode {
  const flow = flows[provider];
  if (flow.phase === "checking") {
    return `Checking your ${CONNECT_NAMES[provider]} plan`;
  }
  switch (provider) {
    case "claude": {
      return claudeWaitingLine(flows.claude.status);
    }
    case "grok": {
      return grokWaitingLine(flows.grok.userCode);
    }
    case "chatgpt": {
      return "Finish signing in with ChatGPT in your browser";
    }
    case "instrument": {
      return "Finish signing in with Google in your browser";
    }
  }
}
