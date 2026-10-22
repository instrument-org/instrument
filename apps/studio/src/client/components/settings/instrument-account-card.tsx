import { openLogin } from "@/client/atoms/login-modal";
import { openSettings } from "@/client/atoms/settings-modal";
import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { useBillingStatus } from "@/client/hooks/use-billing-status";
import { useLiveUser } from "@/client/hooks/use-live-user";
import { isTrialHeldBack, subscribedPlan } from "@/client/lib/billing";
import { instrumentWayCopy } from "@/client/lib/connect-copy";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME, OUR_MODELS } from "@instrument-org/shared";
import { useQuery } from "@tanstack/react-query";

/**
 * Instrument at the top of the providers. Logged out it offers an account,
 * since Providers is where people look for a way to get AI working; logged in
 * it names the account and its plan, and the account itself is managed on
 * the Account page. It has no more menu: Instrument can't be disabled, only
 * logged out of.
 */
export function InstrumentAccountCard() {
  const { data: hasToken } = useQuery(
    rpcClient.auth.live.hasToken.experimental_liveOptions(),
  );
  const { data: user } = useLiveUser();
  const { data: offer } = useQuery({
    ...rpcClient.billing.offer.queryOptions(),
    enabled: hasToken === false,
  });
  const way = instrumentWayCopy(offer);

  if (hasToken === undefined) {
    return null;
  }

  return (
    <Card
      className={cn(
        "gap-0 p-4",
        !hasToken &&
          "border-brand-200 bg-brand-50 dark:border-brand-500/30 dark:bg-brand-500/15",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center">
          <AIProviderIcon colored type={OUR_MODELS.providerType} />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-medium text-foreground">
              {hasToken ? `${APP_NAME} account` : way.title}
            </h3>
            {hasToken && <PlanBadge />}
          </div>
          <p className="truncate text-sm text-muted-foreground">
            {hasToken ? user?.email : way.line}
          </p>
        </div>
        {hasToken ? (
          <Button
            className="shrink-0"
            onClick={() => {
              openSettings({ tab: "Account" });
            }}
            variant="outline"
          >
            Account
          </Button>
        ) : (
          <Button
            className="shrink-0"
            onClick={() => {
              openLogin({ instrumentOnly: true }, () => {
                openSettings({ tab: "Providers" });
              });
            }}
            variant="brand"
          >
            {way.action}
          </Button>
        )}
      </div>
    </Card>
  );
}

function PlanBadge() {
  const { data: status } = useBillingStatus();
  const { data: offer } = useQuery(rpcClient.billing.offer.queryOptions());
  const name =
    subscribedPlan(status, offer)?.name ??
    (status?.plan === "trial" && !isTrialHeldBack(status, offer)
      ? "Free trial"
      : undefined);
  if (!name) {
    return null;
  }
  return <Badge variant="outline">{name}</Badge>;
}
