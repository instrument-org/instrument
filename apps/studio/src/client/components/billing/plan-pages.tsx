import { PlanCards } from "@/client/components/billing/plan-cards";
import { usePlanCheckout } from "@/client/components/billing/use-plan-checkout";
import { useStartTrial } from "@/client/components/billing/use-start-trial";
import { BrowserHandoffButton } from "@/client/components/browser-handoff-button";
import {
  SetupFooter,
  SetupPage,
} from "@/client/components/setup/kit/setup-page";
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
import { type ComponentProps, type ReactNode, useState } from "react";

type Offer = RPCOutput["billing"]["offer"];

/** The plan pages, kept in their own state. */
export type PlanPage =
  | { kind: "cards" }
  | { kind: "checkout" }
  | { days: number; endsAt?: string; kind: "trial-started" };

/** How far in each page is, so going to a shallower one reads as Back. */
export const PLAN_PAGE_DEPTH: Record<PlanPage["kind"], number> = {
  cards: 0,
  checkout: 1,
  "trial-started": 2,
};

type Footer = Pick<ComponentProps<typeof SetupFooter>, "onBack" | "skip">;

/**
 * Setup's plan pages, for someone signed in to Instrument with no
 * subscription and no trial running: the plan cards as the server's offer
 * has them, a no-card trial started right here and its confirmation, or
 * Checkout in the browser and the page that waits on it. Setup's plan step
 * switches these in its own pages; a dialog draws them with `PlanPages`.
 */
export function usePlanPages({
  cardsFooter,
  cardsNote,
  fit = "window",
  hold = () => {},
  initialPage,
  isChecking = false,
  onDone,
}: {
  /** The cards page's way out: Back, or a skip such as Not now. */
  cardsFooter: Footer;
  /** Under the cards once the offer is read, told whether the trial shows. */
  cardsNote?: (trialShown: boolean) => ReactNode;
  fit?: "dialog" | "window";
  /** Keeps the page on screen while something that settles it is under way. */
  hold?: () => void;
  initialPage?: PlanPage;
  /** Whether the account is still being read, so the plans wait. */
  isChecking?: boolean;
  /** A subscription landed, or the trial started and was seen. */
  onDone: () => void;
}): { kind: PlanPage["kind"]; page: ReactNode } {
  const [page, setPage] = useState<PlanPage>(
    () => initialPage ?? { kind: "cards" },
  );
  const {
    data: offer,
    error,
    refetch,
  } = useQuery(rpcClient.billing.offer.queryOptions());
  const { data: status } = useBillingStatus();
  const checkout = usePlanCheckout({ onSubscribed: onDone });
  const startTrial = useStartTrial();
  // The card whose Start free trial was pressed, busy while the trial starts.
  const [trialPlan, setTrialPlan] = useState<null | string>(null);
  const inSetup = fit === "window";

  const shown = (): ReactNode => {
    switch (page.kind) {
      case "trial-started": {
        return (
          <SetupPage
            align="center"
            fit={fit}
            footer={<SetupFooter back={false} onContinue={onDone} />}
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
            fit={fit}
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
                ? inSetup
                  ? "Checkout is open in your browser. Setup moves on by itself once your payment goes through."
                  : "Checkout is open in your browser. This page moves on by itself once your payment goes through."
                : inSetup
                  ? "If you pay in the browser later, setup still moves on once it goes through."
                  : "If you pay in the browser later, your plan starts once it goes through."
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
        const footer = <SetupFooter next="none" {...cardsFooter} />;
        if (isChecking) {
          return (
            <SetupPage
              align="center"
              fit={fit}
              footer={footer}
              hero={<Spinner className="size-5 text-muted-foreground" />}
              title="Checking your account…"
            />
          );
        }
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
            fit={fit}
            footer={footer}
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
                  busyPlan={startTrial.isPending ? betaPlan.key : null}
                  offer={offer}
                  onChoose={() => {
                    hold();
                    startTrial.mutate(
                      { offer: "beta" },
                      {
                        onSuccess: (started) => {
                          const endsAt = started.trial.endsAt;
                          setPage({
                            days: endsAt
                              ? Math.round(
                                  (Date.parse(endsAt) - Date.now()) /
                                    86_400_000,
                                )
                              : 0,
                            ...(endsAt && { endsAt }),
                            kind: "trial-started",
                          });
                        },
                      },
                    );
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
            {offer && cardsNote?.(showsTrial && !heldBack)}
          </SetupPage>
        );
      }
    }
  };
  return { kind: page.kind, page: shown() };
}

/** The plan pages in a dialog, a page at a time. */
export function PlanPages(
  props: Omit<Parameters<typeof usePlanPages>[0], "fit">,
) {
  return usePlanPages({ ...props, fit: "dialog" }).page;
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
      subtitle: `Thanks for testing ${APP_NAME}. No card needed, and nothing renews on its own.`,
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
