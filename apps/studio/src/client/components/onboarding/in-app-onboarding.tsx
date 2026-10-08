import { trialPlanAtom } from "@/client/atoms/plan-sheet";
import { PlanCards } from "@/client/components/billing/plan-cards";
import { usePlanCheckout } from "@/client/components/billing/use-plan-checkout";
import { BrandMark } from "@/client/components/brand-mark";
import { ChatGPTLoginButton } from "@/client/components/chatgpt-login-button";
import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { useBillingStatus } from "@/client/hooks/use-billing-status";
import { useLiveUser } from "@/client/hooks/use-live-user";
import {
  describeDate,
  describeDay,
  formatPriceInWords,
} from "@/client/lib/billing";
import {
  type OnboardingPlanStep,
  onboardingPlanStep,
} from "@/client/lib/onboarding-plan-step";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { useQuery } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { type ReactNode, useEffect, useState } from "react";

const DAY_MS = 86_400_000;

type Page =
  | { kind: "plan" }
  | { kind: "subscribed"; plan: string }
  | { endsAt: Date; kind: "trial-started" };

/**
 * Onboarding's steps inside the app window, after the sign-in window: for
 * now one, the plan. A stub the designed step-by-step onboarding replaces;
 * what it settles is only when these steps show (`onboarding.inApp.status`,
 * once per `IN_APP_ONBOARDING_VERSION`) and that finishing them records it.
 *
 * Drawn over the whole window while it shows, so the app is ready behind it
 * the moment it finishes.
 */
export function InAppOnboarding() {
  const { data, refetch } = useQuery(
    rpcClient.onboarding.inApp.status.queryOptions(),
  );
  if (!data?.pending) {
    return null;
  }
  return (
    <InAppOnboardingSteps
      onFinish={() => {
        void rpcClient.onboarding.inApp.finish.call().then(() => refetch());
      }}
    />
  );
}

