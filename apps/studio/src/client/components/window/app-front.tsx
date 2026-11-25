import { blockToolbarButtonClassName } from "@/client/components/code-block";
import { CopyButton } from "@/client/components/copy-button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { AiAppAccounts } from "@/client/components/window/ai-app-accounts";
import { AppCapabilities } from "@/client/components/window/app-capabilities";
import { AppIcon } from "@/client/components/window/app-icon";
import {
  AccountRow,
  AccountsCard,
  AddAccountRow,
  AskCard,
  ThingsToDo,
} from "@/client/components/window/app-page-parts";
import { AppMenuButton } from "@/client/components/window/app-menu";
import { AppKeys } from "@/client/components/window/app-keys";
import { useAppsBySlug } from "@/client/components/window/apps-by-slug";
import { waitingLine } from "@/client/components/window/apps-home";
import { useConnectFromDirectory } from "@/client/components/window/use-connect-from-directory";
import { useSetUpThenSignIn } from "@/client/components/window/use-set-up-then-sign-in";
import {
  AppInspector,
  type InspectorReading,
} from "@/client/components/window/app-inspector";
import { visitsWithin } from "@/client/components/window/app-visits";
import { ConnectControls } from "@/client/components/window/connect-controls";
import { useWindow } from "@/client/components/window/context";
import { useGroupTab } from "@/client/components/window/group-tab";
import {
  FixWithInstrumentButton,
  useFixConnection,
} from "@/client/components/window/fix-connection";
import { SignInWaitingLine } from "@/client/components/window/sign-in-button";
import { useSiteSignIn } from "@/client/components/window/site-sign-in";
import { useTabSurface } from "@/client/components/window/tab-surface";
import { PageSection } from "@/client/components/window/page-section";
import { signInsWaitingAtom } from "@/client/components/window/use-sign-in-landing";
import { VisitedPageRows } from "@/client/components/window/visited-page-rows";
import { useModalBack } from "@/client/hooks/use-modal-back";
import { useRecentPages } from "@/client/hooks/use-browser-history";
import { planOfApp } from "@/client/lib/ai-apps";
import { appMentionToken } from "@/client/lib/app-mention";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { osConventions } from "@/client/lib/utils";
import { CaretLeftIcon } from "@phosphor-icons/react/CaretLeft";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useState } from "react";
import { useAppTest } from "@/client/components/window/use-app-test";

type App = RPCOutput["apps"]["list"]["apps"][number];
type CatalogEntry = RPCOutput["apps"]["catalogByMeaning"][number];

/** How many of the pages visited in the app its front lists. */
const VISITS_SHOWN = 12;

/**
 * An app's page, which is its front: where you have been in it lately, out
 * of the window's own browsing held to the app's site, with the app itself
 * one labeled button away. Before it is connected, one card with the one
 * control that connects it. Connected, its accounts, requests to make of it,
 * and a menu for what it can do and for taking it away.
 */

