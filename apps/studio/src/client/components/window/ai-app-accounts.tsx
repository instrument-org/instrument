import {
  claudeWaitingLine,
  grokWaitingLine,
} from "@/client/components/connect-button";
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
import { DropdownMenuItem } from "@/client/components/ui/dropdown-menu";
import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { type PlanProvider } from "@/client/hooks/use-connected-plans";
import {
  CONNECT_NAMES,
  connectLine,
  connectPageCopy,
  GROK_CONNECT_COPY,
} from "@/client/lib/connect-copy";
import { toast } from "@/client/lib/toast";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { capitalize } from "radashi";
import { useEffect, useEffectEvent, useState } from "react";

import { useWindow } from "./context";
import { usePendingGrokCode, usePlanSignIns } from "./plan-sign-in";
import { AccountRow, AccountsCard, AskCard, RowMenu } from "./app-page-parts";
import { SignInButton, SignInWaitingLine, WaitingLine } from "./sign-in-button";
import { useSetUpThenSignIn } from "./use-set-up-then-sign-in";
import { useSiteSignIn } from "./site-sign-in";
import { type SignInDestination } from "./use-sign-in-landing";

type App = RPCOutput["apps"]["list"]["apps"][number];

/**
 * An AI's two accounts on its app's page, each signed in to on its own: its
 * site, which an agent works in from a tab, and its plan, which chats can
 * run on. The site is what the page asks for, with the plan a line under it
 * until either is connected; from then on both are rows of one card.
 */
export function AiAppAccounts({
  app,
  entrySlug,
  name,
  provider,
  slug,
}: {
  /** The app, once set up. One worked some other way than on its site has its own setup, and only its plan is here. */
  app: App | undefined;
  entrySlug: string;
  name: string;
  provider: PlanProvider;
  slug: string;
}) {
  const isOnSite = app === undefined || app.type === "web";
  const isSiteConnected = isOnSite && app?.status === "connected";
  const plan = usePlan({
    // Beside the site's own session in this window, signing in here is the
    // shorter way; otherwise the person's own browser is likelier to have one.
    first: isSiteConnected ? "app" : "external",
    name,
    provider,
    slug,
  });
  const isPlanQuiet = isOnSite && !isSiteConnected && plan.isUntouched;
  return (
    <>
      {isOnSite && !isSiteConnected ? (
        <SiteCard app={app} entrySlug={entrySlug} name={name} slug={slug} />
      ) : null}
      {isPlanQuiet ? (
        plan.isImpossible ? null : (
          <p className="mt-3 px-1 text-[13px] text-muted-foreground">
            Pay for a {name} plan?{" "}
            <button
              className="underline underline-offset-2 hover:text-foreground"
              onClick={plan.start}
              type="button"
            >
              Use it for your chats here
            </button>
          </p>
        )
      ) : (
        <AccountsCard>
          {isSiteConnected ? (
            <AccountRow
              end={<DisconnectSite name={name} slug={slug} />}
              line="Signed in"
              title={`${name} site`}
            />
          ) : null}
          {plan.rows}
        </AccountsCard>
      )}
      {plan.dialog}
    </>
  );
}

function DisconnectSite({ name, slug }: { name: string; slug: string }) {
  const disconnect = useMutation(
    rpcClient.apps.disconnect.mutationOptions({
      onError: (error) => {
        toast.error(`Couldn't disconnect ${name}`, { cause: error });
      },
    }),
  );
  return (
    <RowMenu label={`More for ${name} site`}>
      <DropdownMenuItem
        disabled={disconnect.isPending}
        onSelect={() => {
          disconnect.mutate({ slug });
        }}
      >
        Disconnect
      </DropdownMenuItem>
    </RowMenu>
  );
}

/** The card that asks for the site's sign-in, which sets the app up first when it isn't yet. */
function SiteCard({
  app,
  entrySlug,
  name,
  slug,
}: {
  app: App | undefined;
  entrySlug: string;
  name: string;
  slug: string;
}) {
  const site = useSiteSignIn({ askedIn: undefined, name, slug });
  const { controls } = useSetUpThenSignIn({
    app,
    entrySlug,
    kind: "web",
    name,
    slug,
  });
  return (
    <AskCard
      end={controls}
      line={
        site.isWaiting
          ? `Sign in on the ${name} page that opened, then press Done.`
          : `${APP_NAME} can then look through your chats and use ${name} for you.`
      }
      title={`Sign in to ${name}`}
    />
  );
}

