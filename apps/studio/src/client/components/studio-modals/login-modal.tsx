import {
  loginModalAtom,
  type LoginModalProps,
} from "@/client/atoms/login-modal";
import {
  type ProviderSetupPage,
  ProviderSetupScreen,
} from "@/client/components/onboarding/provider-setup-screen";
import { AddProviderSheet } from "@/client/components/studio-modals/add-provider-sheet";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { useModalBack } from "@/client/hooks/use-modal-back";
import { useDeferredModalState } from "@/client/hooks/use-deferred-modal-state";
import { showConnectToast } from "@/client/lib/connect-toast";
import { SHARED } from "@/client/lib/styles";
import { cn } from "@/client/lib/utils";
import { APP_NAME } from "@instrument-org/shared";
import { XIcon } from "@phosphor-icons/react/X";
import { useAtom } from "jotai";
import { useState } from "react";

/**
 * App-wide login / add-provider modal, mounted once at the window root: the
 * Add a provider sheet, or, for callers that mean Instrument itself, its
 * Google sign-in.
 * Reads `loginModalAtom` (opened via `openLogin`); traps tab navigation while
 * open. Finishing the flow fires the caller's `onCompleted`; dismissing does not.
 */
export function LoginModal() {
  const [state, setState] = useAtom(loginModalAtom);
  const isOpen = state !== null;
  // Deferred so `DialogContent` stays mounted (and its close animation can
  // play) for a moment after `state` clears to null, instead of unmounting
  // the instant the dialog starts closing.
  const { content, onExitComplete, openKey } = useDeferredModalState(state);

  useModalBack(() => {
    setState(null);
  }, isOpen);

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
          key={openKey}
          onComplete={complete}
          onDismiss={() => {
            setState(null);
          }}
          onExitComplete={onExitComplete}
          props={content.props}
        />
      )}
    </Dialog>
  );
}

function LoginModalContent({
  onComplete,
  onDismiss,
  onExitComplete,
  props,
}: {
  onComplete: () => void;
  onDismiss: () => void;
  onExitComplete: () => void;
  props?: LoginModalProps;
}) {
  const [page, setPage] = useState<ProviderSetupPage>("welcome");
  const instrumentOnly = props?.instrumentOnly === true;

  return (
    <DialogContent
      aria-describedby={undefined}
      className={cn(
        `w-full gap-0 overflow-hidden border-0 p-0 shadow-2xl outline-none
        focus:outline-none focus-visible:outline-none`,
        instrumentOnly && page === "welcome" && "h-[640px]",
        instrumentOnly ? SHARED.brandGradient : "bg-background",
      )}
      maxWidth={instrumentOnly ? "472px" : "560px"}
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
      <DialogTitle className="sr-only">
        {instrumentOnly ? "Log in" : "Add an AI provider"}
      </DialogTitle>
      <div className="absolute top-3 right-3 z-10">
        <DialogClose asChild>
          <Button aria-label="Close" type="button" variant="outline">
            <XIcon className="size-4" />
          </Button>
        </DialogClose>
      </div>
      {instrumentOnly ? (
        <ProviderSetupScreen
          heading={
            props?.reason === "dictation"
              ? {
                  subtitle: `Dictation is free with an ${APP_NAME} account.`,
                  title: "Log in to dictate",
                }
              : undefined
          }
          instrumentOnly
          onContinue={onComplete}
          onLoginSuccess={(result) => {
            showConnectToast(result, "instrument");
            onComplete();
          }}
          onPageChange={setPage}
          page={page}
        />
      ) : (
        <AddProviderSheet onComplete={onComplete} onDone={onDismiss} />
      )}
    </DialogContent>
  );
}
