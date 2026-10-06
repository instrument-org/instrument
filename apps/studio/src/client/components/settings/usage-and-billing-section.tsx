import { openLogin } from "@/client/atoms/login-modal";
import { openPlanSheet } from "@/client/atoms/plan-sheet";
import { SettingsSection } from "@/client/components/settings/general-section";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { Progress } from "@/client/components/ui/progress";
import { Skeleton } from "@/client/components/ui/skeleton";
import { useBillingStatus } from "@/client/hooks/use-billing-status";
import { useOpenExternalLink } from "@/client/hooks/use-open-external-link";
import {
  describeDate,
  describeDay,
  describeWhen,
  formatPriceInWords,
  hasPaymentFailed,
  isAccessRevoked,
  subscribedPlan,
  subscriptionEndsAt,
  windowLabel,
} from "@/client/lib/billing";
import { cn } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { APP_NAME, SUPPORT_URL } from "@instrument-org/shared";
import { WarningIcon } from "@phosphor-icons/react/Warning";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode } from "react";
import { toast } from "sonner";

type Status = RPCOutput["billing"]["status"];

/**
 * Settings > Usage and billing: the plan and how it is paid first, then how
 * much of it is used, as percentages and reset times. Changing the plan opens
 * the plan sheet; the card, invoices, and canceling are Stripe's portal.
 * Signing in with ChatGPT is a provider, so it lives in Providers, not here.
 */
export function UsageAndBillingSection() {
  const {
    data: status,
    error,
    isLoading,
    isSignedIn,
    refetch,
  } = useBillingStatus();

  if (!isSignedIn) {
    return (
      <SettingsSection title="Plan">
        <Card className="gap-0 p-0">
          <Row
            detail={`Sign in to use ${APP_NAME}'s AI. Your own key and ChatGPT work without an account.`}
            title="Not signed in"
          >
            <Button
              onClick={() => {
                openLogin({ hideManualProvider: true });
              }}
              size="sm"
              variant="brand"
            >
              Log in
            </Button>
          </Row>
        </Card>
      </SettingsSection>
    );
  }

  if (isLoading) {
    return (
      <SettingsSection title="Plan">
        <Card className="gap-3 p-4">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-64" />
        </Card>
      </SettingsSection>
    );
  }

  if (!status) {
    return (
      <SettingsSection title="Plan">
        <Card className="gap-0 p-0">
          <Row
            detail={error?.message ?? "Try again in a moment."}
            title="Couldn't load your plan"
          >
            <Button
              onClick={() => {
                void refetch();
              }}
              size="sm"
            >
              Try again
            </Button>
          </Row>
        </Card>
      </SettingsSection>
    );
  }

  return (
    <div className="space-y-4">
      <PlanGroup status={status} />
      <UsageGroup status={status} />
    </div>
  );
}

