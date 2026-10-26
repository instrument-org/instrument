import {
  loginModalAtom,
  type LoginModalProps,
} from "@/client/atoms/login-modal";
import { SetupFooter } from "@/client/components/setup/kit/setup-page";
import { FreeAccountPage } from "@/client/components/setup/steps/free-account";
import { AddProviderSheet } from "@/client/components/studio-modals/add-provider-sheet";
import {
  AfterInstrumentSignIn,
  type AfterSignInPage,
  InstrumentLogInPage,
  InstrumentSignInCheck,
  useHasOwnAI,
} from "@/client/components/studio-modals/instrument-log-in";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { useModalBack } from "@/client/hooks/use-modal-back";
import { type ConnectResult } from "@/client/hooks/use-connect-flow";
import { useDeferredModalState } from "@/client/hooks/use-deferred-modal-state";
import { XIcon } from "@phosphor-icons/react/X";
import { useAtom } from "jotai";
import { useRef, useState } from "react";

/**
 * App-wide login / add-provider modal, mounted once at the window root: the
 * Add a provider sheet, or, for callers that mean Instrument itself, the
 * plain log-in page. A Google sign-in from either goes on to what the
 * account needs next (`AfterInstrumentSignIn`).
 * Reads `loginModalAtom` (opened via `openLogin`); traps tab navigation while
 * open. Finishing the flow fires the caller's `onCompleted`, and so does
 * closing it once a sign-in has gone through; dismissing before that does not.
 */
export function LoginModal() {
  const [state, setState] = useAtom(loginModalAtom);
  const isOpen = state !== null;
  // Deferred so `DialogContent` stays mounted (and its close animation can
  // play) for a moment after `state` clears to null, instead of unmounting
  // the instant the dialog starts closing.
  const { content, onExitComplete, openKey } = useDeferredModalState(state);

  // The opening a sign-in went through in, so closing that opening counts as
  // finishing. Every opening is a new state, so one left any other way
  // (dismissed, or replaced by another modal) cannot finish the next.
  const signedInFor = useRef<typeof state>(null);
  const complete = () => {
    signedInFor.current = null;
    state?.onCompleted?.();
    setState(null);
  };
  const close = () => {
    if (state !== null && signedInFor.current === state) {
      complete();
    } else {
      setState(null);
    }
  };

  useModalBack(close, isOpen);

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          close();
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
          onSignedIn={() => {
            signedInFor.current = state;
          }}
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
  onSignedIn,
  props,
}: {
  onComplete: () => void;
  onDismiss: () => void;
  onExitComplete: () => void;
  onSignedIn: () => void;
  props?: LoginModalProps;
}) {
  const instrumentOnly = props?.instrumentOnly === true;
  // The mic asked, from someone whose own AI already works: the free
  // account's page, since dictation is one of what it adds.
  const hasOwnAI = useHasOwnAI();
  const freeAccount = props?.reason === "dictation" && hasOwnAI === true;
  // Signed in to Instrument with Google here, and from which page.
  const [signedIn, setSignedIn] = useState<{
    from: "log-in" | "sheet";
    result: ConnectResult;
  }>();
  // Where the sign-in goes once the account is read, when it isn't done.
  const [next, setNext] = useState<AfterSignInPage>();
  const isSheet = !instrumentOnly && next === undefined;

  return (
    <DialogContent
      aria-describedby={undefined}
      className="flex w-full flex-col gap-0 overflow-hidden bg-background p-0 outline-none focus:outline-none focus-visible:outline-none"
      maxWidth={isSheet ? "560px" : "760px"}
      onExitComplete={onExitComplete}
      // Radix auto-focuses the first focusable element on open, painting a
      // focus ring the user never asked for. Prevent it (the focus trap still
      // works once they tab); focus moves to the content container instead.
      onOpenAutoFocus={(event) => {
        event.preventDefault();
      }}
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
      {signedIn && next === undefined && (
        <InstrumentSignInCheck
          onFinish={onComplete}
          onNext={setNext}
          result={signedIn.result}
        />
      )}
      {signedIn && next ? (
        <AfterInstrumentSignIn
          next={next}
          onBack={
            signedIn.from === "sheet"
              ? () => {
                  setSignedIn(undefined);
                  setNext(undefined);
                }
              : undefined
          }
          onFinish={onComplete}
          result={signedIn.result}
        />
      ) : (
        // The page signed in from stays up, held still, while the account is
        // read, so the dialog keeps its size until it closes or moves on.
        <div className="contents" inert={signedIn !== undefined}>
          <SignInFromPage
            freeAccount={freeAccount}
            instrumentOnly={instrumentOnly}
            onComplete={onComplete}
            onDismiss={onDismiss}
            onSignedIn={(from, result) => {
              onSignedIn();
              setSignedIn({ from, result });
            }}
          />
        </div>
      )}
    </DialogContent>
  );
}

/** The page a dialog opens on, where a Google sign-in starts. */
function SignInFromPage({
  freeAccount,
  instrumentOnly,
  onComplete,
  onDismiss,
  onSignedIn,
}: {
  freeAccount: boolean;
  instrumentOnly: boolean;
  onComplete: () => void;
  onDismiss: () => void;
  onSignedIn: (from: "log-in" | "sheet", result: ConnectResult) => void;
}) {
  return freeAccount ? (
    <FreeAccountPage
      calledOut="Dictation"
      fit="dialog"
      footer={
        <SetupFooter
          next="none"
          skip={{ label: "Not now", onClick: onDismiss }}
        />
      }
      onSignedIn={(result) => {
        onSignedIn("log-in", result);
      }}
    />
  ) : instrumentOnly ? (
    <InstrumentLogInPage
      onSignedIn={(result) => {
        onSignedIn("log-in", result);
      }}
    />
  ) : (
    <AddProviderSheet
      onComplete={onComplete}
      onDone={onDismiss}
      onInstrumentSignedIn={(result) => {
        onSignedIn("sheet", result);
      }}
    />
  );
}
