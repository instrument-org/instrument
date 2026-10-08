import { trialPlanAtom } from "@/client/atoms/plan-sheet";
import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { usePlanCheckout } from "@/client/components/billing/use-plan-checkout";
import { BrandMark } from "@/client/components/brand-mark";
import {
  SetupHead,
  SetupPage,
  SetupPill,
  SetupQuietLink,
} from "@/client/components/onboarding/setup/chrome";
import { useSetup } from "@/client/components/onboarding/setup/context";
import { SHARED_SETUP_START } from "@/client/components/onboarding/setup/flow";
import {
  CAN_CHECKOUT_BETA_OFFER,
  isHeavyPlan,
  readBetaOffer,
  startTrial,
  trialEndDate,
  welcomeBackNext,
} from "@/client/components/onboarding/setup/plans-billing";
import {
  SetupAccountChip,
  SetupPlanCard,
  TrialDaysDisc,
} from "@/client/components/onboarding/setup/plans-parts";
import {
  useChatGPTWayIn,
  useClaudeWayIn,
} from "@/client/components/onboarding/setup/way-in-sign-in";
import { Spinner } from "@/client/components/ui/spinner";
import { useBillingStatus } from "@/client/hooks/use-billing-status";
import { describeDay, formatAmount } from "@/client/lib/billing";
import {
  type OnboardingPlanStep,
  onboardingPlanStep,
} from "@/client/lib/onboarding-plan-step";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { useQuery } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";

const DEFAULT_TRIAL_DAYS = 7;

/** Back to Welcome, where ChatGPT, Claude and a key are. */
function useBackToWelcome() {
  const { dispatch, state } = useSetup();
  return () => {
    dispatch(
      state.history.at(-1) === "welcome"
        ? { type: "back" }
        : { step: "welcome", type: "go" },
    );
  };
}

/**
 * F3: the plans, each with a free trial. With no trial left on the account
 * the same cards subscribe instead, through Checkout. An account with nothing
 * to choose here (subscribed already, or a trial running) goes straight on.
 */
export function PlansPage() {
  const { dispatch } = useSetup();
  const toWelcome = useBackToWelcome();
  const setTrialPlan = useSetAtom(trialPlanAtom);
  const { data: hasToken } = useQuery(
    rpcClient.auth.live.hasToken.experimental_liveOptions(),
  );
  const isSignedIn = hasToken === true;
  const offerQuery = useQuery(rpcClient.billing.offer.queryOptions());
  const statusQuery = useBillingStatus();
  const offer = offerQuery.data;
  const status = statusQuery.data;
  const [isStarting, setIsStarting] = useState(false);

  // Settled once, from the account as it was when the page opened: a plan
  // bought here changes what the step would be, and must not move the page
  // before the confirmation that says so.
  const [step, setStep] = useState<OnboardingPlanStep | undefined>();
  if (step === undefined && isSignedIn && offer && status) {
    setStep(
      onboardingPlanStep({
        hasSubscriptionAccount: false,
        isSignedIn,
        offer,
        status,
      }),
    );
  }

  const checkout = usePlanCheckout({
    onSubscribed: () => {
      if (step === "trial") {
        dispatch({ step: "trial-started", type: "go" });
      } else {
        toast.success("You're subscribed", {
          description: "Change or cancel any time in Settings.",
        });
        dispatch({ step: SHARED_SETUP_START, type: "go" });
      }
    },
  });

  const hasNothingToChoose = step === null;
  useEffect(() => {
    if (hasNothingToChoose) {
      dispatch({ step: SHARED_SETUP_START, type: "replace" });
    }
  }, [hasNothingToChoose, dispatch]);

  if (offerQuery.isError || (isSignedIn && statusQuery.isError)) {
    return (
      <SetupPage>
        <SetupHead
          subtitle={`${APP_NAME} can't reach its servers right now. Try again in a moment, or use ChatGPT, Claude or your own key for now.`}
          title="We couldn't load the plans"
        />
        <div className="mt-8 flex flex-col items-center gap-4">
          <SetupPill
            onClick={() => {
              void offerQuery.refetch();
              void statusQuery.refetch();
            }}
          >
            Try again
          </SetupPill>
          <SetupQuietLink onClick={toWelcome}>
            Use something else
          </SetupQuietLink>
        </div>
      </SetupPage>
    );
  }

  if (hasToken === false) {
    return (
      <SetupPage>
        <SetupHead
          subtitle="Plans belong to an Instrument account, so sign in with Google first. You can also use ChatGPT, Claude or your own key."
          title="Sign in to choose a plan"
        />
        <div className="mt-8">
          <SetupPill onClick={toWelcome}>Go back</SetupPill>
        </div>
      </SetupPage>
    );
  }

  if (!offer || !step) {
    return <LoadingPage />;
  }

  const isTrial = step === "trial";

  if (checkout.waitingFor) {
    return (
      <CheckoutWaiting
        checkout={checkout}
        line={
          isTrial
            ? "Checkout opened in your browser. Add a card there to start your trial, and you'll come right back."
            : "Checkout opened in your browser. Pay there, and you'll come right back."
        }
      />
    );
  }

  const days = offer.trial?.days ?? DEFAULT_TRIAL_DAYS;
  const cardRequired = offer.trial?.cardRequired === true;

  return (
    <SetupPage back={false}>
      <SetupAccountChip />
      <div className="mt-5">
        <SetupHead
          subtitle={
            isTrial
              ? `${cardRequired ? "" : "No card needed. "}Your trial includes a set amount of AI usage. If you use it all before the ${days} days are up, the trial ends early.`
              : "You'll finish in your browser, and you can change or cancel your plan any time in Settings."
          }
          title={
            isTrial ? `Try ${APP_NAME} free for ${days} days` : "Choose a plan"
          }
        />
      </div>
      <div
        className="mt-7 flex items-stretch gap-5"
        data-onboarding-plan-step={step}
      >
        {offer.plans.map((plan) => (
          <SetupPlanCard
            badge={isHeavyPlan(plan) ? "For heavy use" : undefined}
            busy={
              isStarting ||
              (checkout.isOpening && checkout.waitingFor === plan.key)
            }
            cta={isTrial ? "Start free trial" : "Subscribe"}
            key={plan.key}
            onChoose={() => {
              if (!isTrial) {
                checkout.start(plan.key);
                return;
              }
              // Remembered for the sheet the trial's end opens, which leads
              // with the plan picked here.
              setTrialPlan(plan.key);
              if (cardRequired) {
                checkout.start(plan.key);
                return;
              }
              setIsStarting(true);
              startTrial(plan.key).then(
                () => {
                  dispatch({ step: "trial-started", type: "go" });
                },
                (error: unknown) => {
                  setIsStarting(false);
                  toast.error("Couldn't start your trial", {
                    description:
                      error instanceof Error ? error.message : undefined,
                  });
                },
              );
            }}
            plan={plan}
          />
        ))}
      </div>
      <p className="mt-5 text-[13px] text-foreground/55">
        Already pay for ChatGPT or Claude?{" "}
        <button
          className="font-medium text-foreground/80 underline decoration-foreground/25 underline-offset-4 hover:decoration-foreground/60"
          onClick={toWelcome}
          type="button"
        >
          Use it instead
        </button>
      </p>
    </SetupPage>
  );
}

