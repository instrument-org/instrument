import {
  claudeWaitingLine,
  grokWaitingLine,
} from "@/client/components/connect-button";
import { openSettings } from "@/client/atoms/settings-modal";
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
import { type ReactNode, useEffect, useEffectEvent, useState } from "react";

import { useWindow } from "./context";
import { usePendingGrokCode, usePlanSignIns } from "./plan-sign-in";
import { SignInPair } from "./sign-in-pair";
import { useSiteSignIn } from "./site-sign-in";
import { type SignInDestination } from "./use-sign-in-landing";

type App = RPCOutput["apps"]["list"]["apps"][number];

/**
 * An AI's two accounts on its app's page, each signed in to on its own: its
 * site, which an agent works in from a tab, and its plan, which chats can
 * run on. A row says where one stands, with what to press under it so a
 * narrow pane reads the same.
 */
export function AiAppAccounts({
  app,
  entrySlug,
  home,
  name,
  provider,
  slug,
}: {
  /** The app, once set up. One worked some other way than on its site has its own setup, and only its plan is here. */
  app: App | undefined;
  entrySlug: string;
  home: string | undefined;
  name: string;
  provider: PlanProvider;
  slug: string;
}) {
  const isOnSite = app === undefined || app.type === "web";
  return (
    <div className="mt-8 divide-y divide-border rounded-xl border border-border bg-card">
      {isOnSite ? (
        <SiteRow
          app={app}
          entrySlug={entrySlug}
          home={home}
          name={name}
          slug={slug}
        />
      ) : null}
      <PlanRow
        isSiteConnected={isOnSite && app?.status === "connected"}
        name={name}
        provider={provider}
        slug={slug}
      />
    </div>
  );
}

function Row({
  buttons,
  children,
  title,
}: {
  buttons?: ReactNode;
  children: ReactNode;
  title: string;
}) {
  return (
    <div className="px-5 py-4">
      <p className="text-sm font-medium">{title}</p>
      <div className="text-xs leading-5 text-muted-foreground">{children}</div>
      {buttons ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">{buttons}</div>
      ) : null}
    </div>
  );
}

function SiteRow({
  app,
  entrySlug,
  home,
  name,
  slug,
}: {
  app: App | undefined;
  entrySlug: string;
  home: string | undefined;
  name: string;
  slug: string;
}) {
  const { browser, openPage, openScreen } = useWindow();
  const site = useSiteSignIn({ askedIn: undefined, name, slug });
  // A press on an AI nothing is set up for yet sets it up, then opens its
  // sign-in once the app is here.
  const [opensOnceHere, setOpensOnceHere] = useState(false);
  const setUp = useMutation(
    rpcClient.apps.setUp.mutationOptions({
      onError: (error) => {
        setOpensOnceHere(false);
        toast.error(`Couldn't set up ${name}`, { cause: error });
      },
      onSuccess: (result) => {
        if (result.kind === "set-up" && result.slug !== slug) {
          setOpensOnceHere(false);
          openScreen(`/apps/${result.slug}`);
        }
      },
    }),
  );
  const openSite = useEffectEvent(() => {
    setOpensOnceHere(false);
    site.open();
  });
  const isDue = opensOnceHere && site.canOpen;
  useEffect(() => {
    if (isDue) {
      openSite();
    }
  }, [isDue]);
  const disconnect = useMutation(
    rpcClient.apps.disconnect.mutationOptions({
      onError: (error) => {
        toast.error(`Couldn't disconnect ${name}`, { cause: error });
      },
    }),
  );
  const title =
    home !== undefined && URL.canParse(home)
      ? new URL(home).host.replace(/^www\./, "")
      : name;

  if (app?.status === "connected") {
    return (
      <Row
        buttons={
          <>
            <Button
              className="text-foreground"
              disabled={!browser || home === undefined}
              onClick={() => {
                if (home !== undefined) {
                  openPage(home);
                }
              }}
              size="sm"
              variant="outline"
            >
              Open {name}
            </Button>
            <Button
              className="text-foreground"
              disabled={disconnect.isPending}
              onClick={() => {
                disconnect.mutate({ slug });
              }}
              size="sm"
              variant="ghost"
            >
              Disconnect
            </Button>
          </>
        }
        title={title}
      >
        Signed in.
      </Row>
    );
  }
  return (
    <Row
      buttons={
        // The button that shows the page stands where the one that opened it stood.
        <>
          <Button
            className={site.isWaiting ? "min-w-24 text-foreground" : "min-w-24"}
            disabled={
              !browser || opensOnceHere || (app !== undefined && !site.canOpen)
            }
            onClick={() => {
              if (app === undefined) {
                setOpensOnceHere(true);
                setUp.mutate({ slug: entrySlug });
              } else {
                site.open();
              }
            }}
            size="sm"
            variant={site.isWaiting ? "outline" : "brand"}
          >
            {site.isWaiting ? "Show page" : "Sign in"}
          </Button>
          {site.isWaiting ? (
            <Button
              className="text-foreground"
              disabled={site.isDonePending}
              onClick={site.done}
              size="sm"
              variant="outline"
            >
              Done signing in
            </Button>
          ) : null}
        </>
      }
      title={title}
    >
      {site.isWaiting
        ? `Sign in on the ${name} page that opened, then press Done.`
        : `Sign in to use your ${name} chats in ${APP_NAME}.`}
    </Row>
  );
}

