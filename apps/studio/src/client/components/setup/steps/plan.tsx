import { PlanCards } from "@/client/components/billing/plan-cards";
import { usePlanCheckout } from "@/client/components/billing/use-plan-checkout";
import { useStartTrial } from "@/client/components/billing/use-start-trial";
import { BrowserHandoffButton } from "@/client/components/browser-handoff-button";
import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { useBillingStatus } from "@/client/hooks/use-billing-status";
import {
  checkoutTrialLine,
  describeDay,
  isTrialHeldBack,
} from "@/client/lib/billing";
import { cn } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import { SetupFooter, SetupPage } from "../kit/setup-page";
import { SetupPageSwitch } from "../kit/setup-page-switch";
import { type SetupPageProps } from "../setup-page-props";
import { previewPage } from "./preview";
import { WaysIn, type WaysInPage } from "./ways-in";

type Offer = RPCOutput["billing"]["offer"];

/** The plan step's pages, kept in its own state. */
type PlanPage =
  | { kind: "cards" }
  | { kind: "checkout" }
  | { days: number; endsAt?: string; kind: "trial-started" }
  | { initial: WaysInPage; kind: "use-instead" };

/**
 * The plan, for someone signed in to Instrument with no subscription and no
 * trial running: the plan cards as the server's offer has them, a no-card
 * trial started right here, or Checkout for everything else. Under the
 * cards it offers a subscription they already pay for, and while no free
 * trial can start, an API key too. Answered once a trial starts, Checkout
 * completes, or another way connects.
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

  const shown = (): ReactNode => {
    switch (page.kind) {
      case "use-instead": {
        return (
          <WaysIn
            hold={hold}
            initial={page.initial}
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
            <div
              className={cn(
                "mt-8 max-w-full",
                beta && betaPlan ? "w-85" : "w-170",
              )}
            >
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
                <PlanCards
                  beta={beta}
                  busyPlan={checkout.isOpening ? betaPlan.key : null}
                  offer={offer}
                  onChoose={(plan) => {
                    hold();
                    checkout.start(plan.key, { offer: "beta" });
                    setPage({ kind: "checkout" });
                  }}
                  status={status}
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
            {offer && (
              <p
                className="mt-5 text-sm text-muted-foreground"
                data-use-instead
              >
                Already pay for ChatGPT, Claude, or Grok?{" "}
                <InlineLink
                  onClick={() => {
                    setPage({
                      initial: { kind: "subscriptions" },
                      kind: "use-instead",
                    });
                  }}
                >
                  Use your existing subscriptions
                </InlineLink>
                {!(showsTrial && !heldBack) && (
                  <>
                    , or{" "}
                    <InlineLink
                      onClick={() => {
                        hold();
                        setPage({
                          initial: { kind: "key" },
                          kind: "use-instead",
                        });
                      }}
                    >
                      add an API key
                    </InlineLink>
                    .
                  </>
                )}
              </p>
            )}
          </SetupPage>
        );
      }
    }
  };
  return (
    <SetupPageSwitch depth={PLAN_DEPTH[page.kind]} page={page.kind}>
      {shown()}
    </SetupPageSwitch>
  );
}

/** How far into the plan step each page is, so going to a shallower one reads as Back. */
const PLAN_DEPTH: Record<PlanPage["kind"], number> = {
  cards: 0,
  checkout: 1,
  "trial-started": 2,
  "use-instead": 1,
};

function InlineLink({
  children,
  onClick,
}: {
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      className="font-medium text-foreground underline underline-offset-2"
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

/** The plan page's title and line, from what the offer gives this account. */
function cardsCopy(
  offer: Offer | undefined,
  { heldBack, showsTrial }: { heldBack: boolean; showsTrial: boolean },
) {
  const beta = offer?.beta;
  const betaPlan = beta && offer.plans.find((plan) => plan.key === beta.plan);
  if (beta && betaPlan) {
    const months =
      beta.months === 1 ? "a month" : `${String(beta.months)} months`;
    return {
      subtitle: `Thanks for testing ${APP_NAME}. No card needed. You'll finish in your browser.`,
      title: `${betaPlan.name} is on us for ${months}`,
    };
  }
  const trial = offer?.trial;
  if (trial && showsTrial && !heldBack) {
    const days = String(trial.days);
    return trial.cardRequired || trial.mode === "card"
      ? {
          subtitle: checkoutTrialLine(offer),
          title: <TrialTitle days={days} />,
        }
      : {
          subtitle: `No card needed. Your trial includes a set amount of AI usage, and if you use it all before the ${days} days are up, the trial ends early.`,
          title: <TrialTitle days={days} />,
        };
  }
  return {
    subtitle: [
      checkoutTrialLine(offer),
      "Pick the plan that fits how much you use AI. You can change or cancel it any time.",
    ]
      .filter(Boolean)
      .join(" "),
    title: "Choose a plan",
  };
}

/** "Try Instrument free for 7 days", with a marker scratch under the days. */
function TrialTitle({ days }: { days: string }) {
  return (
    <>
      Try {APP_NAME} free for{" "}
      <span className="relative isolate inline-block whitespace-nowrap">
        {days} days
        <svg
          aria-hidden
          className="absolute -bottom-2 -left-[4%] -z-10 h-4.5 w-[108%] rotate-2 text-brand-100 dark:text-brand-800"
          fill="none"
          preserveAspectRatio="none"
          viewBox="0 0 102 18"
        >
          <path
            d="M3 13.5C24 8.5 52 5 76 5.5c9 .2 16 1.4 23 3.2"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="5"
          />
        </svg>
      </span>
    </>
  );
}
