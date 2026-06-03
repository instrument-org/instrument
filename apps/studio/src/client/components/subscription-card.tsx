import { ExternalLink } from "@/client/components/external-link";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { Progress } from "@/client/components/ui/progress";
import { rpcClient } from "@/client/rpc/client";
import { SUPPORT_URL } from "@instrument-org/shared";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { useLiveSubscriptionStatus } from "../hooks/use-live-subscription-status";

export function SubscriptionCard() {
  const {
    data: subscription,
    error,
    isLoading,
    refetch,
  } = useLiveSubscriptionStatus({
    input: { staleTime: 0 },
  });
  const { mutateAsync: createPortalSession } = useMutation(
    rpcClient.stripe.createPortalSession.mutationOptions(),
  );
  const { mutateAsync: openExternalLink } = useMutation(
    rpcClient.utils.openExternalLink.mutationOptions(),
  );

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

  const hasSubscription = subscription.plan !== null;
  const displayUsagePercent = hasSubscription
    ? subscription.usagePercent
    : subscription.freeUsagePercent;

  const planLabel = hasSubscription ? subscription.plan : "Free";

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
                ? "View your plan and credit usage"
                : "View your account and usage"}
            </p>
          </div>
        </div>

        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="font-medium">Usage</span>
              <span className="text-muted-foreground">
                {displayUsagePercent.toFixed(0)}% used
              </span>
            </div>
            <Progress value={displayUsagePercent} />
            <ExternalLink
              className="text-xs font-medium text-brand-text"
              href={SUPPORT_URL}
            >
              Get more credits
            </ExternalLink>
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
