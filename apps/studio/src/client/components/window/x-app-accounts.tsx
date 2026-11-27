import { waitingLine } from "@/client/components/window/apps-home";
import { connectLine } from "@/client/lib/connect-copy";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";

import { DisconnectSite } from "./ai-app-accounts";
import { AccountRow, AccountsCard } from "./app-page-parts";
import { useWindow } from "./context";
import { usePlanSignIns } from "./plan-sign-in";
import { SignInButton, SignInWaitingLine } from "./sign-in-button";
import { useSiteSignIn } from "./site-sign-in";
import { useSetUpThenSignIn } from "./use-set-up-then-sign-in";

type App = RPCOutput["apps"]["list"]["apps"][number];

/**
 * X's two sign-ins on its page, each its own: the Grok plan its search runs
 * on, named by the account searches use (the first one signed in that can),
 * and its site, which an agent works in from a tab.
 */
export function XAppAccounts({
  app,
  entrySlug,
  name,
  slug,
}: {
  app: Extract<App, { type: "web" }>;
  entrySlug: string;
  name: string;
  slug: string;
}) {
  const { browser, openPage } = useWindow();
  const signIn = usePlanSignIns().grok;
  const { data } = useQuery(
    rpcClient.grokAccount.live.status.experimental_liveOptions(),
  );
  const account = data?.accounts.find((each) => each.state === "signed-in");
  const isBusy = signIn.phase !== "idle";
  const answer =
    isBusy || signIn.outcome === undefined
      ? undefined
      : connectLine(signIn.outcome, "grok");
  const site = useSiteSignIn({ askedIn: undefined, name, slug });
  const { controls } = useSetUpThenSignIn({
    app,
    entrySlug,
    kind: "web",
    name,
    slug,
  });
  const isSiteConnected = app.status === "connected";
  return (
    <AccountsCard>
      <AccountRow
        end={
          account === undefined ? (
            <SignInButton
              busy={isBusy}
              canSignInHere={browser !== null}
              first="app"
              onCancel={signIn.cancel}
              onStart={(where) => {
                signIn.start({
                  accountId: undefined,
                  openPage,
                  where: browser === null ? "external" : where,
                });
              }}
              waiting={isBusy}
            />
          ) : undefined
        }
        line={
          account !== undefined ? (
            `Grok plan, signed in as ${account.label}`
          ) : isBusy ? (
            <SignInWaitingLine where={signIn.waitingIn ?? "app"} />
          ) : (
            (answer ?? "Searching uses your Grok plan.")
          )
        }
        title="Search"
      />
      <AccountRow
        end={
          isSiteConnected ? (
            <DisconnectSite name={name} slug={slug} />
          ) : (
            controls
          )
        }
        line={
          isSiteConnected
            ? "Signed in"
            : site.isWaiting
              ? `Sign in on the ${name} page that opened, then press Done.`
              : waitingLine(app)
        }
        title={new URL(app.endpoint).host}
      />
    </AccountsCard>
  );
}
