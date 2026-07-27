import { openSettings } from "@/client/atoms/settings-modal";
import { ExternalLink } from "@/client/components/external-link";
import { BrandLeafIcon } from "@/client/components/icons/brand-leaf";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { Progress } from "@/client/components/ui/progress";
import { immediateClickHandlers } from "@/client/lib/immediate-click";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME, SUPPORT_URL } from "@instrument-org/shared";
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

  if (subscription.hasEnoughCredits) {
    return (
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <BrandLeafIcon className="size-3" />
              <h4 className="text-sm font-medium">Free AI usage enabled</h4>
              {hasSubscription && <Badge variant="outline">{planLabel}</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
              {APP_NAME} includes free AI usage so you can try the app.
            </p>
          </div>
          {hasSubscription && (
            <Button onClick={handleManageSubscription}>
              Manage Subscription
            </Button>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="space-y-4">
        <div>
          <h4 className="text-sm leading-none font-medium">{APP_NAME} Free</h4>
        </div>

        <div className="space-y-1">
          <p className="text-sm font-semibold">
            You&apos;ve enjoyed all of your free AI usage
          </p>
          <div className="flex items-baseline justify-between gap-4 text-sm text-muted-foreground">
            <p>
              <ExternalLink className="underline" href={SUPPORT_URL}>
                Contact us
              </ExternalLink>
              {" or "}
              <button
                className="underline"
                {...immediateClickHandlers<HTMLButtonElement>({
        onClick: () => {
                  openSettings({ tab: "Providers" });
                },
      })}
                type="button"
              >
                add API keys
              </button>{" "}
              to use {APP_NAME} with your AI provider of choice
            </p>
            <span className="shrink-0">
              {displayUsagePercent.toFixed(0)}% used
            </span>
          </div>
          <Progress
            className="[&>[data-slot=progress-indicator]]:bg-brand-400"
            value={displayUsagePercent}
          />
        </div>

        {subscription.nextAllocation && (
          <p className="text-xs text-muted-foreground">
            Next credit allocation on{" "}
            {new Date(subscription.nextAllocation).toLocaleDateString()}
          </p>
        )}

        {hasSubscription && (
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={handleManageSubscription} variant="outline">
              Manage Subscription
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