/** One account of a plan, whichever service it is with. */
interface PlanAccount {
  id: string;
  isUsable: boolean;
  label: string;
  line: string;
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
  const joined = (...parts: (string | false | undefined)[]) =>
    parts.filter(Boolean).join(" · ");
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

function PlanRow({
  isSiteConnected,
  name,
  provider,
  slug,
}: {
  isSiteConnected: boolean;
  name: string;
  provider: PlanProvider;
  slug: string;
}) {
  const { browser, openPage } = useWindow();
  const signIns = usePlanSignIns();
  const signIn = signIns[provider];
  const accounts = usePlanAccounts(provider);
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

  // While this row is up it says how the sign-in went, so no toast does.
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
  // Beside the site's own session in this window, signing in here is the
  // shorter way; otherwise the person's own browser is likelier to have one.
  const lit = isSiteConnected ? "here" : true;
  const pairFor = (account?: PlanAccount) => (
    <SignInPair
      busy={isBusy}
      lit={outcome?.kind === "failed" ? true : lit}
      onCancel={signIn.cancel}
      onStart={(where) => {
        start(where, account?.id);
      }}
      verb={
        outcome?.kind === "failed" || outcome?.kind === "timed-out"
          ? "Try again"
          : account
            ? "Sign in again"
            : "Sign in"
      }
      waitingIn={
        isBusy && signIn.accountId === account?.id
          ? signIn.waitingIn
          : undefined
      }
    />
  );
  const answer = outcome && planAnswer(provider, outcome);
  const disconnectButton = (account: PlanAccount) => (
    <Button
      className="text-foreground"
      onClick={() => {
        setSigningOut(account);
      }}
      size="sm"
      variant="ghost"
    >
      Disconnect
    </Button>
  );
  const single = accounts?.length === 1 ? accounts[0] : undefined;
  const isWaitingOn = (account?: PlanAccount) =>
    isBusy && signIn.accountId === account?.id;

  return (
    <>
      {accounts === undefined || accounts.length === 0 ? (
        <NewPlanRow
          isBusy={isWaitingOn()}
          name={name}
          pair={
            outcome?.kind === "no-plan" ? (
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
              pairFor()
            )
          }
          provider={provider}
          words={answer}
        />
      ) : (
        accounts.map((account) => (
          <Row
            buttons={
              <>
                {account.isUsable ? (
                  <Button
                    className="text-foreground"
                    onClick={() => {
                      openSettings({ tab: "Providers" });
                    }}
                    size="sm"
                    variant="outline"
                  >
                    Choose a model
                  </Button>
                ) : (
                  pairFor(account)
                )}
                {isWaitingOn(account) ? null : disconnectButton(account)}
              </>
            }
            key={account.id}
            title={`${name} plan`}
          >
            {isWaitingOn(account) ? (
              <WaitingWords provider={provider} />
            ) : account.isUsable ? (
              account.line
            ) : (
              // A sign-in that just ended says why; before that, where the
              // account stands.
              ((account === single ? answer : undefined) ?? account.line)
            )}
          </Row>
        ))
      )}
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
    </>
  );
}

/** The plan's row with no account yet. */
function NewPlanRow({
  isBusy,
  name,
  pair,
  provider,
  words,
}: {
  isBusy: boolean;
  name: string;
  pair: ReactNode;
  provider: PlanProvider;
  words: string | undefined;
}) {
  const { data: claude } = useQuery(
    rpcClient.claudeAccount.live.status.experimental_liveOptions(),
  );
  const isImpossible =
    provider === "claude" &&
    claude?.kind === "not-installed" &&
    !claude.canInstall;
  return (
    <Row buttons={isImpossible ? undefined : pair} title={`${name} plan`}>
      {isImpossible ? (
        `Claude Code doesn't run on this computer, so ${APP_NAME} can't use a Claude subscription here.`
      ) : isBusy ? (
        <WaitingWords provider={provider} />
      ) : (
        (words ?? PLAN_ASKS[provider])
      )}
    </Row>
  );
}

const PLAN_ASKS: Record<PlanProvider, string> = {
  chatgpt: "Pay for ChatGPT Plus or Pro? Use it here.",
  claude: "Pay for a Claude plan? Use it here.",
  grok: GROK_CONNECT_COPY.caption,
};

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
  const name = CONNECT_NAMES[provider];
  if (signIn.phase === "checking") {
    return <>Checking your {name} plan.</>;
  }
  if (signIn.waitingIn === "app") {
    return provider === "claude" && claude?.install?.state === "downloading" ? (
      <>
        {APP_NAME} is setting up Claude Code first. The page opens as soon as
        it’s ready.
      </>
    ) : (
      <>Finish signing in to {name} on the page that opened.</>
    );
  }
  switch (provider) {
    case "chatgpt": {
      return <>Finish signing in with ChatGPT in your browser.</>;
    }
    case "claude": {
      return <>{claudeWaitingLine(claude)}.</>;
    }
    case "grok": {
      return <>{grokWaitingLine(grokCode?.userCode)}.</>;
    }
  }
}
