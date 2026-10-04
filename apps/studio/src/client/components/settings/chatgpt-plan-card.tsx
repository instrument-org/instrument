import { AIProviderIcon } from "@/client/components/ai-provider-icon";
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
import { Card } from "@/client/components/ui/card";
import { Spinner } from "@/client/components/ui/spinner";
import { useOpenExternalLink } from "@/client/hooks/use-open-external-link";
import { cn } from "@/client/lib/utils";
import { type RPCOutput, rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { isDefinedError } from "@orpc/client";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const USAGE_URL = "https://chatgpt.com/settings/usage";

/**
 * How long a sign-in button shows that the browser is opening. After it, the
 * button is back, and pressing it again starts a fresh sign-in, which is the
 * way past a tab that was closed or never came up.
 */
const OPENING_MS = 4000;

/** Which button opened the browser: an account's, or the one adding a new one. */
const NEW_ACCOUNT = "new";

type Account = NonNullable<RPCOutput["chatgptPlan"]["signIn"]>;

/**
 * The ChatGPT plan as a row among the providers, laid out like
 * `ProviderConfigListItem` so it reads as one of them: the mark, a name and a
 * line, and the actions at the right. Each signed-in account is a line of its
 * own under the name, and adding another stays a quiet link below them.
 */
export function ChatGPTPlanCard() {
  const { data: status } = useQuery(
    rpcClient.chatgptPlan.live.status.experimental_liveOptions(),
  );
  const openLink = useOpenExternalLink();
  const [opening, setOpening] = useState<null | string>(null);
  const openingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(
    () => () => {
      clearTimeout(openingTimer.current);
    },
    [],
  );

  const signIn = useMutation(
    rpcClient.chatgptPlan.signIn.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't sign in with ChatGPT", {
          description: isDefinedError(error) ? error.message : undefined,
        });
      },
      onSuccess: async (account) => {
        if (account?.state !== "signed-in") {
          return;
        }
        // Said as soon as the sign-in lands; the model it picks follows in
        // the same toast once the plan's catalog is read. The model is said
        // because the change lands in the model picker, which may not be on
        // screen, and the settings window may already be closed.
        const title = `Signed in to ${account.label}`;
        const id = toast.success(title);
        const { name } = await rpcClient.chatgptPlan.chooseDefaultModel
          .call({ accountId: account.id })
          .catch(() => ({ name: undefined }));
        toast.success(title, {
          description: name
            ? `New chats use ${name} from your plan.`
            : "Its models are in the model picker.",
          id,
        });
      },
    }),
  );
  const signOut = useMutation(rpcClient.chatgptPlan.signOut.mutationOptions());
  // Sign out forgets the account, and its button sits where a pass through
  // Settings can catch it, so it asks first.
  const [confirmingSignOut, setConfirmingSignOut] = useState<Account | null>(
    null,
  );

  const continueWithChatGPT = (accountId?: string) => {
    clearTimeout(openingTimer.current);
    setOpening(accountId ?? NEW_ACCOUNT);
    openingTimer.current = setTimeout(() => {
      setOpening(null);
    }, OPENING_MS);
    signIn.mutate({ accountId });
  };

  const accounts = status?.accounts ?? [];

  return (
    <Card className="gap-0 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center">
            <AIProviderIcon type="chatgpt" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="truncate font-medium text-foreground">
              {accounts.length > 0 ? "ChatGPT plan" : "Use your ChatGPT plan"}
            </h3>
            {accounts.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {APP_NAME} can run on the ChatGPT Plus or Pro plan you already
                pay for.
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
            <SignInButton
              onClick={() => {
                continueWithChatGPT();
              }}
              opening={opening === NEW_ACCOUNT}
            >
              Continue with ChatGPT
            </SignInButton>
          )}
        </div>
      </div>
      {accounts.length > 0 && (
        <div className="mt-1 flex flex-col gap-1 pl-11">
          {accounts.map((account) => (
            <AccountRow
              account={account}
              key={account.id}
              onSignIn={() => {
                continueWithChatGPT(account.id);
              }}
              onSignOut={() => {
                setConfirmingSignOut(account);
              }}
              opening={opening === account.id}
            />
          ))}
          <div>
            <Button
              className="-ml-2 text-muted-foreground"
              disabled={opening === NEW_ACCOUNT}
              onClick={() => {
                continueWithChatGPT();
              }}
              size="xs"
              variant="ghost"
            >
              {opening === NEW_ACCOUNT ? (
                <Spinner className="size-3" delay={0} />
              ) : (
                <PlusIcon />
              )}
              Add another account
            </Button>
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
              Chats on this account’s models will need another model. Signing in
              again brings it back.
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
  );
}

function AccountRow({
  account,
  onSignIn,
  onSignOut,
  opening,
}: {
  account: Account;
  onSignIn: () => void;
  onSignOut: () => void;
  opening: boolean;
}) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-4">
      <p className="min-w-0 truncate text-sm text-muted-foreground">
        {account.label}
        {account.state === "plan-disabled" &&
          ` · ${APP_NAME} isn't allowed to use this plan yet`}
        {account.state === "signed-out" && " · Signed out"}
      </p>
      <div className="flex shrink-0 items-center gap-2">
        {account.state !== "signed-in" && (
          <SignInButton onClick={onSignIn} opening={opening} size="sm">
            {account.state === "plan-disabled"
              ? "Allow plan use"
              : "Sign in again"}
          </SignInButton>
        )}
        <Button onClick={onSignOut} size="sm" variant="ghost">
          Sign out
        </Button>
      </div>
    </div>
  );
}

function SignInButton({
  children,
  onClick,
  opening,
  size,
}: {
  children: string;
  onClick: () => void;
  opening: boolean;
  size?: "sm";
}) {
  // The label stays in place under the spinner, so the button keeps its
  // width and nothing beside it rewraps.
  return (
    <Button
      className="relative"
      disabled={opening}
      onClick={onClick}
      size={size}
    >
      <span className={cn(opening && "invisible")}>{children}</span>
      {opening && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner className="size-4" delay={0} />
        </span>
      )}
    </Button>
  );
}
