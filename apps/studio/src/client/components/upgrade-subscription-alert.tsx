import { useLiveSubscriptionStatus } from "@/client/hooks/use-live-subscription-status";
import { useLoginSocial } from "@/client/hooks/use-login-social";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME, SUPPORT_URL } from "@instrument-org/shared";
import { useQuery } from "@tanstack/react-query";

import { ExternalLink } from "./external-link";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

export type UpgradeSubscriptionAlertState =
  | "credits-available"
  | "loading"
  | "logged-out"
  | "out-of-credits"
  | "status-error";

interface UpgradeSubscriptionAlertViewProps {
  onContinue: () => void;
  onLogin: () => void;
  state: UpgradeSubscriptionAlertState;
}

export function UpgradeSubscriptionAlert({
  onContinue,
}: {
  onContinue: () => void;
}) {
  const {
    data: subscription,
    error,
    isLoading,
  } = useLiveSubscriptionStatus({ input: { staleTime: 0 } });
  const { data: hasToken } = useQuery(
    rpcClient.auth.live.hasToken.experimental_liveOptions(),
  );
  const { login } = useLoginSocial();

  let state: UpgradeSubscriptionAlertState;
  if (error) {
    state = "status-error";
  } else if (isLoading || (hasToken && !subscription)) {
    state = "loading";
  } else if (!hasToken || !subscription) {
    state = "logged-out";
  } else if (subscription.hasEnoughCredits) {
    state = "credits-available";
  } else {
    state = "out-of-credits";
  }

  return (
    <UpgradeSubscriptionAlertView
      onContinue={onContinue}
      onLogin={() => void login()}
      state={state}
    />
  );
}

/** Pure presentational component — no data fetching. */
export function UpgradeSubscriptionAlertView({
  onContinue,
  onLogin,
  state,
}: UpgradeSubscriptionAlertViewProps) {
  if (state === "status-error") {
    return (
      <Alert>
        <AlertTitle>Unable to load subscription status</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <span>
            {/* cspell:ignore couldn */}
            We couldn&apos;t load your subscription information. Please try
            again later.
          </span>
        </AlertDescription>
      </Alert>
    );
  }

  if (state === "loading") {
    return (
      <Alert>
        <AlertTitle>
          <Skeleton className="h-5 w-48" />
        </AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <div className="flex">
            <Skeleton className="h-8 w-32" />
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  if (state === "logged-out") {
    return (
      <Alert>
        <AlertTitle>Log in required</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <span>Log in to {APP_NAME} to continue.</span>
          <div className="flex">
            <Button onClick={onLogin} size="sm" variant="brand">
              Log in
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  if (state === "credits-available") {
    return (
      <Alert>
        <AlertTitle>Ready to continue</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <span>
            You now have credits available. Click continue or send a new message
            to resume the agent.
          </span>
          <div className="flex">
            <Button onClick={onContinue} size="sm">
              Continue
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  // out-of-credits
  return (
    <Alert>
      <AlertTitle>You&apos;ve hit your credit limit</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <p>
          You don&apos;t have enough credits to continue. Contact support to get
          more.
        </p>
        {/* TODO: Route to credit-pack purchase when available. */}
        <div className="flex">
          <Button asChild size="sm" variant="brand">
            <ExternalLink href={SUPPORT_URL}>Contact support</ExternalLink>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