function InAppOnboardingSteps({ onFinish }: { onFinish: () => void }) {
  const { data: status, isSignedIn } = useBillingStatus();
  const { data: offer } = useQuery({
    ...rpcClient.billing.offer.queryOptions(),
    enabled: isSignedIn,
  });
  const { data: chatgpt } = useQuery(
    rpcClient.chatgptAccount.live.status.experimental_liveOptions(),
  );
  const { data: claude } = useQuery(
    rpcClient.claudeAccount.live.status.experimental_liveOptions(),
  );
  const { data: hasToken } = useQuery(
    rpcClient.auth.live.hasToken.experimental_liveOptions(),
  );
  const [page, setPage] = useState<Page>({ kind: "plan" });
  const setTrialPlan = useSetAtom(trialPlanAtom);
  // The trial runs its days from now, as near as the first message makes it.
  const trialStarted = (): Page => ({
    endsAt: new Date(Date.now() + (offer?.trial?.days ?? 7) * DAY_MS),
    kind: "trial-started",
  });
  const checkout = usePlanCheckout({
    onSubscribed: (plan) => {
      setPage(
        offer?.trial?.available ? trialStarted() : { kind: "subscribed", plan },
      );
    },
  });

  // Undecided until everything the step depends on has been read.
  const isReady =
    hasToken !== undefined &&
    chatgpt !== undefined &&
    claude !== undefined &&
    (!isSignedIn || (status !== undefined && offer !== undefined));
  // Settled once, from the account as it was when the steps opened: buying a
  // plan here changes what the step would be, and must not end the steps
  // before the confirmation that says so.
  const [step, setStep] = useState<OnboardingPlanStep | undefined>();
  if (step === undefined && isReady) {
    setStep(
      offer && status
        ? onboardingPlanStep({
            hasSubscriptionAccount:
              (chatgpt?.accounts.length ?? 0) > 0 ||
              claude?.kind === "signed-in",
            isSignedIn,
            offer,
            status,
          })
        : null,
    );
  }

  // Nothing to choose is the same as having chosen: on into the app.
  const hasNothingToShow = step === null;
  useEffect(() => {
    if (hasNothingToShow) {
      onFinish();
    }
  }, [hasNothingToShow, onFinish]);

  if (step === undefined || hasNothingToShow || !offer) {
    return <Frame>{null}</Frame>;
  }

  if (page.kind === "trial-started") {
    const { endsAt } = page;
    return (
      <Frame>
        <Confirmation
          line={`It runs until ${describeDay(endsAt)}, or until the trial's AI usage runs out, whichever comes first.`}
          onContinue={onFinish}
          title="Your trial has started"
        />
      </Frame>
    );
  }

  if (page.kind === "subscribed") {
    const plan = offer.plans.find((each) => each.key === page.plan);
    const renews = status?.subscription?.currentPeriodEnd;
    const line = [
      plan ? formatPriceInWords(plan.price) : "",
      renews ? `renewing ${describeDate(new Date(renews), new Date())}` : "",
    ]
      .filter(Boolean)
      .join(", ");
    return (
      <Frame>
        <Confirmation
          line={`${line ? `${line}. ` : ""}Change or cancel any time in Settings.`}
          onContinue={onFinish}
          title="You're subscribed"
        />
      </Frame>
    );
  }

  if (checkout.waitingFor) {
    return (
      <Frame>
        <Heading
          line={`Checkout opened in your browser. ${step === "trial" ? "Add a card to start your trial" : "Pay there"}, and you'll come right back.`}
          title="Finish in your browser"
        />
        <div
          className="mt-6 flex items-center gap-2 text-sm text-muted-foreground"
          data-waiting-for-stripe
        >
          <Spinner className="size-3.5" delay={0} />
          Waiting for Stripe
        </div>
        <div className="mt-3 flex gap-2">
          <Button onClick={checkout.cancel} size="sm" variant="ghost">
            Back
          </Button>
          <Button
            disabled={checkout.isOpening}
            onClick={checkout.reopen}
            size="sm"
            variant="outline"
          >
            Open it again
          </Button>
        </div>
      </Frame>
    );
  }

  const isTrial = step === "trial";
  return (
    <Frame>
      <AccountChip />
      <Heading
        line={
          isTrial
            ? `Every plan includes everything. When the trial ends, AI pauses until you subscribe. Nothing is charged automatically.`
            : "Every plan includes everything. You'll finish in your browser."
        }
        title={
          isTrial
            ? `Try ${APP_NAME} free for ${offer.trial?.days ?? 7} days`
            : "Choose a plan"
        }
      />
      <div className="mt-8 w-full max-w-xl" data-onboarding-plan-step={step}>
        <PlanCards
          busyPlan={checkout.isOpening ? checkout.waitingFor : null}
          offer={offer}
          onChoose={(plan) => {
            if (isTrial) {
              // Remembered for the sheet the trial's end opens, which leads
              // with the plan picked here.
              setTrialPlan(plan.key);
            }
            if (isTrial && !offer.trial?.cardRequired) {
              // Our trial starts with the first message on our models, so
              // there is nothing to start in Stripe.
              setPage(trialStarted());
            } else {
              checkout.start(plan.key);
            }
          }}
          status={status}
          trial={isTrial}
        />
      </div>
      <div className="mt-8 flex flex-col items-center gap-4">
        <ChatGPTLoginButton
          caption="Pay for ChatGPT Plus or Pro? Use it here instead."
          onSuccess={onFinish}
        />
        <Button
          className="text-muted-foreground"
          onClick={onFinish}
          size="sm"
          variant="ghost"
        >
          Not now
        </Button>
      </div>
    </Frame>
  );
}

/** The whole window, the bar's band left free to drag it by. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div
      className="absolute inset-0 z-40 flex flex-col bg-background"
      data-in-app-onboarding
    >
      <div className="h-11 shrink-0 [-webkit-app-region:drag]" />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-10">
        <div className="my-auto flex flex-col items-center py-8">
          {children}
        </div>
      </div>
    </div>
  );
}

function Heading({ line, title }: { line: string; title: string }) {
  return (
    <div className="mt-6 flex max-w-xl flex-col items-center gap-3 text-center">
      <h1 className="font-serif text-3xl font-medium tracking-tight text-foreground">
        {title}
      </h1>
      <p className="text-sm text-muted-foreground">{line}</p>
    </div>
  );
}

function Confirmation({
  line,
  onContinue,
  title,
}: {
  line: string;
  onContinue: () => void;
  title: string;
}) {
  return (
    <div className="flex flex-col items-center gap-6">
      <BrandMark className="size-20 drop-shadow-md" />
      <Heading line={line} title={title} />
      <Button onClick={onContinue}>Continue</Button>
    </div>
  );
}

/** Who is signed in, so the plan reads as theirs. */
function AccountChip() {
  const { data: user } = useLiveUser();
  if (!user?.email) {
    return null;
  }
  return (
    <div className="rounded-full bg-muted/60 px-3 py-1 text-xs text-muted-foreground">
      {user.email}
    </div>
  );
}
