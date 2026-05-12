import { AddProviderDialog } from "@/client/components/add-provider/dialog";
import { ContactErrorAlert } from "@/client/components/contact-error-alert";
import { GoogleSignInButton } from "@/client/components/google-sign-in-button";
import { AppIcon } from "@/client/components/studio-icon";
import { TermsFooter } from "@/client/components/terms-footer";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { useSignInSocial } from "@/client/hooks/use-sign-in-social";
import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

export function AIProviderGuardDialog({
  description,
  onOpenChange,
  onSuccess,
  open,
}: {
  description?: string;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  open: boolean;
}) {
  const [showAddProviderDialog, setShowAddProviderDialog] = useState(false);
  const { error, signIn } = useSignInSocial();

  const { data: hasToken } = useQuery(
    rpcClient.auth.live.hasToken.experimental_liveOptions(),
  );
  const { data: providerConfigs } = useQuery(
    rpcClient.providerConfig.live.list.experimental_liveOptions(),
  );

  const showGoogleSignIn = !hasToken;

  const resolvedDescription =
    description ??
    (showGoogleSignIn
      ? "Connect an AI provider to get started."
      : "Add an AI provider API key to use a custom model.");

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md p-6">
        <DialogHeader className="sr-only">
          <DialogTitle>Add an AI provider to continue</DialogTitle>
          <DialogDescription>{resolvedDescription}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-4">
            <div className="flex size-16 items-center justify-center rounded-md">
              <AppIcon className="size-16" />
            </div>
            <h2 className="text-center text-2xl font-bold">
              Add an AI provider
            </h2>
            <p className="text-center text-sm text-muted-foreground">
              {resolvedDescription}
            </p>
          </div>

          <div className="flex w-full max-w-xs flex-col gap-4">
            {showGoogleSignIn ? (
              <>
                {error && (
                  <ContactErrorAlert title="Sign in failed">
                    There was an error signing in. Please try again.
                  </ContactErrorAlert>
                )}
                <GoogleSignInButton
                  className="w-full"
                  onSignIn={signIn}
                  onSuccess={() => {
                    onSuccess?.();
                    onOpenChange(false);
                  }}
                />
                <div className="flex flex-col items-center justify-center">
                  <div className="text-sm text-muted-foreground/50">or</div>
                  <Button
                    className="text-muted-foreground/80"
                    onClick={() => {
                      setShowAddProviderDialog(true);
                    }}
                    type="button"
                    variant="ghost"
                  >
                    Add an AI provider manually
                  </Button>
                </div>
              </>
            ) : (
              <Button
                className="w-full"
                onClick={() => {
                  setShowAddProviderDialog(true);
                }}
                type="button"
              >
                Add an AI provider manually
              </Button>
            )}
          </div>

          <AddProviderDialog
            onOpenChange={setShowAddProviderDialog}
            onSuccess={() => {
              setShowAddProviderDialog(false);
              onSuccess?.();
              onOpenChange(false);
            }}
            open={showAddProviderDialog}
            providers={providerConfigs ?? []}
          />

          {showGoogleSignIn && (
            <TermsFooter className="text-center text-xs text-muted-foreground/50" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
