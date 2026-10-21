import { PlanCards } from "@/client/components/billing/plan-cards";
import { usePlanCheckout } from "@/client/components/billing/use-plan-checkout";
import { useStartTrial } from "@/client/components/billing/use-start-trial";
import { BrowserHandoffButton } from "@/client/components/browser-handoff-button";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { Spinner } from "@/client/components/ui/spinner";
import { useBillingStatus } from "@/client/hooks/use-billing-status";
import {
  allowanceLabel,
  checkoutTrialLine,
  describeDay,
  formatAmount,
  isTrialHeldBack,
} from "@/client/lib/billing";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { SetupFooter, SetupPage } from "../kit/setup-page";
import { type SetupPageProps } from "../setup-page-props";
import { previewPage } from "./preview";
import { WaysIn } from "./ways-in";

type Offer = RPCOutput["billing"]["offer"];

/** The plan step's pages, kept in its own state. */
type PlanPage =
  | { kind: "cards" }
  | { kind: "checkout" }
  | { days: number; endsAt?: string; kind: "trial-started" }
  | { kind: "use-instead" };

/**
 * The plan, for someone signed in to Instrument with no subscription and no
 * trial running: the plan cards as the server's offer has them, a no-card
 * trial started right here, Checkout for everything else, or a
 * subscription they already pay for instead. Answered once a trial starts,
 * Checkout completes, or another way connects.
 */
export function PlanStep({ hold, onBack, onContinue }: SetupPageProps) {
  const [page, setPage] = useState<PlanPage>(
    () => previewPage<PlanPage>("plan") ?? { kind: "cards" },
  );
  const {
    data: offer,
    error,
    refetch,
  } = useQuery(rpcClient.billing.offer.queryOptions());
  const { data: status } = useBillingStatus();
  const checkout = usePlanCheckout({ onSubscribed: onContinue });
  const startTrial = useStartTrial();
  // The card whose Start free trial was pressed, busy while the trial starts.
  const [trialPlan, setTrialPlan] = useState<null | string>(null);

  switch (page.kind) {
    case "use-instead": {
      return (
        <WaysIn
          hold={hold}
          initial={{ kind: "subscriptions" }}
          offerInstrument={false}
          onDone={onContinue}
          onLeave={() => {
            setPage({ kind: "cards" });
          }}
        />
      );
    }
    case "trial-started": {
      return (
        <SetupPage
          align="center"
          footer={<SetupFooter back={false} onContinue={onContinue} />}
          hero={
            <span className="flex size-32 flex-col items-center justify-center rounded-full bg-brand-100/70 text-brand-800 dark:bg-brand-900/60 dark:text-brand-200">
              <span className="font-serif text-5xl/none font-medium">
                {page.days}
              </span>
              <span className="mt-1 text-xs">
                {page.days === 1 ? "day" : "days"}
              </span>
            </span>
          }
          subtitle={
            page.endsAt
              ? `It runs until ${describeDay(new Date(page.endsAt))}, or until the trial's AI usage runs out, whichever comes first.`
              : "It runs until the trial's AI usage runs out or its days are up, whichever comes first."
          }
          title="Your trial has started"
        />
      );
    }
    case "checkout": {
      const isWaiting = checkout.isWaiting || checkout.isOpening;
      return (
        <SetupPage
          align="center"
          footer={
            <SetupFooter
              next="none"
              onBack={() => {
                checkout.cancel();
                setPage({ kind: "cards" });
              }}
            />
          }
          subtitle={
            isWaiting
              ? "Checkout is open in your browser. Setup moves on by itself once your payment goes through."
              : "If you pay in the browser later, setup still moves on once it goes through."
          }
          title={isWaiting ? "Finish in your browser" : "No payment yet"}
        >
          <BrowserHandoffButton
            className="mt-8"
            onCancel={checkout.cancel}
            onStart={checkout.retry}
            variant={isWaiting ? "default" : "brand"}
            waiting={isWaiting}
          >
            Open Checkout again
          </BrowserHandoffButton>
        </SetupPage>
      );
    }
    case "cards": {
      const trial = offer?.trial;
      const noCardTrial =
        trial?.available !== false &&
        (trial?.mode ?? (trial?.cardRequired ? "card" : "no_card")) ===
          "no_card";
      const showsTrial =
        trial !== null &&
        trial !== undefined &&
        trial.available !== false &&
        trial.mode !== "intro";
      const heldBack = isTrialHeldBack(status, offer);
      const copy = cardsCopy(offer, { heldBack, showsTrial });
      const beta = offer?.beta;
      const betaPlan =
        beta && offer.plans.find((plan) => plan.key === beta.plan);
      return (
        <SetupPage
          footer={<SetupFooter next="none" onBack={onBack} />}
          subtitle={copy.subtitle}
          title={copy.title}
        >
          <div className="mt-8 w-170 max-w-full">
            {!offer ? (
              error ? (
                <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
                  <p>The plans didn&rsquo;t load. Try again in a moment.</p>
                  <Button
                    onClick={() => {
                      void refetch();
                    }}
                    size="sm"
                  >
                    Try again
                  </Button>
                </div>
              ) : (
                <div className="flex justify-center">
                  <Spinner className="size-5 text-muted-foreground" />
                </div>
              )
            ) : beta && betaPlan ? (
              <BetaCard
                isBusy={checkout.isOpening}
                months={beta.months}
                onClaim={() => {
                  hold();
                  checkout.start(betaPlan.key, { offer: "beta" });
                  setPage({ kind: "checkout" });
                }}
                plan={betaPlan}
              />
            ) : (
              <PlanCards
                busyPlan={startTrial.isPending ? trialPlan : null}
                offer={offer}
                onChoose={(plan, action) => {
                  hold();
                  if (action === "trial" && noCardTrial) {
                    setTrialPlan(plan.key);
                    startTrial.mutate(undefined, {
                      onSuccess: (started) => {
                        setPage({
                          days: trial?.days ?? 0,
                          ...(started.trial.endsAt && {
                            endsAt: started.trial.endsAt,
                          }),
                          kind: "trial-started",
                        });
                      },
                    });
                  } else {
                    checkout.start(plan.key);
                    setPage({ kind: "checkout" });
                  }
                }}
                status={status}
                trial={showsTrial && !heldBack}
              />
            )}
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            Already pay for ChatGPT, Claude or Grok?{" "}
            <button
              className="font-medium text-foreground underline underline-offset-2"
              onClick={() => {
                setPage({ kind: "use-instead" });
              }}
              type="button"
            >
              Use it instead
            </button>
          </p>
        </SetupPage>
      );
    }
  }
}

