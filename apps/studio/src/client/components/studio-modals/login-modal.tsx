import {
  loginModalAtom,
  type LoginModalProps,
} from "@/client/atoms/login-modal";
import {
  type ProviderSetupPage,
  ProviderSetupScreen,
} from "@/client/components/onboarding/provider-setup-screen";
import { OnboardingSuccessScreen } from "@/client/components/onboarding/success-screen";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { useBlockTabNavigation } from "@/client/hooks/use-block-tab-navigation";
import { useDeferredModalState } from "@/client/hooks/use-deferred-modal-state";
import { useLoginSocial } from "@/client/hooks/use-login-social";
import { SHARED } from "@/client/lib/styles";
import { cn } from "@/client/lib/utils";
import { XIcon } from "@phosphor-icons/react";
import { useAtom } from "jotai";
import { useState } from "react";

type Page = "success" | ProviderSetupPage;

const FIXED_HEIGHT_PAGES = new Set<Page>(["success", "welcome"]);

/**
 * App-wide login / add-provider modal, mounted once at the app-chrome root.
 * Reads `loginModalAtom` (opened via `openLogin`); traps tab navigation while
 * open. Finishing the flow fires the caller's `onCompleted`; dismissing does not.
 */
export function LoginModal() {
  const [state, setState] = useAtom(loginModalAtom);
  const isOpen = state !== null;
  // Deferred so `DialogContent` stays mounted (and its close animation can
  // play) for a moment after `state` clears to null, instead of unmounting
  // the instant the dialog starts closing.
  const { content, onExitComplete } = useDeferredModalState(state);

  useBlockTabNavigation(isOpen);

  const complete = () => {
    state?.onCompleted?.();
    setState(null);
  };

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          setState(null);
        }
      }}
      open={isOpen}
    >
      {content !== null && (
        <LoginModalContent
          onComplete={complete}
          onExitComplete={onExitComplete}
          props={content.props}
        />
      )}
    </Dialog>
  );
}

function LoginModalContent({
  onComplete,
  onExitComplete,
  props,
}: {
  onComplete: () => void;
  onExitComplete: () => void;
  props?: LoginModalProps;
}) {
  const { error, login } = useLoginSocial();
  // When the caller only needs a provider (not a login), open straight on the
  // add-provider form. There's no welcome page to go back to in that case.
  const opensOnAddProvider = props?.reason === "provider-required";
  const [page, setPage] = useState<Page>(
    opensOnAddProvider ? "add-provider" : "welcome",
  );

  return (
    <DialogContent
      aria-describedby={undefined}
      className={cn(
        `w-full max-w-[min(472px,calc(96vw/var(--content-zoom)))] gap-0
        overflow-hidden border-0 p-0 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05)]
        drop-shadow-2xl outline-none focus:outline-none
        focus-visible:outline-none
        sm:max-w-[min(472px,calc(96vw/var(--content-zoom)))]
        dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]`,
        FIXED_HEIGHT_PAGES.has(page) &&
          "h-[640px] max-h-[calc(85vh/var(--content-zoom))]",
        page === "add-provider" ? SHARED.subtleGradient : SHARED.brandGradient,
      )}
      onExitComplete={onExitComplete}
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
        <OnboardingSuccessScreen onContinue={onComplete} />
      ) : (
        <ProviderSetupScreen
          error={error}
          hideManualProvider={props?.hideManualProvider}
          onBack={
            opensOnAddProvider
              ? undefined
              : () => {
                  setPage("welcome");
                }
          }
          onContinue={onComplete}
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
