import { ProviderSetupScreen } from "@/client/components/onboarding/provider-setup-screen";
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
import { XIcon } from "@phosphor-icons/react";

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

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className={cn(
          `flex h-[640px] max-h-[85vh] w-full max-w-[472px] flex-col
          overflow-hidden rounded-3xl border-0 p-0
          shadow-[inset_0_0_0_2px_rgba(0,0,0,0.05)]
          dark:shadow-[inset_0_0_0_2px_rgba(255,255,255,0.05)]`,
          SHARED.brandGradient,
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
            <Button aria-label="Close" type="button" variant="nav-overlay">
              <XIcon className="size-4" />
            </Button>
          </DialogClose>
        </div>
        <ProviderSetupScreen
          error={error}
          hideManualProvider={hideManualProvider}
          onContinue={() => {
            onSuccess?.();
            onOpenChange(false);
          }}
          onLogin={login}
          onLoginSuccess={() => {
            onSuccess?.();
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