/** The plan page's title and line, from what the offer gives this account. */
function cardsCopy(
  offer: Offer | undefined,
  { heldBack, showsTrial }: { heldBack: boolean; showsTrial: boolean },
) {
  const beta = offer?.beta;
  const betaPlan = beta && offer.plans.find((plan) => plan.key === beta.plan);
  if (beta && betaPlan) {
    return {
      subtitle: `Thanks for testing ${APP_NAME}. Your first ${String(beta.months)} months of ${betaPlan.name} are free, and you'll finish in your browser.`,
      title: `${betaPlan.name} is on us for ${String(beta.months)} months`,
    };
  }
  const trial = offer?.trial;
  if (trial && showsTrial && !heldBack) {
    const days = String(trial.days);
    return trial.cardRequired || trial.mode === "card"
      ? {
          subtitle: checkoutTrialLine(offer),
          title: `Try ${APP_NAME} free for ${days} days`,
        }
      : {
          subtitle: `No card needed. Your trial includes a set amount of AI usage, and if you use it all before the ${days} days are up, the trial ends early.`,
          title: `Try ${APP_NAME} free for ${days} days`,
        };
  }
  return {
    subtitle: heldBack
      ? "Free trials are paused right now, so pick the plan that fits how much you use AI. You can change or cancel it any time."
      : [
          checkoutTrialLine(offer),
          "Pick the plan that fits how much you use AI. You can change or cancel it any time.",
        ]
          .filter(Boolean)
          .join(" "),
    title: "Choose a plan",
  };
}

/** The beta offer's one plan, free for its months through Checkout. */
function BetaCard({
  isBusy,
  months,
  onClaim,
  plan,
}: {
  isBusy: boolean;
  months: number;
  onClaim: () => void;
  plan: Offer["plans"][number];
}) {
  const amount = formatAmount(plan.price);
  return (
    <Card
      className="mx-auto w-80 max-w-full gap-0 border border-brand-500/60 p-4"
      data-plan-card={plan.key}
    >
      <span className="text-sm font-medium">{plan.name}</span>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-2xl font-semibold tracking-tight">Free</span>
        <span className="text-xs text-muted-foreground">
          for {months} months
          {amount &&
            `, then ${amount}${plan.price?.interval ? ` / ${plan.price.interval}` : ""}`}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">AI usage</span>
        <span className="font-medium">{allowanceLabel(plan)}</span>
      </div>
      <Button
        className="mt-4 w-full"
        disabled={isBusy}
        onClick={onClaim}
        size="sm"
        variant="brand"
      >
        Claim your free months
      </Button>
    </Card>
  );
}