/** One account of a plan, whichever service it is with. */
interface PlanAccount {
  id: string;
  isUsable: boolean;
  label: string;
  line: string;
}

function joined(...parts: (string | false | undefined)[]) {
  return parts.filter(Boolean).join(" · ");
}

/** The accounts of a plan on this computer, or undefined until they are read. */
function usePlanAccounts(provider: PlanProvider): PlanAccount[] | undefined {
  const { data: chatgpt } = useQuery(
    rpcClient.chatgptAccount.live.status.experimental_liveOptions(),
  );
  const { data: claude } = useQuery(
    rpcClient.claudeAccount.live.status.experimental_liveOptions(),
  );
  const { data: grok } = useQuery(
    rpcClient.grokAccount.live.status.experimental_liveOptions(),
  );
  switch (provider) {
    case "chatgpt": {
      return chatgpt?.accounts.map((account) => ({
        id: account.id,
        isUsable: account.state === "signed-in",
        label: account.label,
        line: joined(
          account.label,
          account.state === "signed-out" && "Signed out",
          account.state === "plan-disabled" &&
            `${APP_NAME} isn't allowed to use this plan yet`,
        ),
      }));
    }
    case "claude": {
      return (
        claude &&
        (claude.kind === "signed-in"
          ? [
              {
                id: "claude",
                isUsable: true,
                label: claude.email ?? "Claude",
                line: joined(
                  claude.email,
                  claude.plan && capitalize(claude.plan),
                ),
              },
            ]
          : [])
      );
    }
    case "grok": {
      return grok?.accounts.map((account) => ({
        id: account.id,
        isUsable: account.state === "signed-in",
        label: account.label,
        line: joined(
          account.label,
          account.plan,
          account.state === "signed-out" && "Signed out",
          account.state === "no-subscription" &&
            "This account doesn’t have a paid Grok plan",
        ),
      }));
    }
  }
}

