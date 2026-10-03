import { useBillingStatus } from "@/client/hooks/use-billing-status";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { Progress } from "@/client/components/ui/progress";
import { formatPlanPrice, planLabel } from "@/client/lib/billing";
import { rpcClient } from "@/client/rpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

/**
 * The account's plan, trial, and usage windows, with the way to subscribe or
 * manage the subscription. A plain placeholder until the plan picker is
 * designed: it renders `billing.status` and `billing.offer` as they come.
 */
export function SubscriptionCard() {
  const { data: status, error, isLoading, refetch } = useBillingStatus();
  const { data: offer } = useQuery(rpcClient.billing.offer.queryOptions());
  const { mutate: openCheckout, isPending: isOpeningCheckout } = useMutation(
    rpcClient.billing.openCheckout.mutationOptions({
      onError: () => toast.error("Couldn't open checkout"),
    }),
  );
  const { mutate: openPortal, isPending: isOpeningPortal } = useMutation(
    rpcClient.billing.openPortal.mutationOptions({
      onError: () => toast.error("Couldn't open the billing portal"),
    }),
  );

  if (error) {
    return (
      <Card className="p-4">
        <div className="space-y-4">
          <div>
            <h4 className="mb-1 font-medium">Plan</h4>
            <p className="text-sm text-destructive">Failed to load your plan</p>
          </div>
          <Button onClick={() => void refetch()}>Retry</Button>
        </div>
      </Card>
    );
  }

  if (isLoading || !status) {
    return (
      <Card className="p-4">
        <h4 className="mb-1 font-medium">Plan</h4>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-medium">
                {status.plan === "trial" && status.trial.state === "ended"
                  ? "Free trial ended"
                  : planLabel(status.plan, offer)}
              </h4>
              {status.subscription && (
                <Badge variant="outline">{status.subscription.status}</Badge>
              )}
            </div>
            {status.plan === "trial" && status.trial.state === "active" && (
              <p className="text-xs text-muted-foreground">
                {status.trial.percentUsed ?? 0}% of the trial used
                {status.trial.endsAt &&
                  `, ends ${new Date(status.trial.endsAt).toLocaleString()}`}
              </p>
            )}
            {status.subscription?.cancelAtPeriodEnd && (
              <p className="text-xs text-muted-foreground">
                Cancels
                {status.subscription.currentPeriodEnd &&
                  ` ${new Date(status.subscription.currentPeriodEnd).toLocaleDateString()}`}
              </p>
            )}
          </div>
          {status.subscription && (
            <Button
              disabled={isOpeningPortal}
              onClick={() => {
                openPortal(undefined);
              }}
            >
              Manage subscription
            </Button>
          )}
        </div>

        {status.windows.map((window) => (
          <div className="space-y-1" key={window.key}>
            <div className="flex items-baseline justify-between gap-4 text-xs text-muted-foreground">
              <span>{window.key}</span>
              <span>
                {window.percentUsed.toFixed(0)}% used
                {window.resetsAt &&
                  `, resets ${new Date(window.resetsAt).toLocaleString()}`}
              </span>
            </div>
            <Progress value={window.percentUsed} />
          </div>
        ))}

        {status.canSubscribe && offer && offer.plans.length > 0 && (
          <div className="flex flex-wrap justify-end gap-2">
            {offer.plans.map((plan) => (
              <Button
                disabled={isOpeningCheckout}
                key={plan.key}
                onClick={() => {
                  openCheckout({ plan: plan.key });
                }}
                variant="outline"
              >
                {plan.name} {formatPlanPrice(plan.price)}
              </Button>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
