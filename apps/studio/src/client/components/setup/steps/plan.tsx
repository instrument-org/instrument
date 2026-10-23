import {
  PLAN_PAGE_DEPTH,
  type PlanPage,
  usePlanPages,
} from "@/client/components/billing/plan-pages";
import { useEffect, useState } from "react";

import { SetupPageSwitch } from "../kit/setup-page-switch";
import { type SetupStepProps } from "../step-props";
import { useSetupState } from "../use-setup-state";
import { previewPage } from "../preview-page";
import { ChooseAI, type ChooseAIPage } from "./choose-ai";

/** How long the account check may take before the plans show anyway. */
const SLOW_CHECK_MS = 10_000;

/** The plan step's pages: the plan pages, and the other AI choices under them. */
type PlanStepPage = PlanPage | { initial: ChooseAIPage; kind: "use-instead" };

/**
 * The plan, for someone signed in to Instrument with no subscription and no
 * trial running: the plan pages (`usePlanPages`). Under the cards it offers
 * a subscription they already pay for, and while no free trial can start,
 * an API key too. Answered once a trial starts, Checkout completes, or
 * another way connects.
 */
export function PlanStep({ hold, onBack, onContinue }: SetupStepProps) {
  const [preview] = useState(() => previewPage<PlanStepPage>("plan"));
  const [useInstead, setUseInstead] = useState<null | ChooseAIPage>(
    preview?.kind === "use-instead" ? preview.initial : null,
  );
  // Until the account's billing status is read, the plans may not be asked
  // at all (a subscriber's sign-in moves setup past them), so they wait.
  const isCheckingPlan = useSetupState()?.facts.isCheckingPlan ?? false;
  const [isCheckSlow, setIsCheckSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setIsCheckSlow(true);
    }, SLOW_CHECK_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  const plan = usePlanPages({
    cardsFooter: { onBack },
    cardsNote: (trialShown) => (
      <p className="mt-5 text-sm text-muted-foreground" data-use-instead>
        Already pay for ChatGPT, Claude, or Grok?{" "}
        <InlineLink
          onClick={() => {
            setUseInstead({ kind: "subscriptions" });
          }}
        >
          Use your existing subscriptions
        </InlineLink>
        {!trialShown && (
          <>
            , or{" "}
            <InlineLink
              onClick={() => {
                hold();
                setUseInstead({ kind: "key" });
              }}
            >
              add an API key
            </InlineLink>
            .
          </>
        )}
      </p>
    ),
    hold,
    initialPage: preview?.kind === "use-instead" ? undefined : preview,
    isChecking: isCheckingPlan && !isCheckSlow,
    onDone: onContinue,
  });

  return (
    <SetupPageSwitch
      depth={useInstead ? 1 : PLAN_PAGE_DEPTH[plan.kind]}
      page={useInstead ? "use-instead" : plan.kind}
    >
      {useInstead ? (
        <ChooseAI
          hold={hold}
          initial={useInstead}
          offerInstrument={false}
          onDone={onContinue}
          onLeave={() => {
            setUseInstead(null);
          }}
        />
      ) : (
        plan.page
      )}
    </SetupPageSwitch>
  );
}

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