export function AppFront({
  onToApps,
  reportsScreen = true,
  slug,
}: {
  /** Back to the apps, as the host shows them: after the app is removed, or when there is none by that name. */
  onToApps: () => void;
  /** Whether the front tells the conversation it is the screen up; off inside a draft, which says that itself. */
  reportsScreen?: boolean;
  slug: string;
}) {
  const { ask: askWindow, browser, openPage, openScreen } = useWindow();
  // A line asked here opens its draft beside the app's page in its group.
  const groupTabId = useGroupTab()?.id;
  const ask = (line: string) => {
    askWindow(line, { from: groupTabId });
  };
  const list = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const catalog = useQuery(
    rpcClient.apps.live.catalog.experimental_liveOptions(),
  );
  const app = list.data?.apps.find((entry) => entry.slug === slug);
  // The directory's entry for the service, which a second account set up
  // beside the first (gmail-2) shares with it.
  const service = app?.service ?? slug;
  const entry = catalog.data?.find((candidate) => candidate.slug === service);
  // The other accounts of the service here, which the account line lists.
  const otherAccounts =
    app?.service === undefined
      ? []
      : (list.data?.apps ?? []).filter(
          (other) => other.service === app.service && other.slug !== slug,
        );
  // Drawn as every other surface draws the app, the chip and the tab included.
  const drawn = useAppsBySlug().get(slug);
  const name = drawn?.name ?? slug;
  const site = drawn?.site;
  const icon = drawn?.icon;
  const home = app?.home ?? entry?.home ?? site;
  const isConnected = app?.status === "connected";
  // Worked on its own site in the window's browser: the site is the app, so
  // opening it is what the page leads with.
  const isWeb = app?.type === "web";
  // Every action the app lists, open to try, behind the menu by its name:
  // there to look into, not what the page leads with.
  const [isInspecting, setIsInspecting] = useState(false);
  // The action the list opens on, when a card opened it.
  const [inspectingAction, setInspectingAction] = useState<string>();
  useModalBack(() => {
    setIsInspecting(false);
  }, isInspecting);
  const isBrowsable =
    isConnected && (app.type === "mcp" || app.type === "mcp-local");
  const runsHere =
    isBrowsable &&
    (app.type === "mcp-local" ||
      /^https?:\/\/(?:127\.|localhost|\[::1\])/.test(app.endpoint));
  const [reading, setReading] = useState<InspectorReading>();
  const { connect, isConnecting } = useConnectFromDirectory();
  const screen = {
    app: {
      name,
      ...(reading && isBrowsable
        ? {
            reading: {
              args: JSON.stringify(reading.args),
              title: reading.title,
              tool: reading.tool,
            },
          }
        : {}),
      slug,
      standing: app?.status ?? "not-set-up",
    },
    screen: "apps" as const,
  };
  useTabSurface("view", reportsScreen ? screen : null);
  // The pages the window has shown on the app's site, newest first: the
  // best place to start in an app is where you already were in it.
  const visited = useRecentPages();
  const visits = visitsWithin(visited, [{ name, site }]).slice(0, VISITS_SHOWN);

  if (list.isPending || catalog.isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (!app && !entry) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>No app called “{slug}”.</p>
        <button className="underline" onClick={onToApps} type="button">
          Apps
        </button>
      </div>
    );
  }

  const domain = home ? new URL(home).host : undefined;
  const examples = entry?.examples ?? [];
  // One of the Mac's own apps runs on a server the app ships, so connecting
  // it installs nothing; macOS asks the person itself on first use.
  const isBundled = app?.type === "mcp-local" && app.bundled;

  // An AI signs in to its site and its plan in rows of their own.
  const plan = planOfApp({ service, slug });
  const isOnAiSite = plan !== undefined && (app === undefined || isWeb);
  // Every account of the service is a row once one of them is connected.
  const accounts = [...(app ? [app] : []), ...otherAccounts];
  const hasRows = accounts.some((each) => each.status === "connected");
  const rows = isOnAiSite
    ? otherAccounts
    : hasRows
      ? accounts.filter(
          (each) => each.slug !== slug || isConnected || asksForSignIn(each),
        )
      : otherAccounts;
  const isRow = rows.some((each) => each.slug === slug);
  const openHome = () => {
    if (home && browser) {
      openPage(home);
    }
  };

  return (
    // The page is worked from its content, which the keys scroll.
    <div
      className="flex h-full min-h-0 flex-col overflow-y-auto px-8 pt-8 pb-10 outline-none"
      data-keyboard-home
      tabIndex={-1}
    >
      <div className="mx-auto w-full max-w-2xl">
        {/* No way back up to Apps here: the row above says where this is. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
          <AppIcon
            className="-ml-2"
            icon={icon}
            name={name}
            site={site}
            size="xl"
          />
          <div className="min-w-40 flex-1">
            <h1 className="truncate font-serif text-3xl leading-tight font-normal tracking-tight">
              {name}
            </h1>
            <p className="truncate text-[13px] leading-5 text-muted-foreground">
              {domain ?? (app ? app.endpoint : "")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {isConnected ? (
              <Button
                className="text-foreground"
                onClick={() => {
                  ask(
                    `What can you do with ${appMentionToken({ name, slug })} for me?`,
                  );
                }}
                size="sm"
                variant="outline"
              >
                Ask about {name}
              </Button>
            ) : null}
            {/* The site is a site whether or not the app is connected, so
              the way to it is always here, except for an AI, whose sign-in
              is the way there. */}
            {home && browser && (isConnected || !isOnAiSite) ? (
              <Button
                className="text-foreground"
                onClick={openHome}
                size="sm"
                variant="outline"
              >
                Open {name}
              </Button>
            ) : null}
            {app ? (
              <AppMenuButton
                app={app}
                name={name}
                onInspect={() => {
                  setIsInspecting(true);
                }}
                onRemoved={onToApps}
              />
            ) : null}
          </div>
        </div>

        {plan ? (
          <AiAppAccounts
            app={app}
            entrySlug={service}
            name={name}
            provider={plan}
            slug={slug}
          />
        ) : null}

        {isConnected || isOnAiSite || isRow ? null : (
          <AppSetUp app={app} entry={entry} name={name} slug={slug} />
        )}

        {rows.length > 0 ? (
          <AccountsCard>
            {rows.map((each) => (
              <AppAccountRow
                app={each}
                isThisPage={each.slug === slug}
                key={each.slug}
                name={name}
                onOpen={() => {
                  openScreen(`/apps/${each.slug}`);
                }}
                onRemoved={each.slug === slug ? onToApps : undefined}
              />
            ))}
            {entry && !isBundled ? (
              <AddAccountRow
                disabled={isConnecting}
                onAdd={() => {
                  connect(entry, { another: true });
                }}
              />
            ) : null}
          </AccountsCard>
        ) : null}

        <ThingsToDo
          isConnected={isConnected}
          lines={examples}
          onAsk={(example) => {
            ask(`${appMentionToken({ name, slug })}: ${example}`);
          }}
        />

        {isConnected && app.keys.length > 0 ? (
          <div className="mt-8">
            <AppKeys
              keys={app.keys}
              name={name}
              origin={app.credentialOrigin}
              slug={slug}
            />
          </div>
        ) : null}

        {/* Where you have been in the app, laid out the way the browser's
          start page lays out its own: the quick way back into a service is
          the page you were on. */}
        {visits.length > 0 ? (
          <div className="mt-8">
            <PageSection title="Recent pages">
              <VisitedPageRows isCompact onOpen={openPage} visits={visits} />
            </PageSection>
          </div>
        ) : null}

        {isBrowsable ? (
          <Dialog
            onOpenChange={(isOpen) => {
              setIsInspecting(isOpen);
              if (!isOpen) {
                setReading(undefined);
                setInspectingAction(undefined);
              }
            }}
            open={isInspecting}
          >
            <DialogContent
              className="flex h-full flex-col"
              maxHeight={inspectingAction === undefined ? "40rem" : "46rem"}
              maxWidth={inspectingAction === undefined ? "48rem" : "72rem"}
            >
              <DialogHeader>
                <DialogTitle>What Instrument can do in {name}</DialogTitle>
              </DialogHeader>
              {inspectingAction === undefined ? (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <AppCapabilities
                    name={name}
                    onInspect={setInspectingAction}
                    slug={slug}
                  />
                </div>
              ) : (
                <>
                  <button
                    className="inline-flex items-center gap-1 self-start text-[13px] text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setInspectingAction(undefined);
                      setReading(undefined);
                    }}
                    type="button"
                  >
                    <CaretLeftIcon className="size-3" />
                    Back
                  </button>
                  <AppInspector
                    initialAction={inspectingAction}
                    name={name}
                    onReading={setReading}
                    runsHere={runsHere}
                    slug={slug}
                  />
                </>
              )}
            </DialogContent>
          </Dialog>
        ) : null}
      </div>
    </div>
  );
}

