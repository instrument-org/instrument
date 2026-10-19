import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { BrowserHandoffButton } from "@/client/components/browser-handoff-button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/client/components/ui/alert-dialog";
import { Button } from "@/client/components/ui/button";
import { StateArrival } from "@/client/components/state-arrival";
import { Card } from "@/client/components/ui/card";
import { DropdownMenuItem } from "@/client/components/ui/dropdown-menu";
import {
  DisableItem,
  ProviderMoreMenu,
  useProviderSwitch,
} from "@/client/components/settings/provider-switch";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { toast } from "@/client/lib/toast";
import {
  AIProviderConfigIdSchema,
  APP_NAME,
  GROK_ACCOUNT_PROVIDER_CONFIG,
} from "@instrument-org/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";

const ACCOUNT_ID = AIProviderConfigIdSchema.parse(
  GROK_ACCOUNT_PROVIDER_CONFIG.id,
);

/**
 * The Grok account as a row among the providers, laid out like the ChatGPT
 * account's. Signing in shows the code xAI's page asks for while it waits.
 */
export function GrokAccountCard() {
  const { data: status } = useQuery(
    rpcClient.grokAccount.live.status.experimental_liveOptions(),
  );
  const [waiting, setWaiting] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  // Counts presses, so a sign-in that settles after a newer one started
  // leaves the button to the newer one.
  const attempts = useRef(0);
  const signIn = useMutation(rpcClient.grokAccount.signIn.mutationOptions());
  const signOut = useMutation(rpcClient.grokAccount.signOut.mutationOptions());
  const checkAccess = useMutation(
    rpcClient.grokAccount.checkAccess.mutationOptions(),
  );
  const providerSwitch = useProviderSwitch();

  const continueWithGrok = async () => {
    const attempt = ++attempts.current;
    setWaiting(true);
    const result = await signIn.mutateAsync({}).catch((error: unknown) => ({
      error: error instanceof Error ? error.message : "Sign-in failed",
      outcome: "failed" as const,
    }));
    if (attempt !== attempts.current) {
      return;
    }
    setWaiting(false);
    if (result.outcome === "failed") {
      toast.error("Couldn't sign in with Grok", { cause: result.error });
      return;
    }
    if (result.outcome !== "signed-in") {
      return;
    }
    if (result.refusal) {
      toast.error("xAI won't let this account use Grok here", {
        cause: result.refusal,
      });
      return;
    }
    const title = "Signed in with Grok";
    const id = toast.success(title);
    const { name } = await rpcClient.grokAccount.chooseDefaultModel
      .call()
      .catch(() => ({ name: undefined }));
    toast.success(title, {
      description: name
        ? `New chats use ${name} from your subscription.`
        : "Its models are in the model picker.",
      id,
    });
  };
  const cancelSignIn = () => {
    attempts.current++;
    setWaiting(false);
    void rpcClient.grokAccount.cancelSignIn.call();
  };

  const account = status?.account;
  const pending = status?.pending;
  const off =
    account?.state === "signed-in" && providerSwitch.isOff(ACCOUNT_ID);

  return (
    <StateArrival state={status && (account?.state ?? "none")}>
      <Card className="gap-0 p-4">
        <div className="flex items-start justify-between gap-4">
          <div
            className={cn(
              "flex min-w-0 flex-1 items-start gap-3",
              off && "opacity-50 grayscale",
            )}
          >
            <div className="flex size-8 shrink-0 items-center justify-center">
              <AIProviderIcon type="grok-account" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <h3 className="truncate font-medium text-foreground">
                Grok account
              </h3>
              <p className="text-sm text-muted-foreground">
                {waiting && pending ? (
                  <>
                    Enter{" "}
                    <span className="font-mono font-medium text-foreground select-all">
                      {pending.userCode}
                    </span>{" "}
                    on the page that opened in your browser.
                  </>
                ) : waiting ? (
                  "Finish signing in with Grok in your browser."
                ) : !account ? (
                  "Pay for SuperGrok or X Premium? Use it here."
                ) : (
                  `${account.label}${
                    account.state === "signed-out"
                      ? " · Signed out"
                      : account.state === "refused"
                        ? " · xAI says this account can't use Grok here. It needs a SuperGrok subscription, or X Premium that includes Grok."
                        : off
                          ? ` · Disabled, so ${APP_NAME} won’t use it`
                          : ""
                  }`
                )}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!account || account.state === "signed-out" || waiting ? (
              <BrowserHandoffButton
                onCancel={cancelSignIn}
                onStart={() => {
                  void continueWithGrok();
                }}
                waiting={waiting}
              >
                {account ? "Sign in again" : "Continue with Grok"}
              </BrowserHandoffButton>
            ) : account.state === "refused" ? (
              <Button
                disabled={checkAccess.isPending}
                onClick={() => {
                  checkAccess.mutate({});
                }}
                variant="outline"
              >
                Check again
              </Button>
            ) : (
              off && (
                <Button
                  onClick={() => {
                    providerSwitch.setEnabled(ACCOUNT_ID, true);
                  }}
                  variant="outline"
                >
                  Enable
                </Button>
              )
            )}
            {account && (
              <ProviderMoreMenu label="Grok account">
                {account.state === "signed-in" && !off && (
                  <DisableItem
                    onSelect={() => {
                      providerSwitch.setEnabled(ACCOUNT_ID, false);
                    }}
                  />
                )}
                <DropdownMenuItem
                  onSelect={() => {
                    setConfirmingSignOut(true);
                  }}
                >
                  Sign out…
                </DropdownMenuItem>
              </ProviderMoreMenu>
            )}
          </div>
        </div>
        <AlertDialog
          onOpenChange={setConfirmingSignOut}
          open={confirmingSignOut}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Sign out of {account?.label}?</AlertDialogTitle>
              <AlertDialogDescription>
                Chats on this account’s models will need another model. Signing
                in again brings it back.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  signOut.mutate({});
                }}
              >
                Sign out
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Card>
    </StateArrival>
  );
}
