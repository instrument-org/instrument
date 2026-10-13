import { openLogin } from "@/client/atoms/login-modal";
import { openSettings } from "@/client/atoms/settings-modal";
import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { StateArrival } from "@/client/components/state-arrival";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { useBillingStatus } from "@/client/hooks/use-billing-status";
import {
  hasPaymentFailed,
  isAccessRevoked,
  subscribedPlan,
} from "@/client/lib/billing";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { APP_NAME, OUR_MODELS } from "@instrument-org/shared";
import { useQuery } from "@tanstack/react-query";

/**
 * Instrument's own AI as the first row among the providers, laid out like the
 * ChatGPT and Claude account cards beside it. Signed out, it asks the person to
 * log in; signed in, it says which plan they are on and opens Usage and
 * billing, where the plan is changed.
 */
export function InstrumentAccountCard() {
  const { data: status, isSignedIn } = useBillingStatus();
  const { data: offer } = useQuery(
    rpcClient.billing.offer.queryOptions({ enabled: isSignedIn }),
  );

  return (
    <StateArrival state={isSignedIn ? (status?.plan ?? "") : "signed-out"}>
      <Card className="gap-0 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center">
              <AIProviderIcon colored type={OUR_MODELS.providerType} />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <h3 className="truncate font-medium text-foreground">
                {APP_NAME}
              </h3>
              <p className="text-sm text-muted-foreground">
                {isSignedIn
                  ? planLine(status, offer)
                  : `Log in to use the AI that comes with ${APP_NAME}.`}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {isSignedIn ? (
              <Button
                onClick={() => {
                  openSettings({ tab: "Usage and billing" });
                }}
                variant="outline"
              >
                Usage and billing
              </Button>
            ) : (
              <Button
                onClick={() => {
                  openLogin({ instrumentOnly: true });
                }}
                variant="brand"
              >
                Log in
              </Button>
            )}
          </div>
        </div>
      </Card>
    </StateArrival>
  );
}

function planLine(
  status: RPCOutput["billing"]["status"] | undefined,
  offer: RPCOutput["billing"]["offer"] | undefined,
) {
  if (!status) {
    return "You're logged in.";
  }
  if (isAccessRevoked(status)) {
    return `${APP_NAME}'s AI isn't available on this account.`;
  }
  if (hasPaymentFailed(status)) {
    return `Your payment didn't go through, so ${APP_NAME}'s AI is paused.`;
  }
  if (status.subscription) {
    const plan = subscribedPlan(status, offer);
    return plan
      ? `You're on the ${plan.name} plan.`
      : "You have a subscription.";
  }
  if (status.plan === "trial" && status.trial.state === "active") {
    return "You're on the free trial.";
  }
  if (status.plan === "trial" && status.trial.state === "available") {
    return "Your free trial starts with your first message.";
  }
  return `Choose a plan to use ${APP_NAME}'s AI.`;
}
