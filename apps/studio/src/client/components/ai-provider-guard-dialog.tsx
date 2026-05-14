import { ProviderSetupFlow } from "@/client/components/onboarding/provider-setup-flow";
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
import { rpcClient } from "@/client/rpc/client";
import { XIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";

export function AIProviderGuardDialog({
  onOpenChange,
  onSuccess,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  open: boolean;
}) {
  const { error, login } = useLoginSocial();

  const { data: hasToken } = useQuery(
    rpcClient.auth.live.hasToken.experimental_liveOptions(),
  );
  const { data: providerConfigs } = useQuery(
    rpcClient.providerConfig.live.list.experimental_liveOptions(),
  );

  const hasProvider = (providerConfigs?.length ?? 0) > 0;
  const isSetupComplete = hasToken === true || hasProvider;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="flex h-[640px] max-h-[85vh] w-full max-w-[472px] flex-col
          overflow-hidden rounded-3xl border-0 p-0
          shadow-[inset_0_0_0_2px_rgba(0,0,0,0.05)]
          [background:linear-gradient(180deg,var(--brand-200)_0%,var(--brown-50)_100%)]
          dark:shadow-[inset_0_0_0_2px_rgba(255,255,255,0.05)]
          dark:[background:linear-gradient(180deg,color-mix(in_srgb,var(--brand-950)_60%,var(--background))_0%,var(--background)_50%)]"
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
        <ProviderSetupFlow
          error={error}
          isSetupComplete={isSetupComplete}
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
