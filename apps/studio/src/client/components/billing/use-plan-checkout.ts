import { useBillingStatus } from "@/client/hooks/use-billing-status";
import { rpcClient } from "@/client/rpc/client";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/client/lib/toast";

/**
 * How often billing is read while Checkout is open in the browser. The API
 * allows ten status reads a minute per person, shared with every other read
 * (focus, a finished turn), so this leaves room for those.
 */
export const WAITING_POLL_MS = 10_000;

/**
 * Subscribing in Stripe Checkout, in the system browser: opening it, giving
 * up waiting on it, opening a fresh one, and noticing when the subscription
 * lands. The webhook usually beats the person back to the window, so billing
 * is read on a timer while the sheet waits, as well as on focus. A payment
 * finished after the wait was canceled still counts: billing is read again
 * on focus, and the plan it lands on is the one Checkout was opened for.
 */
export function usePlanCheckout({
  onSubscribed,
}: {
  /** Called once, when billing shows the plan Checkout was opened for. */
  onSubscribed: (plan: string) => void;
}) {
  // The plan Checkout was last opened for, kept after a cancel so a payment
  // that goes through anyway is still noticed.
  const [openedFor, setOpenedFor] = useState<null | string>(null);
  const [isWaiting, setIsWaiting] = useState(false);
  const { data: status } = useBillingStatus({
    pollMs: isWaiting ? WAITING_POLL_MS : undefined,
  });
  const checkout = useMutation(
    rpcClient.billing.openCheckout.mutationOptions({
      onError: (error) => {
        setIsWaiting(false);
        toast.error("Couldn't open checkout", { description: error.message });
      },
    }),
  );

  const subscribed =
    openedFor !== null &&
    status?.subscription !== undefined &&
    status.plan === openedFor;

  // Once per plan: the caller usually closes the screen this waits on, and
  // the poll that saw the plan land may answer again before it does.
  const notified = useRef<null | string>(null);
  useEffect(() => {
    if (subscribed && openedFor && notified.current !== openedFor) {
      notified.current = openedFor;
      onSubscribed(openedFor);
    }
  }, [subscribed, openedFor, onSubscribed]);

  const open = (plan: string) => {
    notified.current = null;
    setOpenedFor(plan);
    setIsWaiting(true);
    checkout.mutate({ plan });
  };

  return {
    /** Stops waiting on the browser; the plan Checkout was for is kept. */
    cancel: () => {
      setIsWaiting(false);
    },
    isOpening: checkout.isPending,
    /** Whether the sheet is waiting on the browser right now. */
    isWaiting,
    /** The plan Checkout was last opened for, waiting on it or not. */
    openedFor,
    /** A fresh Checkout for the same plan. */
    retry: () => {
      if (openedFor) {
        open(openedFor);
      }
    },
    start: open,
  };
}
