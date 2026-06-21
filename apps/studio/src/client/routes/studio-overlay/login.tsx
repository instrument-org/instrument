import { type ProviderSetupPage, ProviderSetupScreen } from "@/client/components/onboarding/provider-setup-screen";
import { OnboardingSuccessScreen } from "@/client/components/onboarding/success-screen";
import { Button } from "@/client/components/ui/button";
import { DialogClose, DialogContent, DialogTitle } from "@/client/components/ui/dialog";
import { useLoginSocial } from "@/client/hooks/use-login-social";
import { SHARED } from "@/client/lib/styles";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { StudioOverlayLoginSearchSchema } from "@/shared/studio-overlay";
import { XIcon } from "@phosphor-icons/react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/studio-overlay/login")({
  component: LoginModal,
  validateSearch: StudioOverlayLoginSearchSchema,
});

type Page = "success" | ProviderSetupPage;

const FIXED_HEIGHT_PAGES = new Set<Page>(["success", "welcome"]);

function LoginModal() {
  const { hideManualProvider, reason } = Route.useSearch();
  const { error, login } = useLoginSocial();
  // When the caller only needs a provider (not a login), open straight on the
  // add-provider form. There's no welcome page to go back to in that case.
  const opensOnAddProvider = reason === "provider-required";
  const [page, setPage] = useState<Page>(
    opensOnAddProvider ? "add-provider" : "welcome",
  );

  return (
    <DialogContent
      aria-describedby={undefined}
      className={cn(
        `w-full max-w-[472px] gap-0 overflow-hidden rounded-3xl border-0 p-0
        shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05)] drop-shadow-2xl outline-none
        focus:outline-none focus-visible:outline-none
        dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]`,
        FIXED_HEIGHT_PAGES.has(page) && "h-[640px] max-h-[85vh]",
        page === "add-provider" ? SHARED.subtleGradient : SHARED.brandGradient,
      )}
      // Radix auto-focuses the first focusable element on open, painting a
      // focus ring the user never asked for. Prevent it (the focus trap still
      // works once they tab); focus moves to the content container instead.
      onOpenAutoFocus={(event) => {
        event.preventDefault();
      }}
      // The login dialog uses an outlined close button (not the default subtle
      // icon) that reads better against its gradient card.
      showCloseButton={false}
    >
      <DialogTitle className="sr-only">Log in</DialogTitle>
      <div className="absolute top-3 right-3 z-10">
        <DialogClose asChild>
          <Button aria-label="Close" type="button" variant="outline">
            <XIcon className="size-4" />
          </Button>
        </DialogClose>
      </div>
      {page === "success" ? (
        <OnboardingSuccessScreen
          onContinue={() => {
            void rpcClient.studioOverlay.resolve.call();
          }}
        />
      ) : (
        <ProviderSetupScreen
          error={error}
          hideManualProvider={hideManualProvider}
          onBack={
            opensOnAddProvider
              ? undefined
              : () => {
                  setPage("welcome");
                }
          }
          onContinue={() => {
            void rpcClient.studioOverlay.resolve.call();
          }}
          onLogin={login}
          onLoginSuccess={() => {
            setPage("success");
          }}
          onPageChange={setPage}
          page={page}
        />
      )}
    </DialogContent>
  );
}