function usePlan({
  first,
  name,
  provider,
  slug,
}: {
  first: SignInDestination;
  name: string;
  provider: PlanProvider;
  slug: string;
}) {
  const { browser, openPage } = useWindow();
  const signIns = usePlanSignIns();
  const signIn = signIns[provider];
  const accounts = usePlanAccounts(provider);
  const { data: claude } = useQuery(
    rpcClient.claudeAccount.live.status.experimental_liveOptions(),
  );
  const [signingOut, setSigningOut] = useState<PlanAccount>();
  const signOutOfChatGPT = useMutation(
    rpcClient.chatgptAccount.signOut.mutationOptions(),
  );
  const signOutOfClaude = useMutation(
    rpcClient.claudeAccount.signOut.mutationOptions(),
  );
  const signOutOfGrok = useMutation(
    rpcClient.grokAccount.signOut.mutationOptions(),
  );
  const signOut = ({ id }: PlanAccount) => {
    const failed = {
      onError: (error: Error) => {
        toast.error(`Couldn't sign out of ${name}`, { cause: error });
      },
    };
    switch (provider) {
      case "chatgpt": {
        signOutOfChatGPT.mutate({ accountId: id }, failed);
        return;
      }
      case "claude": {
        signOutOfClaude.mutate({}, failed);
        return;
      }
      case "grok": {
        signOutOfGrok.mutate({ accountId: id }, failed);
        return;
      }
    }
  };

  // While the page is up it says how the sign-in went, so no toast does.
  const isUp = useIsActiveTab();
  const noteShown = useEffectEvent(() => signIns.noteShown(provider));
  useEffect(() => (isUp ? noteShown() : undefined), [isUp, provider]);

  const isBusy = signIn.phase !== "idle";
  const start = (where: SignInDestination, accountId?: string) => {
    signIn.start({
      accountId,
      openPage,
      slug,
      where: browser ? where : "external",
    });
  };
  const outcome = isBusy ? undefined : signIn.outcome;
  const isWaitingOn = (account?: PlanAccount) =>
    isBusy && signIn.accountId === account?.id;
  const buttonFor = (account?: PlanAccount) =>
    account === undefined && outcome?.kind === "no-plan" ? (
      <Button
        className="text-foreground"
        onClick={() => {
          start(signIn.where ?? "external");
        }}
        size="sm"
        variant="outline"
      >
        Use another account
      </Button>
    ) : (
      <SignInButton
        busy={isBusy}
        canSignInHere={Boolean(browser)}
        first={first}
        label={
          outcome?.kind === "failed" || outcome?.kind === "timed-out"
            ? "Try again"
            : account
              ? "Sign in again"
              : "Sign in"
        }
        onCancel={signIn.cancel}
        onStart={(where) => {
          start(where, account?.id);
        }}
        waiting={isWaitingOn(account)}
      />
    );
  const answer = outcome && planAnswer(provider, outcome);
  const single = accounts?.length === 1 ? accounts[0] : undefined;
  const isImpossible =
    provider === "claude" &&
    claude?.kind === "not-installed" &&
    !claude.canInstall;
  const waitingWords = <WaitingWords provider={provider} />;

  return {
    dialog: (
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setSigningOut(undefined);
          }
        }}
        open={signingOut !== undefined}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Sign out of {signingOut?.label}?
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
                if (signingOut) {
                  signOut(signingOut);
                }
              }}
            >
              Sign out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    ),
    isImpossible,
    /** Nothing connected, nothing under way, and nothing to say about the last try. */
    isUntouched:
      (accounts === undefined || accounts.length === 0) &&
      !isBusy &&
      answer === undefined,
    rows:
      accounts === undefined || accounts.length === 0 ? (
        <AccountRow
          end={isImpossible ? undefined : buttonFor()}
          line={
            isImpossible
              ? `Claude Code doesn't run on this computer, so ${APP_NAME} can't use a Claude subscription here.`
              : isWaitingOn()
                ? waitingWords
                : (answer ??
                  "If you pay for one, use its models in your chats here.")
          }
          title={`${name} plan`}
        />
      ) : (
        accounts.map((account) => (
          <AccountRow
            end={
              <>
                {account.isUsable ? null : buttonFor(account)}
                <RowMenu label={`More for ${account.label}`}>
                  <DropdownMenuItem
                    onSelect={() => {
                      setSigningOut(account);
                    }}
                  >
                    Disconnect
                  </DropdownMenuItem>
                </RowMenu>
              </>
            }
            isWarning={!account.isUsable && !isWaitingOn(account)}
            key={account.id}
            line={
              isWaitingOn(account)
                ? waitingWords
                : account.isUsable
                  ? account.line
                  : // A sign-in that just ended says why; before that, where
                    // the account stands.
                    ((account === single ? answer : undefined) ?? account.line)
            }
            title={`${name} plan`}
          />
        ))
      ),
    start: () => {
      start(first);
    },
  };
}

/** How a sign-in that didn't land ended; no plan says which plans count too. */
function planAnswer(
  provider: PlanProvider,
  outcome: NonNullable<ReturnType<typeof usePlanSignIns>["chatgpt"]["outcome"]>,
) {
  if (outcome.kind === "no-plan") {
    const title = connectPageCopy(outcome, provider)?.title;
    return title === undefined
      ? undefined
      : `${title}. ${
          provider === "grok"
            ? GROK_CONNECT_COPY.requirement
            : `${APP_NAME} only works with paid ${CONNECT_NAMES[provider]} plans.`
        }`;
  }
  return connectLine(outcome, provider);
}

/** Where a plan's sign-in under way stands, and where to finish it. */
function WaitingWords({ provider }: { provider: PlanProvider }) {
  const signIn = usePlanSignIns()[provider];
  const { data: claude } = useQuery(
    rpcClient.claudeAccount.live.status.experimental_liveOptions(),
  );
  const grokCode = usePendingGrokCode();
  if (signIn.phase === "checking") {
    return (
      <WaitingLine>Checking your {CONNECT_NAMES[provider]} plan</WaitingLine>
    );
  }
  if (provider === "claude" && claude?.install?.state === "downloading") {
    return signIn.waitingIn === "app" ? (
      <WaitingLine>
        {APP_NAME} is setting up Claude Code first. The page opens as soon as
        it’s ready.
      </WaitingLine>
    ) : (
      <WaitingLine>{claudeWaitingLine(claude)}</WaitingLine>
    );
  }
  return provider === "grok" && signIn.waitingIn === "external" && grokCode ? (
    <WaitingLine>{grokWaitingLine(grokCode.userCode)}</WaitingLine>
  ) : (
    <SignInWaitingLine where={signIn.waitingIn ?? "external"} />
  );
}
