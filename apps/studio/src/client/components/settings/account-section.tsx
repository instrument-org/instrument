import { openReportDialog } from "@/client/atoms/report-dialog";
import { AccountInfo } from "@/client/components/account-info";
import { SettingsSection } from "@/client/components/settings/general-section";
import { settingAnchor } from "@/client/components/settings/settings-index";
import { StateArrival } from "@/client/components/state-arrival";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { Progress } from "@/client/components/ui/progress";
import { Skeleton } from "@/client/components/ui/skeleton";
import { useBillingStatus } from "@/client/hooks/use-billing-status";
import {
  canStartTrial,
  checkoutTrialLine,
  describeDate,
  describeDay,
  describeWhen,
  formatPriceInWords,
  freeAllowancePause,
  hasPaymentFailed,
  isAccessRevoked,
  isTrialHeldBack,
  scheduledPlanChange,
  subscribedPlan,
  subscriptionEndsAt,
  subscriptionPhaseLine,
  windowLabel,
} from "@/client/lib/billing";
import { openAccount, openPlans } from "@/client/lib/billing-website";
import { feedbackReport } from "@/client/lib/problem-reports";
import { cn } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { WarningIcon } from "@phosphor-icons/react/Warning";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode } from "react";

type Status = RPCOutput["billing"]["status"];

/**
 * Settings > Account: who is logged in, then the plan and how it is paid,
 * then how much of its limits is used, as percentages and reset times.
 * Choosing, changing, keeping and paying for the plan all happen on the
 * website: the plans for an account with none, the account's page for one
 * with a subscription. A ChatGPT or Claude account is a provider, so it
 * lives in Providers, not here.
 */
export function AccountSection() {
  const { isSignedIn } = useBillingStatus();
  return (
    <div className="space-y-4">
      <SettingsSection title="Account">
        <AccountInfo />
      </SettingsSection>
      {isSignedIn && <PlanAndLimits />}
    </div>
  );
}

function PlanAndLimits() {
  const { data: status, error, isLoading, refetch } = useBillingStatus();

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
            {...settingAnchor("plan")}
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
  const now = new Date();
  const plan = subscribedPlan(status, offer);
  const change = scheduledPlanChange(status, offer);
  const subscription = status.subscription;
  // The plan settles in when a change made on the website lands as the
  // window takes focus.
  const arrival = [
    status.plan,
    subscription?.status,
    subscriptionEndsAt(status)?.toISOString(),
    subscription?.scheduledChange?.plan,
  ].join(" ");

  if (isAccessRevoked(status)) {
    return (
      <SettingsSection title="Plan">
        <StateArrival state={arrival}>
          <Card className="gap-0 overflow-hidden p-0">
            <Row
              {...settingAnchor("plan")}
              data-billing-row="access-revoked"
              detail="Get in touch and we'll sort it out."
              title={`${APP_NAME} isn't available on this account`}
            >
              <Button
                onClick={() => {
                  openReportDialog(
                    feedbackReport({ surface: "access-revoked" }),
                  );
                }}
                size="sm"
              >
                Contact support
              </Button>
            </Row>
            <Row
              {...settingAnchor("billing-portal")}
              data-billing-row="billing"
              detail="Your card and invoices, in Stripe"
              title="Payment method and invoices"
            >
              <Button onClick={openAccount} size="sm">
                Manage billing
              </Button>
            </Row>
          </Card>
        </StateArrival>
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
    const phaseLine = subscriptionPhaseLine(status, price, now);
    return (
      <SettingsSection title="Plan">
        <StateArrival state={arrival}>
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
                <Button onClick={openAccount} size="sm">
                  Update card
                </Button>
              </div>
            )}
            <Row
              {...settingAnchor("plan")}
              data-billing-row="plan"
              detail={
                paymentFailed
                  ? "Payment overdue"
                  : endsAt
                    ? `Ends ${describeDate(endsAt, now)}`
                    : change
                      ? `Switches to ${change.name} on ${describeDate(change.at, now)}. You keep ${plan?.name ?? "this plan"} until then.`
                      : phaseLine
                        ? phaseLine
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
                <Button onClick={openAccount} size="sm">
                  Keep my plan
                </Button>
              ) : (
                <Button onClick={openAccount} size="sm">
                  {change ? "Keep my plan" : "Change plan"}
                </Button>
              )}
            </Row>
            <Row
              {...settingAnchor("billing-portal")}
              data-billing-row="billing"
              detail="Your card and invoices, in Stripe"
              title="Payment method and invoices"
            >
              <Button onClick={openAccount} size="sm">
                Manage billing
              </Button>
            </Row>
          </Card>
        </StateArrival>
      </SettingsSection>
    );
  }

  const trialEndsAt = status.trial.endsAt
    ? new Date(status.trial.endsAt)
    : undefined;
  const trialHeldBack = isTrialHeldBack(status, offer);
  const isTrial =
    status.plan === "trial" && status.trial.state !== "ended" && !trialHeldBack;
  const days = offer?.trial?.days;
  const offerTrial = canStartTrial(status, offer);
  const freePause = freeAllowancePause(status, now);
  const actions = (
    <Button
      className="shrink-0"
      onClick={() => {
        openPlans();
      }}
      size="sm"
    >
      {offerTrial ? "Start free trial" : "Choose a plan"}
    </Button>
  );
  return (
    <SettingsSection title="Plan">
      <StateArrival state={arrival}>
        <Card className="gap-0 p-0">
          {freePause && (
            <div
              className="flex items-center gap-3 border-b border-border px-4 py-3"
              data-billing-row="free-paused"
            >
              <WarningIcon className="size-4 shrink-0 text-warning-700 dark:text-warning-300" />
              <p className="min-w-0 flex-1 text-sm">
                {freePause.resetsAt
                  ? `You've used your free web search, images and suggestions until ${describeDate(freePause.resetsAt, now)}.`
                  : "You've used your free web search, images and suggestions for now."}
              </p>
              {actions}
            </div>
          )}
          <Row
            {...settingAnchor("plan")}
            data-billing-row="plan"
            detail={
              isTrial
                ? trialEndsAt
                  ? `Ends ${describeDay(trialEndsAt)}`
                  : undefined
                : [
                    offerTrial && days
                      ? `Your free trial gives you ${days} days of ${APP_NAME}'s models, with no card needed.`
                      : checkoutTrialLine(offer),
                    `${APP_NAME}'s models need a plan. Your ChatGPT, Claude or Grok account, or your own key, works without one.`,
                  ]
                    .filter(Boolean)
                    .join(" ")
            }
            title={isTrial ? "Free trial" : "No plan"}
          >
            {isTrial ? (
              <Button
                onClick={() => {
                  openPlans();
                }}
                size="sm"
              >
                Choose a plan
              </Button>
            ) : (
              !freePause && actions
            )}
          </Row>
        </Card>
      </StateArrival>
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
      <SettingsSection title="Usage limits">
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
  // The free allowance's window is said in Plan, only once it is spent.
  if (status.windows.length === 0 || status.plan === "free") {
    return null;
  }
  return (
    <SettingsSection title="Usage limits">
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
  "data-setting"?: string;
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
