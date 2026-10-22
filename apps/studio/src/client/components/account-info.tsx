import { openLogin } from "@/client/atoms/login-modal";
import { openSettings } from "@/client/atoms/settings-modal";
import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { settingAnchor } from "@/client/components/settings/settings-index";
import { LogOutButton } from "@/client/components/log-out-button";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { Skeleton } from "@/client/components/ui/skeleton";
import { useLiveUser } from "@/client/hooks/use-live-user";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME, OUR_MODELS } from "@instrument-org/shared";
import { useQuery } from "@tanstack/react-query";

import { ContactErrorAlert } from "./contact-error-alert";
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
        <UserInfoCard />
      ) : (
        <Card className="p-4">
          <div className="space-y-3" {...settingAnchor("account")}>
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
                    <LogOutButton />
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
                      <LogOutButton />
                    </div>
                  </>
                )}
                {!isLoading && !error && (
                  <div className="flex justify-end gap-4">
                    <LogOutButton />
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center gap-3 px-2 py-6 text-center">
                <AIProviderIcon
                  className="size-9"
                  colored
                  type={OUR_MODELS.providerType}
                />
                <p className="text-base font-medium">Log in to {APP_NAME}</p>
                <p className="max-w-96 text-sm text-muted-foreground">
                  Your plan, usage and billing show up here once you log in.
                </p>
                <Button
                  onClick={() => {
                    openLogin({ instrumentOnly: true }, () => {
                      openSettings({ tab: "Account" });
                    });
                  }}
                  variant="brand"
                >
                  Log in
                </Button>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