function PlanGroup({ status }: { status: Status }) {
  const { data: offer } = useQuery(rpcClient.billing.offer.queryOptions());
  const openLink = useOpenExternalLink();
  const portal = useMutation(
    rpcClient.billing.openPortal.mutationOptions({
      onError: () => {
        toast.error("Couldn't open billing");
      },
    }),
  );
  const openPortal = () => {
    portal.mutate(undefined);
  };
  const now = new Date();
  const plan = subscribedPlan(status, offer);
  const subscription = status.subscription;

  if (isAccessRevoked(status)) {
    return (
      <SettingsSection title="Plan">
        <Card className="gap-0 overflow-hidden p-0">
          <Row
            data-billing-row="access-revoked"
            detail="Get in touch and we'll sort it out."
            title={`${APP_NAME}'s AI isn't available on this account`}
          >
            <Button
              onClick={() => {
                openLink(SUPPORT_URL);
              }}
              size="sm"
            >
              Contact support
            </Button>
          </Row>
          <Row
            data-billing-row="billing"
            detail="Your card and invoices, in Stripe"
            title="Payment method and invoices"
          >
            <Button disabled={portal.isPending} onClick={openPortal} size="sm">
              Manage billing
            </Button>
          </Row>
        </Card>
      </SettingsSection>
    );
  }

  if (subscription) {
    const endsAt = subscriptionEndsAt(status);
    const renewsAt = subscription.currentPeriodEnd
      ? new Date(subscription.currentPeriodEnd)
      : undefined;
    const price = plan ? formatPriceInWords(plan.price) : "";
    const paymentFailed = hasPaymentFailed(status);
    return (
      <SettingsSection title="Plan">
        <Card className="gap-0 overflow-hidden p-0">
          {paymentFailed && (
            <div
              className="flex items-center gap-3 border-b border-border px-4 py-3"
              data-billing-row="payment-failed"
            >
              <WarningIcon className="size-4 shrink-0 text-warning-700 dark:text-warning-300" />
              <p className="min-w-0 flex-1 text-sm">
                Your payment didn&rsquo;t go through. {APP_NAME}&rsquo;s AI is
                paused until it does.
              </p>
              <Button
                disabled={portal.isPending}
                onClick={openPortal}
                size="sm"
              >
                Update card
              </Button>
            </div>
          )}
          <Row
            data-billing-row="plan"
            detail={
              paymentFailed
                ? "Payment overdue"
                : endsAt
                  ? `Ends ${describeDate(endsAt, now)}`
                  : renewsAt
                    ? `Renews ${describeDate(renewsAt, now)}`
                    : undefined
            }
            // Status names no plan while a payment is owed, since none is in
            // effect; the row then says only that there is a subscription.
            title={
              plan
                ? [plan.name, price].filter(Boolean).join(" · ")
                : "Your subscription"
            }
          >
            {paymentFailed ? null : endsAt ? (
              <Button
                disabled={portal.isPending}
                onClick={openPortal}
                size="sm"
              >
                Keep my plan
              </Button>
            ) : (
              <Button
                onClick={() => {
                  openPlanSheet();
                }}
                size="sm"
              >
                Change plan
              </Button>
            )}
          </Row>
          <Row
            data-billing-row="billing"
            detail="Your card and invoices, in Stripe"
            title="Payment method and invoices"
          >
            <Button disabled={portal.isPending} onClick={openPortal} size="sm">
              Manage billing
            </Button>
          </Row>
        </Card>
      </SettingsSection>
    );
  }

  const trialEndsAt = status.trial.endsAt
    ? new Date(status.trial.endsAt)
    : undefined;
  const isTrial = status.plan === "trial" && status.trial.state !== "ended";
  const days = offer?.trial?.days;
  return (
    <SettingsSection title="Plan">
      <Card className="gap-0 p-0">
        <Row
          data-billing-row="plan"
          detail={
            isTrial
              ? trialEndsAt
                ? `Ends ${describeDay(trialEndsAt)}`
                : `Starts with your first message to ${APP_NAME}'s AI${days ? ` and runs ${days} days` : ""}.`
              : `${APP_NAME}'s models need a plan. Your own key and ChatGPT work without one.`
          }
          title={isTrial ? "Free trial" : "No plan"}
        >
          <Button
            onClick={() => {
              openPlanSheet();
            }}
            size="sm"
          >
            Choose a plan
          </Button>
        </Row>
      </Card>
    </SettingsSection>
  );
}

function UsageGroup({ status }: { status: Status }) {
  const now = new Date();
  if (status.plan === "trial") {
    if (status.trial.state !== "active") {
      return null;
    }
    const endsAt = status.trial.endsAt
      ? new Date(status.trial.endsAt)
      : undefined;
    return (
      <SettingsSection title="Usage">
        <Card className="gap-0 px-4 py-2">
          <Meter
            detail={
              endsAt
                ? `Ends ${describeDay(endsAt)}, or when it's used up`
                : "Ends when it's used up"
            }
            label="Free trial"
            percent={status.trial.percentUsed ?? 0}
          />
        </Card>
      </SettingsSection>
    );
  }
  if (status.windows.length === 0) {
    return null;
  }
  return (
    <SettingsSection title="Usage">
      <Card className="gap-0 px-4 py-2">
        {status.windows.map((window) => (
          <Meter
            detail={
              window.resetsAt
                ? `Resets ${describeWhen(new Date(window.resetsAt), now)}`
                : "Starts with your next message"
            }
            key={window.key}
            label={windowLabel(window.key)}
            percent={window.percentUsed}
          />
        ))}
      </Card>
    </SettingsSection>
  );
}

function Row({
  children,
  detail,
  title,
  ...props
}: {
  children?: ReactNode;
  "data-billing-row"?: string;
  detail?: string;
  title: string;
}) {
  return (
    <div
      className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
      {...props}
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        {detail && (
          <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>
        )}
      </div>
      {children}
    </div>
  );
}

function Meter({
  detail,
  label,
  percent,
}: {
  detail: string;
  label: string;
  percent: number;
}) {
  const shown = Math.min(100, Math.max(0, Math.round(percent)));
  const isHigh = shown >= 80;
  return (
    <div className="py-2" data-billing-meter={label}>
      <div className="flex items-baseline text-xs">
        <span className="flex-1 font-medium">{label}</span>
        <span
          className={cn(
            isHigh
              ? "font-medium text-warning-700 dark:text-warning-300"
              : "text-muted-foreground",
          )}
        >
          {shown}% used
        </span>
      </div>
      <Progress className="mt-1.5 h-1.5" value={shown} />
      <div className="mt-1 text-[11px] text-muted-foreground">{detail}</div>
    </div>
  );
}
