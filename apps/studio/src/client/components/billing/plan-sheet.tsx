import { planSheetAtom } from "@/client/atoms/plan-sheet";
import { PlanCards } from "@/client/components/billing/plan-cards";
import { usePlanCheckout } from "@/client/components/billing/use-plan-checkout";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Spinner } from "@/client/components/ui/spinner";
import { useBillingStatus } from "@/client/hooks/use-billing-status";
import { useBlockTabNavigation } from "@/client/hooks/use-block-tab-navigation";
import { rpcClient } from "@/client/rpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { toast } from "sonner";

/**
 * The plan picker as a sheet over whatever opened it, a chat or Settings.
 * Subscribing hands off to Stripe Checkout in the browser and waits there
 * for the subscription to land; switching a live subscription goes through
 * the API. Mounted once at the window root, with the app-wide modals.
 */
export function PlanSheet() {
  const [state, setState] = useAtom(planSheetAtom);
  const isOpen = state !== null;
  useBlockTabNavigation(isOpen);

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          setState(null);
        }
      }}
      open={isOpen}
    >
      {isOpen && (
        <DialogContent
          className="bg-background px-10 pt-10 pb-8"
          maxWidth="47.5rem"
        >
          <PlanSheetBody
            onDone={() => {
              setState(null);
            }}
            preselect={state.preselect}
          />
        </DialogContent>
      )}
    </Dialog>
  );
}

function PlanSheetBody({
  onDone,
  preselect,
}: {
  onDone: () => void;
  preselect: string | undefined;
}) {
  const { data: status, refetch } = useBillingStatus();
  const { data: offer, error: offerError } = useQuery(
    rpcClient.billing.offer.queryOptions(),
  );
  const checkout = usePlanCheckout({ onSubscribed: onDone });
  const changePlan = useMutation(
    rpcClient.billing.changePlan.mutationOptions({
      onError: () => {
        toast.error("Couldn't change your plan");
      },
      onSuccess: ({ via }) => {
        if (via === "portal") {
          toast("Finish switching plans in your browser");
        }
        void refetch();
        onDone();
      },
    }),
  );

  if (checkout.waitingFor) {
    return (
      <WaitingForStripe
        isOpening={checkout.isOpening}
        onBack={checkout.cancel}
        onOpenAgain={checkout.reopen}
      />
    );
  }

  const isChanging = status?.subscription !== undefined && !status.canSubscribe;

  return (
    <div className="flex flex-col items-center">
      <DialogTitle className="text-center font-serif text-[28px] leading-tight font-medium tracking-tight">
        {isChanging ? "Change your plan" : "Choose a plan"}
      </DialogTitle>
      <DialogDescription className="mt-2.5 max-w-135 text-center text-sm leading-relaxed text-muted-foreground">
        {isChanging
          ? "You'll pay the difference for the rest of this month. Your limits go up as soon as it's paid."
          : "Every plan includes everything. You'll finish in your browser."}
      </DialogDescription>
      <div className="mt-7">
        {offer ? (
          <PlanCards
            busyPlan={
              changePlan.isPending
                ? changePlan.variables.plan
                : checkout.isOpening
                  ? checkout.waitingFor
                  : null
            }
            offer={offer}
            onChoose={(plan, action) => {
              if (action === "switch") {
                changePlan.mutate({ plan: plan.key });
              } else if (action === "subscribe") {
                checkout.start(plan.key);
              }
            }}
            preselect={preselect}
            status={status}
          />
        ) : offerError ? (
          <p className="text-sm text-destructive">
            Couldn&rsquo;t load the plans. Try again in a moment.
          </p>
        ) : (
          <Spinner className="size-5 text-muted-foreground" />
        )}
      </div>
    </div>
  );
}

/**
 * Checkout is open in the browser: where to finish, that the app is
 * listening, and the way back to it should the tab have closed.
 */
export function WaitingForStripe({
  isOpening,
  onBack,
  onOpenAgain,
}: {
  isOpening: boolean;
  onBack?: () => void;
  onOpenAgain: () => void;
}) {
  return (
    <div className="flex flex-col items-center py-6">
      <DialogTitle className="text-center font-serif text-[28px] leading-tight font-medium tracking-tight">
        Finish in your browser
      </DialogTitle>
      <DialogDescription className="mt-2.5 max-w-120 text-center text-sm leading-relaxed text-muted-foreground">
        Checkout opened in your browser. Pay there, and you&rsquo;ll come right
        back.
      </DialogDescription>
      <WaitingForStripeStatus
        isOpening={isOpening}
        onBack={onBack}
        onOpenAgain={onOpenAgain}
      />
    </div>
  );
}

/** The listening half of the handoff, for a screen that has its own heading. */
export function WaitingForStripeStatus({
  isOpening,
  onBack,
  onOpenAgain,
}: {
  isOpening: boolean;
  onBack?: () => void;
  onOpenAgain: () => void;
}) {
  return (
    <>
      <div
        className="mt-8 flex items-center gap-2 text-[13px] text-muted-foreground"
        data-waiting-for-stripe
      >
        <span className="size-1.5 animate-pulse rounded-full bg-brand-500" />
        Waiting for Stripe
      </div>
      <div className="mt-3 flex items-center gap-4">
        <Button
          className="h-auto p-0 text-[13px] font-medium text-muted-foreground underline decoration-foreground/20 underline-offset-4"
          disabled={isOpening}
          onClick={onOpenAgain}
          variant="link"
        >
          Open it again
        </Button>
        {onBack && (
          <Button
            className="h-auto p-0 text-[13px] font-medium text-muted-foreground"
            onClick={onBack}
            variant="link"
          >
            Back
          </Button>
        )}
      </div>
    </>
  );
}
