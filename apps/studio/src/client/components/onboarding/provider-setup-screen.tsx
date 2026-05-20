import { AddProviderForm } from "@/client/components/add-provider/form";
import { AppIconStylized } from "@/client/components/app-icon-stylized";
import { ExternalLink } from "@/client/components/external-link";
import { GoogleLoginButton } from "@/client/components/google-login-button";
import { TermsFooter } from "@/client/components/terms-footer";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME, SUPPORT_URL } from "@instrument-org/shared";
import { WarningCircleIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "../ui/button";

export type ProviderSetupPage = "add-provider" | "welcome";

export function ProviderSetupScreen({
  error,
  hideManualProvider,
  onAddProvider,
  onBack,
  onContinue,
  onLogin,
  onLoginSuccess,
  onPageChange,
  page,
}: {
  error?: Error | null;
  hideManualProvider?: boolean;
  onAddProvider?: () => void;
  onBack?: () => void;
  onContinue: () => void;
  onLogin: () => Promise<void>;
  onLoginSuccess: () => void;
  onPageChange: (page: ProviderSetupPage) => void;
  page: ProviderSetupPage;
}) {
  const { data: providerConfigs } = useQuery(
    rpcClient.providerConfig.live.list.experimental_liveOptions(),
  );

  if (page === "add-provider") {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto px-11 pt-6 pb-11">
          <AddProviderForm
            onBack={onBack}
            onSuccess={() => {
              onPageChange("welcome");
              onContinue();
            }}
            providers={providerConfigs ?? []}
            submitLabel="Next"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <div className="flex w-full flex-col items-center gap-8">
          <div className="flex flex-col items-center gap-6">
            <AppIconStylized className="size-20 drop-shadow-md" />

            <div className="flex flex-col items-center gap-2 text-center">
              <h1 className="font-serif text-3xl font-medium tracking-tight text-foreground">
                {`Log in to ${APP_NAME}`}
              </h1>
              <p className="text-sm text-foreground/80">
                A guided AI workspace for ambitious work
              </p>
            </div>
          </div>

          <div className="flex w-full max-w-xs flex-col items-center gap-2.5">
            {error && (
              <div className="w-full rounded-lg bg-muted px-3 py-2.5">
                <div className="mb-1.5 flex items-center gap-1.5">
                  <WarningCircleIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="text-xs font-medium text-foreground/80">
                    Login failed
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  There was an error logging in. Please try again, or{" "}
                  <ExternalLink
                    className="underline underline-offset-2 hover:text-foreground"
                    href={SUPPORT_URL}
                  >
                    contact support
                  </ExternalLink>
                  .
                </p>
              </div>
            )}

            <GoogleLoginButton
              className="w-full justify-center"
              onLogin={onLogin}
              onSuccess={onLoginSuccess}
            />

            {!hideManualProvider && (
              <Button
                className="w-full justify-center bg-white/30 text-foreground/70
                  hover:bg-white/40 dark:bg-white/5 dark:hover:bg-white/10"
                onClick={
                  onAddProvider ??
                  (() => {
                    onPageChange("add-provider");
                  })
                }
                type="button"
                variant="ghost"
              >
                Or add an AI provider manually
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="shrink-0 px-6 pb-6">
        <TermsFooter />
      </div>
    </div>
  );
}