/** Whether what an app waits for is a sign-in, which its row can offer. */
function asksForSignIn(app: App): boolean {
  return (
    app.status === "needs-sign-in" ||
    (app.status === "declined" &&
      (app.type === "web" || app.authKind === "oauth"))
  );
}

/** One account of the app's service: whose it is, where it stands, and what to do about it. */
function AppAccountRow({
  app,
  isThisPage,
  name,
  onOpen,
  onRemoved,
}: {
  app: App;
  isThisPage: boolean;
  name: string;
  onOpen: () => void;
  onRemoved: (() => void) | undefined;
}) {
  const waitingIn = useAtomValue(signInsWaitingAtom).get(app.slug)?.where;
  const isConnected = app.status === "connected";
  const isSignedOut = asksForSignIn(app);
  return (
    <AccountRow
      end={
        <>
          {isSignedOut ? (
            <ConnectControls
              kind={app.type === "web" ? "web" : "sign-in"}
              label="Sign in again"
              name={name}
              primary={false}
              slug={app.slug}
            />
          ) : null}
          <AppMenuButton
            app={app}
            isAccount
            name={app.account ?? name}
            {...(onRemoved && { onRemoved })}
          />
        </>
      }
      isWarning={!isConnected && waitingIn === undefined}
      line={
        waitingIn !== undefined && !isConnected ? (
          <SignInWaitingLine where={waitingIn} />
        ) : isConnected ? (
          "Connected"
        ) : isSignedOut ? (
          "Signed out"
        ) : (
          waitingLine(app)
        )
      }
      {...(isThisPage ? {} : { onOpen })}
      title={app.account ?? (app.slug === app.service ? app.name : app.slug)}
    />
  );
}

