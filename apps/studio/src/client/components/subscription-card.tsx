import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { Progress } from "@/client/components/ui/progress";
import { useTabActions } from "@/client/hooks/use-tab-actions";
import { rpcClient } from "@/client/rpc/client";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { useHasLifetime } from "../hooks/use-entitlements";
import { useLiveSubscriptionStatus } from "../hooks/use-live-subscription-status";

export function SubscriptionCard() {
  const { addTab } = useTabActions();
  const {
    data: subscription,
    error,
    isLoading,
    refetch,
  } = useLiveSubscriptionStatus({
    input: { staleTime: 0 },
  });
  const hasLifetime = useHasLifetime();
  const { mutateAsync: createPortalSession } = useMutation(
    rpcClient.stripe.createPortalSession.mutationOptions(),
  );
  const { mutateAsync: openExternalLink } = useMutation(
    rpcClient.utils.openExternalLink.mutationOptions(),
  );

  const openLifetimeTab = () => {
    void addTab({ to: "/get-lifetime" });
    window.close();
  };

  const handleManageSubscription = async () => {
    try {
      const { url } = await createPortalSession();
      if (url) {
        await openExternalLink({ url });
      } else {
        toast.error("Failed to create portal session");
      }
    } catch {
      toast.error("Failed to create portal session");
    }
  };

  if (error) {
    return (
      <Card className="p-4">
        <div className="space-y-4">
          <div>
            <h4 className="mb-1 font-medium">Account</h4>
            <p className="text-sm text-destructive">
              Failed to load account status
            </p>
          </div>
          <Button onClick={() => void refetch()}>Retry</Button>
        </div>
      </Card>
    );
  }

  if (isLoading || !subscription) {
    return (
      <Card className="p-4">
        <div className="space-y-6">
          <div>
            <h4 className="mb-1 font-medium">Account</h4>
            <p className="text-sm text-muted-foreground">Loading status...</p>
          </div>
        </div>
      </Card>
    );
  }

  const hasSubscription =
    subscription.plan !== null &&
    subscription.plan !== "Lifetime" &&
    subscription.plan !== "Credits";
  const hasPaidEntitlement = hasLifetime || hasSubscription;
  const displayUsagePercent = hasPaidEntitlement
    ? subscription.usagePercent
    : subscription.freeUsagePercent;
  const isLifetimeOutOfCredits = hasLifetime && !subscription.hasEnoughCredits;

  // Lifetime users get a license-first layout. If they happen to also have a
  // paid subscription, surface it secondarily below the license.
  if (hasLifetime) {
    return (
      <Card className="p-4">
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="font-medium">Credits</span>
              <span className="text-muted-foreground">
                {displayUsagePercent.toFixed(0)}% used
              </span>
            </div>
            <Progress value={displayUsagePercent} />
            {subscription.nextAllocation && (
              <p className="text-xs text-muted-foreground">
                Next credit allocation on{" "}
                {new Date(subscription.nextAllocation).toLocaleDateString()}
              </p>
            )}
            {isLifetimeOutOfCredits && !subscription.nextAllocation && (
              <p className="text-xs text-muted-foreground">
                You&apos;ve used your included credits.
              </p>
            )}
          </div>

          {hasSubscription && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">Subscription</span>
                <Badge variant="outline">{subscription.plan}</Badge>
              </div>
              <Button onClick={handleManageSubscription} variant="outline">
                Manage
              </Button>
            </div>
          )}
        </div>
      </Card>
    );
  }

  const planLabel = subscription.plan ?? "Free";

  return (
    <Card className="p-4">
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h4 className="font-medium">
                {hasSubscription ? "Subscription & Usage" : "Plan & Usage"}
              </h4>
              <Badge variant="outline">{planLabel}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {hasSubscription
                ? "Manage your plan and view credit usage"
                : "Sign up for a plan to unlock more credits"}
            </p>
          </div>
          {!hasPaidEntitlement && (
            <Button
              className="shrink-0 gap-1.5"
              onClick={openLifetimeTab}
              variant="brand"
            >
              Get more credits
            </Button>
          )}
        </div>

        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="font-medium">
                {hasPaidEntitlement ? "Credit Usage" : "Free Usage"}
              </span>
              <span className="text-muted-foreground">
                {displayUsagePercent.toFixed(0)}% used
              </span>
            </div>
            <Progress value={displayUsagePercent} />
          </div>
          {subscription.nextAllocation && (
            <p className="text-xs text-muted-foreground">
              Next credit allocation on{" "}
              {new Date(subscription.nextAllocation).toLocaleDateString()}
            </p>
          )}
          {hasSubscription && (
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button onClick={handleManageSubscription}>
                Manage Subscription
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