/** F4: the trial is running. */
export function TrialStartedPage() {
  const { dispatch } = useSetup();
  const { data: offer } = useQuery(rpcClient.billing.offer.queryOptions());
  const { data: status } = useBillingStatus();
  const [now] = useState(() => new Date());
  const days = offer?.trial?.days ?? DEFAULT_TRIAL_DAYS;
  const endsAt = trialEndDate({ days, now, status });

  return (
    <SetupPage
      back={false}
      next={{
        label: "Continue",
        onClick: () => {
          dispatch({ step: SHARED_SETUP_START, type: "go" });
        },
      }}
    >
      <SetupHead
        illustration={<TrialDaysDisc days={days} />}
        subtitle={`It runs until ${describeDay(endsAt)}, or until the trial's AI usage runs out, whichever comes first.`}
        title="Your trial has started"
      />
    </SetupPage>
  );
}

/** F29: a returning beta tester, usually signed in already. */
export function WelcomeBackPage() {
  const { dispatch } = useSetup();
  const { data: hasToken } = useQuery(
    rpcClient.auth.live.hasToken.experimental_liveOptions(),
  );
  const offerQuery = useQuery(rpcClient.billing.offer.queryOptions());

  return (
    <SetupPage footer={false}>
      <SetupHead
        illustration={
          <BrandMark className="mb-2 size-24 drop-shadow-md" size={96} />
        }
        subtitle="Thanks for testing it. Your chats and files are right where you left them. A few things work differently now, so this takes about a minute."
        title={`Welcome to the new ${APP_NAME}`}
      />
      <SetupAccountChip className="mt-6" />
      <div className="mt-8">
        <SetupPill
          // Waits for the offer, which says whether there is a beta offer
          // to show; a failed read goes on without one.
          disabled={hasToken === undefined || offerQuery.isPending}
          onClick={() => {
            dispatch({
              step: welcomeBackNext({
                beta: readBetaOffer(offerQuery.data),
                isSignedIn: hasToken === true,
              }),
              type: "go",
            });
          }}
          size="large"
        >
          Get started
        </SetupPill>
      </div>
    </SetupPage>
  );
}