/**
 * What connecting an app still takes: one card with the one thing to press,
 * a key's field or a server's go-ahead under it where that is what it wants,
 * and Instrument beside another try once one failed.
 */
function AppSetUp({
  app,
  entry,
  name,
  slug,
}: {
  app: App | undefined;
  entry: CatalogEntry | undefined;
  name: string;
  slug: string;
}) {
  const { ask } = useWindow();
  const groupTabId = useGroupTab()?.id;
  const { connect, isConnecting } = useConnectFromDirectory();
  const test = useAppTest(name);
  const { fix } = useFixConnection({
    name,
    slug,
    updatedAt: app?.connection?.updatedAt,
  });
  const site = useSiteSignIn({ askedIn: undefined, name, slug });
  const waitingIn = useAtomValue(signInsWaitingAtom).get(slug)?.where;
  const isWeb = app?.type === "web";
  const isBundled = app?.type === "mcp-local" && app.bundled;
  const isFailed = app?.status === "failed";
  const failure = isFailed
    ? app.connection?.ended === "refused"
      ? "refused"
      : "failed"
    : undefined;
  const several = (app?.keys.length ?? 0) > 1;
  // A test that failed with a key stored may be the key, which nobody but the
  // person can replace, so it can be pasted again as well as tried again.
  const rejectedKey =
    isFailed && !isWeb && app.authKind !== "none" && app.authKind !== "oauth";
  const keyRefused = rejectedKey && app.connection?.keyRefused === true;
  const firstWay = entry?.interfaces[0];
  const signInKind =
    app === undefined
      ? firstWay === undefined && entry?.home !== undefined
        ? "web"
        : firstWay?.format === "mcp" && firstWay.auth === "oauth"
          ? "sign-in"
          : undefined
      : isWeb
        ? "web"
        : asksForSignIn(app) ||
            (isFailed && app.authKind === "oauth" && !app.hasCredential)
          ? "sign-in"
          : undefined;
  const { controls } = useSetUpThenSignIn({
    app,
    entrySlug: entry?.slug ?? slug,
    failure,
    fix,
    kind: signInKind ?? "sign-in",
    name,
    onNeedsAgent: () => {
      ask(`Connect ${appMentionToken({ name, slug })}`, { from: groupTabId });
    },
    slug,
  });
  const isAi = entry?.category === "ai";
  const asksForKey = app?.status === "needs-key" || rejectedKey;
  const gets = isAi
    ? `Instrument can then look through your chats and use ${name} for you.`
    : `Instrument can then work in ${name} for you.`;

  const title = !app
    ? isAi
      ? `Sign in to ${name}`
      : `Connect ${name}`
    : isFailed
      ? keyRefused
        ? `${name} didn’t accept the ${several ? "keys" : "key"}`
        : `${name} didn’t connect`
      : asksForKey
        ? several
          ? `Add keys from ${name}`
          : `Add a key from ${name}`
        : app.status === "needs-approval" && !isBundled
          ? `Allow ${name} to run on ${osConventions().thisComputer}`
          : app.status === "stale"
            ? `${name} changed since it last connected`
            : signInKind === "web" || app.connection?.error
              ? `Sign in to ${name}`
              : `Connect ${name}`;
  const line =
    waitingIn !== undefined ? (
      <SignInWaitingLine where={waitingIn} />
    ) : site.isWaiting ? (
      `Sign in on the ${name} page that opened, then press Done.`
    ) : keyRefused ? (
      several ? (
        "Copy the keys again and paste them here, or let Instrument take a look."
      ) : (
        "Copy the key again and paste it here, or let Instrument take a look."
      )
    ) : failure === "refused" ? (
      `${name} won’t let this account connect directly, but Instrument can look for another way.`
    ) : isFailed ? (
      "Try again, or let Instrument look for another way."
    ) : app?.status === "stale" ? (
      "Try again to connect it as it is now."
    ) : isBundled ? (
      `macOS will ask you once before Instrument uses ${name}.`
    ) : (
      gets
    );
  const fixButton = <FixWithInstrumentButton onClick={fix} />;
  const tryAgain = (
    <Button
      className={rejectedKey ? "text-foreground" : undefined}
      disabled={test.isPending}
      onClick={() => {
        test.mutate({ slug });
      }}
      size="sm"
      variant={rejectedKey ? "outline" : "brand"}
    >
      {test.isPending ? "Trying…" : "Try again"}
    </Button>
  );
  const runs =
    app?.status === "needs-approval" ? (
      <ConnectControls
        kind="run"
        {...(isBundled && { label: "Connect" })}
        name={name}
        runs={app.type === "mcp-local" && !app.bundled ? app.runs : undefined}
        slug={slug}
      />
    ) : undefined;
  return (
    <AskCard
      end={
        signInKind !== undefined ? (
          controls
        ) : asksForKey ? undefined : isBundled && runs ? (
          runs
        ) : runs ? undefined : app ? (
          <div className="flex items-center gap-1.5">
            {isFailed ? fixButton : null}
            {tryAgain}
          </div>
        ) : entry ? (
          <Button
            disabled={isConnecting}
            onClick={() => {
              connect(entry);
            }}
            size="sm"
            variant="brand"
          >
            Connect
          </Button>
        ) : undefined
      }
      line={line}
      title={title}
    >
      {asksForKey ? (
        <ConnectControls
          alongside={
            rejectedKey ? (
              <>
                {tryAgain}
                {fixButton}
              </>
            ) : undefined
          }
          kind="key"
          name={name}
          slug={slug}
        />
      ) : runs && !isBundled ? (
        runs
      ) : isFailed && app.connection?.error ? (
        <details className="text-xs text-muted-foreground">
          <summary className="w-fit cursor-default hover:text-foreground">
            Details
          </summary>
          <div className="group/detail relative mt-2 rounded-lg bg-muted/60 px-3 py-2 select-text">
            <pre className="max-h-32 scrollbar-thin scrollbar-color overflow-auto pr-7 font-mono text-xs leading-5 wrap-break-word whitespace-pre-wrap text-foreground/80">
              {app.connection.error}
            </pre>
            {/* `focus-within` as well as hover: the button stays in the tab
              order while it is transparent. */}
            <div className="absolute top-2 right-2 opacity-0 group-hover/detail:opacity-100 focus-within:opacity-100">
              <CopyButton
                className={blockToolbarButtonClassName}
                iconSize={12}
                onCopy={async () => {
                  await navigator.clipboard.writeText(
                    app.connection?.error ?? "",
                  );
                }}
                tooltip="Copy"
              />
            </div>
          </div>
        </details>
      ) : null}
    </AskCard>
  );
}
