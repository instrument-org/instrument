import { openLogin } from "@/client/atoms/login-modal";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { Skeleton } from "@/client/components/ui/skeleton";
import { useLiveUser } from "@/client/hooks/use-live-user";
import { logOut } from "@/client/lib/log-out";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { useQuery } from "@tanstack/react-query";

import { ContactErrorAlert } from "./contact-error-alert";
import { SubscriptionCard } from "./subscription-card";
import { UserInfoCard } from "./user-info-card";

export function AccountInfo() {
  const { data: hasToken } = useQuery(
    rpcClient.auth.live.hasToken.experimental_liveOptions(),
  );
  const {
    data: user,
    error,
    isLoading,
    refetch,
  } = useLiveUser({
    input: { staleTime: 0 },
  });

  return (
    <div className="space-y-3">
      {user?.id ? (
        <>
          <UserInfoCard />
          <SubscriptionCard />
        </>
      ) : (
        <Card className="p-4">
          <div className="space-y-3">
            {hasToken ? (
              <>
                {isLoading && (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Skeleton className="size-10 shrink-0 rounded-full" />
                      <div className="space-y-2">
                        <Skeleton className="h-5 w-32" />
                        <Skeleton className="h-4 w-48" />
                      </div>
                    </div>
                    <Button
                      onClick={() => {
                        void logOut();
                      }}
                    >
                      Log out
                    </Button>
                  </div>
                )}
                {!user && error && (
                  <>
                    <ContactErrorAlert
                      onRetry={() => {
                        void refetch();
                      }}
                      title="Connection error"
                    >
                      {error.message}
                    </ContactErrorAlert>
                    <div className="flex justify-end gap-4">
                      <Button
                        onClick={() => {
                          void logOut();
                        }}
                      >
                        Log out
                      </Button>
                    </div>
                  </>
                )}
                {!isLoading && !error && (
                  <div className="flex justify-end gap-4">
                    <Button
                      onClick={() => {
                        void logOut();
                      }}
                    >
                      Log out
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center gap-5">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="text-sm font-medium">Log in to {APP_NAME}</p>
                  <p className="text-xs text-muted-foreground">
                    You&apos;re using {APP_NAME} without an account. Create an
                    account to claim free AI usage and try the app.
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    onClick={() => {
                      openLogin({ hideManualProvider: true });
                    }}
                    variant="outline"
                  >
                    Log in
                  </Button>
                  <Button
                    onClick={() => {
                      openLogin({ hideManualProvider: true });
                    }}
                    variant="brand"
                  >
                    Sign up
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
