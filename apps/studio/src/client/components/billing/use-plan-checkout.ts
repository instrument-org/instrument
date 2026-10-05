import { useBillingStatus } from "@/client/hooks/use-billing-status";
import { rpcClient } from "@/client/rpc/client";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * How often billing is read while Checkout is open in the browser. The API
 * allows ten status reads a minute per person, shared with every other read
 * (focus, a finished turn), so this leaves room for those.
 */
export const WAITING_POLL_MS = 10_000;

/**
 * Subscribing in Stripe Checkout, in the system browser: opening it, opening
 * it again for a closed tab, and noticing when the subscription lands. The
 * webhook usually beats the person back to the window, so billing is read on
 * a timer while it waits as well as on focus.
 */
export function usePlanCheckout({
  onSubscribed,
}: {
  /** Called once, when billing shows the plan Checkout was opened for. */
  onSubscribed: (plan: string) => void;
}) {
  const [waitingFor, setWaitingFor] = useState<null | string>(null);
  const { data: status } = useBillingStatus({
    pollMs: waitingFor ? WAITING_POLL_MS : undefined,
  });
  const checkout = useMutation(
    rpcClient.billing.openCheckout.mutationOptions({
      onError: (error) => {
        setWaitingFor(null);
        toast.error("Couldn't open checkout", { description: error.message });
      },
    }),
  );

  const subscribed =
    waitingFor !== null &&
    status?.subscription !== undefined &&
    status.plan === waitingFor;

  // Once per plan: the caller usually closes the screen this waits on, and
  // the poll that saw the plan land may answer again before it does.
  const notified = useRef<null | string>(null);
  useEffect(() => {
    if (subscribed && waitingFor && notified.current !== waitingFor) {
      notified.current = waitingFor;
      onSubscribed(waitingFor);
    }
  }, [subscribed, waitingFor, onSubscribed]);

  return {
    cancel: () => {
      setWaitingFor(null);
    },
    isOpening: checkout.isPending,
    reopen: () => {
      if (waitingFor) {
        checkout.mutate({ plan: waitingFor });
      }
    },
    start: (plan: string) => {
      notified.current = null;
      setWaitingFor(plan);
      checkout.mutate({ plan });
    },
    waitingFor,
  };
}