/** F30: the beta tester's offer, when the API makes one. */
export function BetaOfferPage() {
  const { dispatch } = useSetup();
  const chatGPT = useChatGPTWayIn({ move: "go" });
  const claude = useClaudeWayIn({ move: "go" });
  const { data: offer, isPending } = useQuery(
    rpcClient.billing.offer.queryOptions(),
  );
  const beta = readBetaOffer(offer);
  const plan = offer?.plans.find((each) => each.key === beta?.plan);
  const checkout = usePlanCheckout({
    onSubscribed: () => {
      dispatch({ step: SHARED_SETUP_START, type: "go" });
    },
  });

  // Only Welcome back opens this page, and only with an offer; one that is
  // gone by now leaves the plans.
  const hasNoOffer = !isPending && (!beta || !plan);
  useEffect(() => {
    if (hasNoOffer) {
      dispatch({ step: "plans", type: "replace" });
    }
  }, [hasNoOffer, dispatch]);

  if (!beta || !plan) {
    return <LoadingPage />;
  }

  if (checkout.waitingFor) {
    return (
      <CheckoutWaiting
        checkout={checkout}
        line="Checkout opened in your browser. Accept the offer there, and you'll come right back. Nothing is charged."
      />
    );
  }

  const amount = formatAmount(plan.price);
  const months = `${beta.months} ${beta.months === 1 ? "month" : "months"}`;

  return (
    <SetupPage back={false}>
      <SetupHead
        subtitle="As a thank you for being an early beta tester, we'd like to give you our premium plan for free. You can also connect your ChatGPT or Claude account below."
        title={`${plan.name} is on us for ${months}`}
      />
      <div className="mt-7">
        <SetupPlanCard
          busy={checkout.isOpening}
          cta="Accept"
          items={[
            { strong: true, text: "4× the AI usage of Standard" },
            { text: "Advanced web search" },
            { text: "Works with text, images and files" },
            { text: "Image generation and dictation" },
          ]}
          onChoose={() => {
            if (!CAN_CHECKOUT_BETA_OFFER) {
              toast.error("This offer can't be accepted yet", {
                description:
                  "You can connect ChatGPT or Claude for now, or try again after the next update.",
              });
              return;
            }
            checkout.start(plan.key);
          }}
          plan={plan}
          price={
            <div className="mt-1.5 flex items-baseline gap-1">
              {amount && (
                <>
                  <span className="text-4xl font-semibold tracking-tight text-foreground/30 line-through decoration-2">
                    {amount}
                  </span>
                  <span className="mr-3 text-sm text-foreground/45">/mo</span>
                </>
              )}
              <span className="text-4xl font-semibold tracking-tight text-foreground">
                $0
              </span>
              <span className="text-sm text-foreground/45">for {months}</span>
            </div>
          }
          tinted
        />
      </div>
      <p className="mt-5 text-[13px] text-foreground/55">
        Already have a paid ChatGPT or Claude plan? Connect those instead.
      </p>
      <div className="mt-2.5 flex w-75 gap-2.5">
        <WayInPill
          icon={<AIProviderIcon className="size-4" type="openai" />}
          disabled={chatGPT.waiting}
          label={chatGPT.waiting ? "Waiting for ChatGPT" : "ChatGPT"}
          onClick={() => {
            void chatGPT.start();
          }}
        />
        <WayInPill
          icon={<AIProviderIcon className="size-4" colored type="anthropic" />}
          disabled={claude.connecting}
          label="Claude"
          onClick={() => {
            void claude.start();
          }}
        />
      </div>
    </SetupPage>
  );
}

function WayInPill({
  disabled,
  icon,
  label,
  onClick,
}: {
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="flex h-10 flex-1 items-center justify-center gap-2 rounded-full bg-card text-sm font-medium text-foreground shadow-xs ring-1 ring-black/10 hover:bg-foreground/[0.03] disabled:opacity-60 dark:ring-white/15"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

/** While Checkout is open in the browser, waiting on Stripe. */
function CheckoutWaiting({
  checkout,
  line,
}: {
  checkout: ReturnType<typeof usePlanCheckout>;
  line: string;
}) {
  return (
    <SetupPage back={false}>
      <SetupHead subtitle={line} title="Finish in your browser" />
      <div
        className="mt-6 flex items-center gap-2 text-sm text-foreground/55"
        data-waiting-for-stripe
      >
        <Spinner className="size-3.5" delay={0} />
        Waiting for checkout to finish
      </div>
      <div className="mt-6 flex items-center gap-6">
        <SetupQuietLink onClick={checkout.cancel}>Back</SetupQuietLink>
        <SetupPill
          disabled={checkout.isOpening}
          kind="light"
          onClick={checkout.reopen}
          size="small"
        >
          Open it again
        </SetupPill>
      </div>
    </SetupPage>
  );
}

function LoadingPage() {
  return (
    <SetupPage back={false}>
      <Spinner className="size-6 text-foreground/40" />
    </SetupPage>
  );
}
