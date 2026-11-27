import { useProviderSwitch } from "@/client/components/settings/provider-switch";
import { Button } from "@/client/components/ui/button";
import { waitingLine } from "@/client/components/window/apps-home";
import { connectLine } from "@/client/lib/connect-copy";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { AIProviderConfigIdSchema } from "@instrument-org/shared";
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
 * The Grok plan X's search runs on, as the workspace counts it: `account`,
 * the first signed in with a plan and not disabled in Settings, else
 * `disabled`, the first that only needs enabling.
 */
export function useGrokPlan({ enabled = true }: { enabled?: boolean } = {}) {
  const { data } = useQuery({
    ...rpcClient.grokAccount.live.status.experimental_liveOptions(),
    enabled,
  });
  const { data: off = [] } = useQuery({
    ...rpcClient.providerConfig.live.disabled.experimental_liveOptions(),
    enabled,
  });
  const isOff = (id: string) => off.some((each) => each === id);
  const signedIn =
    data?.accounts.filter((each) => each.state === "signed-in") ?? [];
  return {
    account: signedIn.find((each) => !isOff(each.id)),
    disabled: signedIn.find((each) => isOff(each.id)),
  };
}

/** Enables a Grok account disabled in Settings, which X's search runs on again. */
export function EnableGrokAccount({ id }: { id: string }) {
  const providerSwitch = useProviderSwitch();
  return (
    <Button
      onClick={() => {
        providerSwitch.setEnabled(AIProviderConfigIdSchema.parse(id), true);
      }}
      size="sm"
      variant="outline"
    >
      Enable
    </Button>
  );
}

/** A Grok account's line while it is disabled in Settings. */
export const GROK_ACCOUNT_DISABLED = "Your Grok account is disabled.";

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
  const { account, disabled } = useGrokPlan();
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
          account !== undefined ? undefined : disabled !== undefined ? (
            <EnableGrokAccount id={disabled.id} />
          ) : (
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
          )
        }
        line={
          account !== undefined ? (
            `Grok plan, signed in as ${account.label}`
          ) : disabled !== undefined ? (
            GROK_ACCOUNT_DISABLED
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
