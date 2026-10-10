import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { settingAnchor } from "@/client/components/settings/settings-index";
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
import { useOpenExternalLink } from "@/client/hooks/use-open-external-link";
import { type RPCOutput, rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "@/client/lib/toast";

const USAGE_URL = "https://chatgpt.com/settings/usage";

/** Which button opened the browser: an account's, or the one adding a new one. */
const NEW_ACCOUNT = "new";

type Account = NonNullable<
  Exclude<
    RPCOutput["chatgptAccount"]["signIn"],
    { outcome: "failed" }
  >["account"]
>;

/**
 * The ChatGPT account as a row among the providers, laid out like
 * `ProviderConfigListItem` so it reads as one of them: the mark, a name and a
 * line, and the actions at the right. Each signed-in account is a line of its
 * own under the name, and adding another stays a quiet link below them.
 */
export function ChatGPTAccountCard() {
  const { data: status } = useQuery(
    rpcClient.chatgptAccount.live.status.experimental_liveOptions(),
  );
  const openLink = useOpenExternalLink();
  const [waiting, setWaiting] = useState<null | string>(null);
  // Counts presses, so a sign-in that settles after a newer one started
  // leaves the buttons to the newer one.
  const attempts = useRef(0);

  const signIn = useMutation(rpcClient.chatgptAccount.signIn.mutationOptions());
  const signOut = useMutation(
    rpcClient.chatgptAccount.signOut.mutationOptions(),
  );
  // Sign out forgets the account, and its button sits where a pass through
  // Settings can catch it, so it asks first.
  const [confirmingSignOut, setConfirmingSignOut] = useState<Account | null>(
    null,
  );

  const continueWithChatGPT = async (accountId?: string) => {
    const attempt = ++attempts.current;
    setWaiting(accountId ?? NEW_ACCOUNT);
    const result = await signIn
      .mutateAsync({ accountId })
      .catch((error: unknown) => ({
        error: error instanceof Error ? error.message : "Sign-in failed",
        outcome: "failed" as const,
      }));
    if (attempt !== attempts.current) {
      return;
    }
    setWaiting(null);
    if (result.outcome === "failed") {
      toast.error("Couldn't sign in with ChatGPT", {
        description: result.error,
      });
      return;
    }
    // Declined, canceled, or signed in without the plan, which the account's
    // row says.
    const { account } = result;
    if (result.outcome !== "signed-in" || !account) {
      return;
    }
    // Said as soon as the sign-in lands; the model it picks follows in
    // the same toast once the plan's catalog is read. The model is said
    // because the change lands in the model picker, which may not be on
    // screen, and the settings window may already be closed.
    const title = `Signed in to ${account.label}`;
    const id = toast.success(title);
    const { name } = await rpcClient.chatgptAccount.chooseDefaultModel
      .call({ accountId: account.id })
      .catch(() => ({ name: undefined }));
    toast.success(title, {
      description: name
        ? `New chats use ${name} from your plan.`
        : "Its models are in the model picker.",
      id,
    });
  };
  const cancelSignIn = () => {
    attempts.current++;
    setWaiting(null);
    void rpcClient.chatgptAccount.cancelSignIn.call();
  };

  const accounts = status?.accounts ?? [];

  return (
    // The accounts signed in, so the card settles in when a sign-in finished
    // in the browser lands.
    <StateArrival
      state={status && accounts.map((account) => account.id).join(" ")}
    >
      <Card className="gap-0 p-4">
        <div
          className="flex items-start justify-between gap-4"
          {...settingAnchor("chatgpt-account")}
        >
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center">
              <AIProviderIcon type="chatgpt-account" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <h3 className="truncate font-medium text-foreground">
                ChatGPT account
              </h3>
              {accounts.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {waiting === NEW_ACCOUNT
                    ? "Finish signing in with ChatGPT in your browser."
                    : "Pay for ChatGPT Plus or Pro? Use it here."}
                </p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {accounts.length > 0 ? (
              <Button
                onClick={() => {
                  openLink(USAGE_URL, { addReferral: false });
                }}
                variant="outline"
              >
                Manage usage
              </Button>
            ) : (
              <BrowserHandoffButton
                onCancel={cancelSignIn}
                onStart={() => {
                  void continueWithChatGPT();
                }}
                waiting={waiting === NEW_ACCOUNT}
              >
                Continue with ChatGPT
              </BrowserHandoffButton>
            )}
          </div>
        </div>
        {accounts.length > 0 && (
          <div className="mt-1 flex flex-col gap-1 pl-11">
            {accounts.map((account) => (
              <AccountRow
                account={account}
                key={account.id}
                onCancelSignIn={cancelSignIn}
                onSignIn={() => {
                  void continueWithChatGPT(account.id);
                }}
                onSignOut={() => {
                  setConfirmingSignOut(account);
                }}
                waiting={waiting === account.id}
              />
            ))}
            <div className="flex items-center gap-2">
              <BrowserHandoffButton
                className="-ml-2 text-muted-foreground"
                icon={<PlusIcon />}
                onCancel={cancelSignIn}
                onStart={() => {
                  void continueWithChatGPT();
                }}
                size="xs"
                variant="ghost"
                waiting={waiting === NEW_ACCOUNT}
              >
                Add another account
              </BrowserHandoffButton>
              {waiting === NEW_ACCOUNT && (
                <p className="text-xs text-muted-foreground">
                  Finish signing in with ChatGPT in your browser
                </p>
              )}
            </div>
          </div>
        )}
        <AlertDialog
          onOpenChange={(open) => {
            if (!open) {
              setConfirmingSignOut(null);
            }
          }}
          open={confirmingSignOut !== null}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Sign out of {confirmingSignOut?.label}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Chats on this account’s models will need another model. Signing
                in again brings it back.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (confirmingSignOut) {
                    signOut.mutate({ accountId: confirmingSignOut.id });
                  }
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

function AccountRow({
  account,
  onCancelSignIn,
  onSignIn,
  onSignOut,
  waiting,
}: {
  account: Account;
  onCancelSignIn: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  waiting: boolean;
}) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-4">
      <p className="min-w-0 truncate text-sm text-muted-foreground">
        {account.label}
        {waiting
          ? " · Finish in your browser"
          : account.state === "plan-disabled"
            ? ` · ${APP_NAME} isn't allowed to use this plan yet`
            : account.state === "signed-out" && " · Signed out"}
      </p>
      <div className="flex shrink-0 items-center gap-2">
        {account.state !== "signed-in" && (
          <BrowserHandoffButton
            onCancel={onCancelSignIn}
            onStart={onSignIn}
            size="sm"
            waiting={waiting}
          >
            {account.state === "plan-disabled"
              ? "Allow plan use"
              : "Sign in again"}
          </BrowserHandoffButton>
        )}
        <Button onClick={onSignOut} size="sm" variant="ghost">
          Sign out
        </Button>
      </div>
    </div>
  );
}
