import { GROK_CONNECT_COPY } from "@/client/lib/connect-copy";
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
import { DropdownMenuItem } from "@/client/components/ui/dropdown-menu";
import {
  DisableItem,
  ProviderMoreMenu,
  useProviderSwitch,
} from "@/client/components/settings/provider-switch";
import { cn } from "@/client/lib/utils";
import { type RPCOutput, rpcClient } from "@/client/rpc/client";
import { useGrokConnect } from "@/client/hooks/use-connect";
import { showConnectToast } from "@/client/lib/connect-toast";
import { AIProviderConfigIdSchema, APP_NAME } from "@instrument-org/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

type Account = NonNullable<
  Exclude<RPCOutput["grokAccount"]["signIn"], { outcome: "failed" }>["account"]
>;

/**
 * The Grok accounts as a row among the providers, laid out like the ChatGPT
 * account's: one account reads like any other card, several each get a line
 * of their own, and adding another is in the more menu. Signing in shows the
 * code xAI's page asks for while it waits.
 */
export function GrokAccountCard() {
  const { data: status } = useQuery(
    rpcClient.grokAccount.live.status.experimental_liveOptions(),
  );
  const flow = useGrokConnect();
  const { waiting } = flow;
  const [confirmingSignOut, setConfirmingSignOut] = useState<Account | null>(
    null,
  );
  const signOut = useMutation(rpcClient.grokAccount.signOut.mutationOptions());
  const checkSubscription = useMutation(
    rpcClient.grokAccount.checkSubscription.mutationOptions(),
  );
  const providerSwitch = useProviderSwitch();

  const continueWithGrok = () => {
    void flow.start().then((result) => {
      if (result) {
        showConnectToast(result, "grok");
      }
    });
  };
  const cancelSignIn = flow.cancel;

  const accounts = status?.accounts ?? [];
  const pending = status?.pending;
  const single = accounts.length === 1 ? accounts[0] : undefined;
  const isOff = (account: Account) =>
    account.state === "signed-in" && providerSwitch.isOff(account.id);
  const actionsFor = (account: Account) => ({
    checking: checkSubscription.isPending,
    off: isOff(account),
    onCheckAgain: () => {
      checkSubscription.mutate({ accountId: account.id });
    },
    onSetEnabled: (enabled: boolean) => {
      providerSwitch.setEnabled(
        AIProviderConfigIdSchema.parse(account.id),
        enabled,
      );
    },
    onSignIn: continueWithGrok,
    onSignOut: () => {
      setConfirmingSignOut(account);
    },
  });
  const addAnother = (
    <DropdownMenuItem onSelect={continueWithGrok}>
      Add another account
    </DropdownMenuItem>
  );

  return (
    <StateArrival
      state={
        status &&
        accounts.map((account) => `${account.id}:${account.state}`).join(" ")
      }
    >
      <Card className="gap-0 p-4">
        <div
          className="flex items-start justify-between gap-4"
          {...settingAnchor("grok-account")}
        >
          <div
            className={cn(
              "flex min-w-0 flex-1 items-start gap-3",
              single && isOff(single) && "opacity-50 grayscale",
            )}
          >
            <div className="flex size-8 shrink-0 items-center justify-center">
              <AIProviderIcon type="grok-account" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <h3 className="truncate font-medium text-foreground">
                Grok account
              </h3>
              {waiting ? (
                <p className="text-sm text-muted-foreground">
                  {flow.phase === "checking" ? (
                    "Checking your Grok plan."
                  ) : pending ? (
                    <>
                      Enter{" "}
                      <span className="font-mono font-medium text-foreground select-all">
                        {pending.userCode}
                      </span>{" "}
                      on the page that opened in your browser.
                    </>
                  ) : (
                    "Finish signing in with Grok in your browser."
                  )}
                </p>
              ) : single ? (
                <p className="text-sm text-muted-foreground">
                  <AccountLine account={single} off={isOff(single)} />
                </p>
              ) : (
                accounts.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    {GROK_CONNECT_COPY.caption}
                  </p>
                )
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {accounts.length === 0 || waiting ? (
              <BrowserHandoffButton
                onCancel={cancelSignIn}
                onStart={continueWithGrok}
                waiting={waiting}
              >
                {accounts.length === 0
                  ? "Continue with Grok"
                  : "Add another account"}
              </BrowserHandoffButton>
            ) : single ? (
              <AccountActions account={single} {...actionsFor(single)}>
                {addAnother}
              </AccountActions>
            ) : (
              <ProviderMoreMenu label="Grok account">
                {addAnother}
              </ProviderMoreMenu>
            )}
          </div>
        </div>
        {accounts.length > 1 && (
          <div className="mt-1 flex flex-col gap-1 pl-11">
            {accounts.map((account) => (
              <div
                className="flex min-h-8 items-center justify-between gap-4"
                key={account.id}
              >
                <p
                  className={cn(
                    "min-w-0 text-sm text-muted-foreground",
                    isOff(account) && "opacity-60",
                  )}
                >
                  <AccountLine account={account} off={isOff(account)} />
                </p>
                <AccountActions
                  account={account}
                  {...actionsFor(account)}
                  size="sm"
                />
              </div>
            ))}
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

/**
 * An account's label and plan on one line, and on a line of its own, what
 * stands in the way of using it when something does.
 */
function AccountLine({ account, off }: { account: Account; off: boolean }) {
  const status =
    account.state === "signed-out"
      ? "Signed out"
      : off
        ? `Disabled, so ${APP_NAME} won’t use it`
        : undefined;
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate">
        {account.label}
        {account.plan && ` · ${account.plan}`}
        {status && ` · ${status}`}
      </span>
      {account.state === "no-subscription" && (
        <span className="text-xs">
          This account doesn’t have a paid Grok plan.{" "}
          {GROK_CONNECT_COPY.requirement}
        </span>
      )}
    </span>
  );
}

/**
 * What can be done with one account: sign in again, check its subscription
 * again, or enable it when it needs that, then its more menu with `children`
 * above Sign out.
 */
function AccountActions({
  account,
  checking,
  children,
  off,
  onCheckAgain,
  onSetEnabled,
  onSignIn,
  onSignOut,
  size,
}: {
  account: Account;
  checking: boolean;
  children?: ReactNode;
  off: boolean;
  onCheckAgain: () => void;
  onSetEnabled: (enabled: boolean) => void;
  onSignIn: () => void;
  onSignOut: () => void;
  /** `sm` on an account's own line under the name. */
  size?: "sm";
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      {account.state === "signed-out" ? (
        <Button onClick={onSignIn} size={size} variant="outline">
          Sign in again
        </Button>
      ) : account.state === "no-subscription" ? (
        <Button
          disabled={checking}
          onClick={onCheckAgain}
          size={size}
          variant="outline"
        >
          Check again
        </Button>
      ) : (
        off && (
          <Button
            onClick={() => {
              onSetEnabled(true);
            }}
            size={size}
            variant="outline"
          >
            Enable
          </Button>
        )
      )}
      <ProviderMoreMenu
        label={account.label}
        size={size === "sm" ? "icon-sm" : "icon"}
      >
        {account.state === "signed-in" && !off && (
          <DisableItem
            onSelect={() => {
              onSetEnabled(false);
            }}
          />
        )}
        {children}
        <DropdownMenuItem onSelect={onSignOut}>Sign out…</DropdownMenuItem>
      </ProviderMoreMenu>
    </div>
  );
}
