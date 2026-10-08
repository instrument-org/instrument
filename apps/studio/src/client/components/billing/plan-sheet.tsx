import { planSheetAtom } from "@/client/atoms/plan-sheet";
import { PlanCards } from "@/client/components/billing/plan-cards";
import {
  usePlanCheckout,
  WAITING_POLL_MS,
} from "@/client/components/billing/use-plan-checkout";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Spinner } from "@/client/components/ui/spinner";
import { useBillingStatus } from "@/client/hooks/use-billing-status";
import { useBlockTabNavigation } from "@/client/hooks/use-block-tab-navigation";
import { useModalBack } from "@/client/hooks/use-modal-back";
import { rpcClient } from "@/client/rpc/client";
import { XIcon } from "@phosphor-icons/react/X";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * The plan picker as a sheet over whatever opened it, a chat or Settings.
 * Subscribing hands off to Stripe Checkout in the browser and waits there
 * for the subscription to land; switching a live subscription goes through
 * the API, and waits the same way while Stripe holds the change for payment. Mounted once at the window root, with the app-wide modals.
 */
export function PlanSheet() {
  const [state, setState] = useAtom(planSheetAtom);
  const isOpen = state !== null;
  useBlockTabNavigation(isOpen);
  // Over Settings, a back press closes the sheet and leaves Settings open.
  useModalBack(() => {
    setState(null);
  }, isOpen);

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
          maxWidth="40rem"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
          }}
          showCloseButton={false}
        >
          <div className="absolute top-3 right-3 z-10">
            <DialogClose asChild>
              <Button aria-label="Close" type="button" variant="outline">
                <XIcon className="size-4" />
              </Button>
            </DialogClose>
          </div>
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
  // A plan change waiting on its invoice: the plan it moves to, and the page
  // where that invoice is paid when the person has to do it.
  const [pendingChange, setPendingChange] = useState<null | {
    invoiceUrl?: string;
    plan: string;
  }>(null);
  const { data: status, refetch } = useBillingStatus({
    pollMs: pendingChange ? WAITING_POLL_MS : undefined,
  });
  const changeLanded =
    pendingChange !== null && status?.plan === pendingChange.plan;
  useEffect(() => {
    if (changeLanded) {
      onDone();
    }
  }, [changeLanded, onDone]);
  const { data: offer, error: offerError } = useQuery(
    rpcClient.billing.offer.queryOptions(),
  );
  const checkout = usePlanCheckout({ onSubscribed: onDone });
  const changePlan = useMutation(
    rpcClient.billing.changePlan.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't change your plan", {
          description: error.message,
        });
      },
      onSuccess: (result, { plan }) => {
        void refetch();
        if (result.status === "applied") {
          onDone();
        } else {
          setPendingChange({
            plan,
            ...(result.invoiceUrl && { invoiceUrl: result.invoiceUrl }),
          });
        }
      },
    }),
  );

  if (pendingChange) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>
            {pendingChange.invoiceUrl
              ? "Finish in your browser"
              : "Changing your plan"}
          </DialogTitle>
          <DialogDescription>
            {pendingChange.invoiceUrl
              ? "The payment for your new plan opened in your browser. Your limits go up as soon as it's paid."
              : "Your limits go up as soon as the payment goes through."}
          </DialogDescription>
        </DialogHeader>
        <WaitingForStripeStatus
          isOpening={false}
          onOpenAgain={
            pendingChange.invoiceUrl
              ? () => {
                  void rpcClient.utils.openExternalLink.call({
                    url: pendingChange.invoiceUrl ?? "",
                  });
                }
              : undefined
          }
        />
      </>
    );
  }

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
    <>
      <DialogHeader>
        <DialogTitle>
          {isChanging ? "Change your plan" : "Choose a plan"}
        </DialogTitle>
        <DialogDescription>
          {isChanging
            ? "You'll pay the difference for the rest of this month. Your limits go up as soon as it's paid."
            : "Every plan includes everything. You'll finish in your browser."}
        </DialogDescription>
      </DialogHeader>
      <div>
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
    </>
  );
}

/**
 * Checkout is open in the browser: where to finish, that the app is
 * listening, and the way back to it should the tab have closed.
 */
function WaitingForStripe({
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
      <DialogHeader>
        <DialogTitle>Finish in your browser</DialogTitle>
        <DialogDescription>
          Checkout opened in your browser. Pay there, and you&rsquo;ll come
          right back.
        </DialogDescription>
      </DialogHeader>
      <WaitingForStripeStatus
        isOpening={isOpening}
        onBack={onBack}
        onOpenAgain={onOpenAgain}
      />
    </>
  );
}

/** The listening half of the handoff, for a screen that has its own heading. */
function WaitingForStripeStatus({
  isOpening,
  onBack,
  onOpenAgain,
}: {
  isOpening: boolean;
  onBack?: () => void;
  onOpenAgain?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div
        className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted-foreground"
        data-waiting-for-stripe
      >
        <Spinner className="size-3.5" delay={0} />
        Waiting for Stripe
      </div>
      {onBack && (
        <Button onClick={onBack} size="sm" variant="ghost">
          Back
        </Button>
      )}
      {onOpenAgain && (
        <Button
          disabled={isOpening}
          onClick={onOpenAgain}
          size="sm"
          variant="outline"
        >
          Open it again
        </Button>
      )}
    </div>
  );
}
