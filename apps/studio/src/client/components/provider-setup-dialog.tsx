import type { ProviderSetupPage } from "@/client/components/onboarding/provider-setup-screen";

import { ProviderSetupScreen } from "@/client/components/onboarding/provider-setup-screen";
import { OnboardingSuccessScreen } from "@/client/components/onboarding/success-screen";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { useLoginSocial } from "@/client/hooks/use-login-social";
import { SHARED } from "@/client/lib/styles";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { XIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

type Page = "success" | ProviderSetupPage;

const FIXED_HEIGHT_PAGES = new Set<Page>(["success", "welcome"]);

export function ProviderSetupDialog({
  hideManualProvider,
  onOpenChange,
  onSuccess,
  open,
}: {
  hideManualProvider?: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  open: boolean;
}) {
  const { error, login } = useLoginSocial();
  const [page, setPage] = useState<Page>("welcome");
  const { data: hasToken } = useQuery(
    rpcClient.auth.live.hasToken.experimental_liveOptions(),
  );

  // If already logged in and manual provider is hidden, there's nothing to show
  const effectivePage: Page =
    hasToken && page === "welcome" && !hideManualProvider
      ? "add-provider"
      : page;

  function close() {
    setPage("welcome");
    onOpenChange(false);
  }

  function handleSuccess() {
    setPage("success");
    onSuccess?.();
  }

  return (
    <Dialog
      onOpenChange={(next) => {
        if (next) {
          onOpenChange(true);
        } else {
          close();
        }
      }}
      open={open}
    >
      <DialogContent
        className={cn(
          `flex w-full max-w-[472px] flex-col overflow-hidden rounded-3xl
          border-0 p-0 shadow-[inset_0_0_0_2px_rgba(0,0,0,0.05)]
          dark:shadow-[inset_0_0_0_2px_rgba(255,255,255,0.05)]`,
          FIXED_HEIGHT_PAGES.has(effectivePage) && "h-[640px] max-h-[85vh]",
          effectivePage === "add-provider"
            ? SHARED.subtleGradient
            : SHARED.brandGradient,
        )}
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Add an AI provider to continue</DialogTitle>
          <DialogDescription>
            Log in with Google or add an AI provider API key to get started.
          </DialogDescription>
        </DialogHeader>
        <div className="absolute top-3 right-3 z-10">
          <DialogClose asChild>
            <Button aria-label="Close" type="button" variant="outline">
              <XIcon className="size-4" />
            </Button>
          </DialogClose>
        </div>
        {effectivePage === "success" ? (
          <OnboardingSuccessScreen onContinue={close} />
        ) : (
          <ProviderSetupScreen
            error={error}
            hideManualProvider={hideManualProvider}
            onBack={
              hasToken
                ? undefined
                : () => {
                    setPage("welcome");
                  }
            }
            onContinue={() => {
              onSuccess?.();
              close();
            }}
            onLogin={login}
            onLoginSuccess={handleSuccess}
            onPageChange={setPage}
            page={effectivePage}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
