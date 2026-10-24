import { BrandMark } from "@/client/components/brand-mark";
import { BrowserHandoffButton } from "@/client/components/browser-handoff-button";
import { ConnectButton } from "@/client/components/connect-button";
import {
  SetupFooter,
  SetupPage,
} from "@/client/components/setup/kit/setup-page";
import { TermsFooter } from "@/client/components/terms-footer";
import { Button } from "@/client/components/ui/button";
import { useInstrumentConnect } from "@/client/hooks/use-connect";
import { type ConnectResult } from "@/client/hooks/use-connect-flow";
import { useConnectedPlans } from "@/client/hooks/use-connected-plans";
import {
  accountNotice,
  type BillingNotice,
  nextStepFor,
} from "@/client/lib/billing";
import { openAccount } from "@/client/lib/billing-website";
import { showConnectToast } from "@/client/lib/connect-toast";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { APP_NAME, SUPPORT_URL } from "@instrument-org/shared";
import { useOpenExternalLink } from "@/client/hooks/use-open-external-link";
import { WarningIcon } from "@phosphor-icons/react/Warning";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

type Offer = RPCOutput["billing"]["offer"];
type Status = RPCOutput["billing"]["status"];

/** Where a dialog goes once someone has signed in to Instrument with Google. */
type InstrumentSignInNext =
  | { kind: "finish" }
  /** An account a plan can't help: a failed payment or revoked access. */
  | { kind: "notice"; notice: BillingNotice }
  | { kind: "plans" };

export function nextAfterInstrumentSignIn({
  hasOwnAI,
  offer,
  status,
}: {
  hasOwnAI: boolean;
  offer: Offer | undefined;
  status: Status | undefined;
}): InstrumentSignInNext {
  const notice = accountNotice(status, offer);
  if (notice?.kind === "access-revoked" || notice?.kind === "payment-failed") {
    return { kind: "notice", notice };
  }
  if (status?.subscription !== undefined || status?.trial.state === "active") {
    return { kind: "finish" };
  }
  return hasOwnAI ? { kind: "finish" } : { kind: "plans" };
}

/**
 * Whether AI of the person's own already works: a saved key, or a ChatGPT,
 * Claude or Grok plan signed in. Undefined until both are read.
 */
export function useHasOwnAI(): boolean | undefined {
  const { data: keys } = useQuery(
    rpcClient.providerConfig.live.list.experimental_liveOptions(),
  );
  const plans = useConnectedPlans();
  if (keys === undefined || plans === undefined) {
    return undefined;
  }
  return keys.length > 0 || Object.values(plans).some(Boolean);
}

/**
 * The plain log-in page every Instrument log-in outside setup starts on:
 * Continue with Google, which logs in or makes the account.
 */
export function InstrumentLogInPage({
  onSignedIn,
}: {
  onSignedIn: (result: ConnectResult) => void;
}) {
  return (
    <SetupPage
      align="center"
      fit="dialog"
      footer={<TermsFooter className="shrink-0 px-8 pt-3 pb-6" />}
      hero={<BrandMark className="size-16" />}
      subtitle="Continue with Google to log in, or to make an account if you don't have one yet."
      title={`Log in to ${APP_NAME}`}
    >
      <div className="mt-8">
        <ConnectButton
          className="h-10 px-5 text-base"
          onResult={(result) => {
            if (result.outcome.kind === "ready") {
              onSignedIn(result);
            }
          }}
          provider="instrument"
          variant="default"
        />
      </div>
    </SetupPage>
  );
}

/** A page a sign-in goes on to when it isn't done, with the account read for it. */
export type AfterSignInPage = Exclude<
  InstrumentSignInNext,
  { kind: "finish" }
> & { offer: Offer | undefined; status: Status | undefined };

/**
 * Reads the account after a Google sign-in in a dialog and says once where
 * it goes: done for an account with a plan, a running trial, or AI of its
 * own, which shows the signed-in toast and calls `onFinish`; otherwise
 * `onNext` with billing's next step or the way to the website's plans. It
 * draws nothing,
 * so the page the person signed in from stays up, at its size, while the
 * account is read. Mount one per sign-in.
 */
export function InstrumentSignInCheck({
  onFinish,
  onNext,
  result,
}: {
  onFinish: () => void;
  onNext: (next: AfterSignInPage) => void;
  result: ConnectResult;
}) {
  const { data: hasToken } = useQuery(
    rpcClient.auth.live.hasToken.experimental_liveOptions(),
  );
  // Read fresh: one cached from before this sign-in may be another account's.
  const status = useQuery(
    rpcClient.billing.status.queryOptions({
      enabled: hasToken === true,
      refetchOnWindowFocus: false,
      staleTime: 0,
    }),
  );
  const offer = useQuery(rpcClient.billing.offer.queryOptions());
  const hasOwnAI = useHasOwnAI();

  // Decided once: starting a trial or subscribing on the website changes
  // the status, and the pages that follow are theirs to finish.
  const [next, setNext] = useState<InstrumentSignInNext>();
  if (
    next === undefined &&
    status.isFetchedAfterMount &&
    !status.isFetching &&
    !offer.isPending &&
    hasOwnAI !== undefined
  ) {
    setNext(
      nextAfterInstrumentSignIn({
        hasOwnAI,
        offer: offer.data,
        status: status.data,
      }),
    );
  }

  const told = useRef(false);
  useEffect(() => {
    if (next === undefined || told.current) {
      return;
    }
    told.current = true;
    if (next.kind === "finish") {
      showConnectToast(result, "instrument");
      onFinish();
    } else {
      onNext({ ...next, offer: offer.data, status: status.data });
    }
  }, [next, offer.data, onFinish, onNext, result, status.data]);
  return null;
}

/**
 * The page a sign-in goes on to when it isn't done: billing's next step for
 * a payment that didn't go through or access that was revoked, otherwise
 * the way to the website's plans. `onBack` puts Back on the plans page, for
 * a dialog with a page to go back to; without it, it offers Not now.
 */
export function AfterInstrumentSignIn({
  next,
  onBack,
  onFinish,
  result,
}: {
  next: AfterSignInPage;
  onBack?: () => void;
  onFinish: () => void;
  result: ConnectResult;
}) {
  const finishSignedIn = () => {
    showConnectToast(result, "instrument");
    onFinish();
  };
  return next.kind === "plans" ? (
    <SeePlansPage onBack={onBack} onFinish={onFinish} onSkip={finishSignedIn} />
  ) : (
    <AccountNoticePage
      notice={next.notice}
      offer={next.offer}
      onFinish={finishSignedIn}
      status={next.status}
    />
  );
}

/**
 * Signed in with no plan: See plans opens the website's plans in the
 * browser and waits there, as a sign-in the website took over does, until
 * a plan or a trial lands.
 */
function SeePlansPage({
  onBack,
  onFinish,
  onSkip,
}: {
  onBack?: () => void;
  onFinish: () => void;
  onSkip: () => void;
}) {
  const plans = useInstrumentConnect();
  return (
    <SetupPage
      align="center"
      fit="dialog"
      footer={
        <SetupFooter
          next="none"
          onBack={onBack}
          skip={onBack ? undefined : { label: "Not now", onClick: onSkip }}
        />
      }
      hero={<BrandMark className="size-16" />}
      subtitle={`You're signed in. Choose a plan on the website to use ${APP_NAME}'s models.`}
      title="Choose a plan"
    >
      <div className="mt-8 flex flex-col items-center gap-y-2">
        <BrowserHandoffButton
          className="h-10 px-5 text-base"
          onCancel={plans.cancel}
          onStart={() => {
            void plans.start({ plans: true }).then((result) => {
              if (result?.outcome.kind === "ready") {
                onFinish();
              }
            });
          }}
          variant="default"
          waiting={plans.waiting}
        >
          See plans
        </BrowserHandoffButton>
        {plans.waiting && (
          <p className="text-center text-xs text-foreground/60">
            Finish choosing your plan in your browser.
          </p>
        )}
      </div>
    </SetupPage>
  );
}

/**
 * Billing's next step for an account no plan can help, in the words a chat's
 * note uses: Update card for a failed payment, Contact support for revoked
 * access.
 */
function AccountNoticePage({
  notice,
  offer,
  onFinish,
  status,
}: {
  notice: BillingNotice;
  offer: Offer | undefined;
  onFinish: () => void;
  status: Status | undefined;
}) {
  const [now] = useState(() => new Date());
  const openLink = useOpenExternalLink();
  const step = nextStepFor(
    { blocked: "models", notice, offer, otherModelCan: false, status },
    now,
  );
  return (
    <SetupPage
      align="center"
      fit="dialog"
      footer={
        <SetupFooter
          next="none"
          skip={{ label: "Not now", onClick: onFinish }}
        />
      }
      hero={
        <span className="flex size-14 items-center justify-center rounded-2xl bg-muted">
          <WarningIcon className="size-7 text-warning-700 dark:text-warning-300" />
        </span>
      }
      subtitle={step.line}
      title={step.title.replace(/\.$/, "")}
    >
      {step.action && (
        <Button
          className="mt-8 h-10 px-5 text-base"
          onClick={() => {
            if (step.action?.kind === "contact-support") {
              openLink(SUPPORT_URL);
            } else {
              openAccount();
            }
            onFinish();
          }}
        >
          {step.action.label}
        </Button>
      )}
    </SetupPage>
  );
}
