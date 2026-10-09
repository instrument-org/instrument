import { blockToolbarButtonClassName } from "@/client/components/code-block";
import { CopyButton } from "@/client/components/copy-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { AppCapabilities } from "@/client/components/window/app-capabilities";
import { AppIcon } from "@/client/components/window/app-icon";
import { useAppsBySlug } from "@/client/components/window/apps-by-slug";
import { InstrumentGlyph } from "@/client/components/wordmark";
import { useConnectFromDirectory } from "@/client/components/window/use-connect-from-directory";
import {
  AppInspector,
  type InspectorReading,
} from "@/client/components/window/app-inspector";
import { visitsWithin } from "@/client/components/window/app-visits";
import { thisComputer } from "@/client/components/window/computer-name";
import { ConnectControls } from "@/client/components/window/connect-controls";
import { useWindow } from "@/client/components/window/context";
import { GlyphButton } from "@/client/components/window/glyph-button";
import { useOnScreen } from "@/client/components/window/on-screen";
import { PageSection } from "@/client/components/window/page-section";
import { VisitedPageRows } from "@/client/components/window/visited-page-rows";
import { useHoldWindow } from "@/client/hooks/use-hold-window";
import { useRecentPages } from "@/client/hooks/use-browser-history";
import { appMentionToken } from "@/client/lib/app-mention";
import { rpcClient } from "@/client/rpc/client";
import { DotsThreeVerticalIcon } from "@phosphor-icons/react/DotsThreeVertical";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";

/** How many of the pages visited in the app its front lists. */
const VISITS_SHOWN = 12;

/**
 * An app's page, which is its front: where you have been in it lately, out
 * of the window's own browsing held to the app's site, with the app itself
 * one labeled button away. Before it is connected, a listing: what the
 * directory says it is and what connecting takes, with the one control that
 * finishes that. Connected, it is a connection too: the way to ask about
 * it, whose it is and since when, what it can do, and a menu by its name
 * for taking it away.
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
  const { ask, browser, openPage } = useWindow();
  const list = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const catalog = useQuery(rpcClient.apps.catalog.queryOptions());
  // The default browser by name, as the sign-in button beside it says it.
  const defaultBrowser = useQuery(
    rpcClient.utils.browserOpenTarget.queryOptions({
      refetchOnMount: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      staleTime: Number.POSITIVE_INFINITY,
    }),
  );
  const browserName = defaultBrowser.data?.appName ?? "your browser";
  const app = list.data?.apps.find((entry) => entry.slug === slug);
  // The directory's entry for the service: by slug, or by site for a second
  // account set up beside the first (notion-2 is Notion).
  const entry =
    catalog.data?.find((candidate) => candidate.slug === slug) ??
    catalog.data?.find(
      (candidate) =>
        app?.site !== undefined && app.site === `https://${candidate.domain}`,
    );
  // Drawn as every other surface draws the app, the chip and the tab included.
  const drawn = useAppsBySlug().get(slug);
  const name = drawn?.name ?? slug;
  const site = drawn?.site;
  const icon = drawn?.icon;
  const home = app?.home ?? entry?.home ?? site;
  const isConnected = app?.standing === "connected";
  // Worked on its own site in the window's browser: the site is the app, so
  // opening it is what the page leads with.
  const isWeb = app?.type === "web";
  // Every action the app lists, open to try, behind the menu by its name:
  // there to look into, not what the page leads with.
  const [isInspecting, setIsInspecting] = useState(false);
  // The action the list opens on, when a card opened it.
  const [inspectingAction, setInspectingAction] = useState<string>();
  useHoldWindow(isInspecting, {
    onClose: () => {
      setIsInspecting(false);
    },
  });
  const isBrowsable =
    isConnected && (app.type === "mcp" || app.type === "mcp-local");
  const runsHere =
    isBrowsable &&
    (app.type === "mcp-local" ||
      /^https?:\/\/(?:127\.|localhost|\[::1\])/.test(app.endpoint));
  const [reading, setReading] = useState<InspectorReading>();
  const [isNaming, setIsNaming] = useState(false);
  const { connect, isConnecting } = useConnectFromDirectory();
  const setAccount = useMutation(
    rpcClient.apps.setAccount.mutationOptions({
      onError: (error) => {
        toast.error("Could not name the account", {
          description: error.message,
        });
      },
    }),
  );
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
      standing: app?.standing ?? "not-set-up",
    },
    screen: "apps" as const,
  };
  useOnScreen(reportsScreen ? screen : null);
  // The pages the window has shown on the app's site, newest first: the
  // best place to start in an app is where you already were in it.
  const visited = useRecentPages();
  const visits = visitsWithin(visited, [{ name, site }]).slice(0, VISITS_SHOWN);

  const disconnect = useMutation(
    rpcClient.apps.disconnect.mutationOptions({
      onError: (error) => {
        toast.error("Could not disconnect", { description: error.message });
      },
    }),
  );
  const remove = useMutation(
    rpcClient.apps.remove.mutationOptions({
      onError: (error) => {
        toast.error("Could not remove the app", {
          description: error.message,
        });
      },
      onSuccess: () => {
        onToApps();
      },
    }),
  );
  const test = useMutation(
    rpcClient.apps.test.mutationOptions({
      onError: (error) => {
        toast.error("Could not test the app", { description: error.message });
      },
      onSuccess: (report) => {
        if (!report.passed) {
          const failure = report.checks.find(
            (check) => check.status === "fail",
          );
          toast.error(`${name} did not connect`, {
            description: failure?.detail.split("\n")[0],
          });
        }
      },
    }),
  );

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
  const examples = isConnected ? (entry?.examples ?? []) : [];
  const methods = (entry?.authMethods ?? []).map((method) => method.label);
  // What setting up waits on, in one line, with at most one more under it;
  // where the controls below say where a sign-in or key goes, they say it.
  const setupTitle = !app
    ? `Connect ${name}`
    : isWeb
      ? `Sign in to ${name} on the web`
      : app.standing === "needs-sign-in"
        ? app.connection?.error
          ? `Sign in to ${name} again`
          : `Sign in to ${name}`
        : app.standing === "needs-key"
          ? `Add a key from ${name}`
          : app.standing === "needs-approval"
            ? `Allow ${name} to run on ${thisComputer()}`
            : app.standing === "failed"
              ? `Couldn’t connect to ${name}`
              : app.standing === "stale"
                ? `${name} changed since it last connected`
                : `Finish connecting ${name}`;
  const setupDetail = !app
    ? methods.length > 0
      ? `Connects with ${methods.join(" or ")}.`
      : undefined
    : app.standing === "needs-sign-in" && !isWeb
      ? `Sign in here in a tab, or with ${browserName} if you’re already signed in to ${name} there.`
      : app.standing === "stale"
        ? "Try again to connect it as it is now."
        : undefined;
  // The way out when the buttons beside it are not getting there: last and
  // quiet, so it reads as help rather than one more way to sign in.
  const withInstrument = (
    <Button
      onClick={() => {
        ask(
          app
            ? `Help me finish connecting ${appMentionToken({ name, slug })}`
            : `Connect ${appMentionToken({ name, slug })}`,
        );
      }}
      className="text-muted-foreground hover:text-foreground"
      size="sm"
      variant="ghost"
    >
      <InstrumentGlyph className="size-3.5 text-brand-600 dark:text-brand-400" />
      Ask Instrument for help
    </Button>
  );
  const openHome = () => {
    if (home && browser) {
      openPage(home);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-8 pt-6 pb-6">
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
        {/* No way back up to Apps here: the row above says where this is. */}
        <div className="flex items-center gap-3">
          <AppIcon icon={icon} name={name} site={site} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <h1 className="text-lg leading-6 font-semibold">{name}</h1>
              {app ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label={`More for ${name}`}
                      className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
                      type="button"
                    >
                      <DotsThreeVerticalIcon className="size-4" weight="bold" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {isBrowsable ? (
                      <DropdownMenuItem
                        onSelect={() => {
                          setIsInspecting(true);
                        }}
                      >
                        View actions
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                      onSelect={() => {
                        setIsNaming(true);
                      }}
                    >
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={test.isPending}
                      onSelect={() => {
                        test.mutate({ slug });
                      }}
                    >
                      Test connection
                    </DropdownMenuItem>
                    {entry ? (
                      <DropdownMenuItem
                        disabled={isConnecting}
                        onSelect={() => {
                          connect(entry, { another: true });
                        }}
                      >
                        Connect another account
                      </DropdownMenuItem>
                    ) : null}
                    {isConnected || app.hasCredential ? (
                      <DropdownMenuItem
                        disabled={disconnect.isPending}
                        onSelect={() => {
                          disconnect.mutate({ slug });
                        }}
                      >
                        Disconnect
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                      disabled={remove.isPending}
                      onSelect={() => {
                        remove.mutate({ slug });
                      }}
                      variant="destructive"
                    >
                      Remove
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
            {/* Which account it is, when that is named, so two of one
                service can be told apart; otherwise the directory's one line
                about the app. Naming it turns the line into a field. */}
            {isNaming && app ? (
              <AccountField
                initial={app.account ?? ""}
                onDone={(account) => {
                  setIsNaming(false);
                  if (account !== undefined) {
                    setAccount.mutate({ account, slug });
                  }
                }}
              />
            ) : app?.account ? (
              <p className="truncate text-xs leading-5 text-muted-foreground">
                {app.account}
              </p>
            ) : entry?.tagline ? (
              <p className="truncate text-xs leading-5 text-muted-foreground">
                {entry.tagline}
              </p>
            ) : (
              <p className="truncate text-xs leading-5 text-muted-foreground">
                {domain ?? (app ? app.endpoint : "")}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* The site is a site whether or not the app is connected, so the
              way to it is always here, wearing the app's own mark;
              connecting is what the agent needs, not what a person needs to
              open a page. */}
            {home && browser && isWeb && isConnected ? (
              <Button onClick={openHome} size="sm">
                <AppIcon icon={icon} name={name} site={site} size="sm" />
                <span className="truncate">Open {name}</span>
              </Button>
            ) : home && browser ? (
              <button
                className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-foreground shadow-xs hover:bg-accent"
                onClick={openHome}
                type="button"
              >
                <AppIcon icon={icon} name={name} site={site} size="sm" />
                <span className="truncate">Open {name}</span>
              </button>
            ) : null}
            {isConnected ? (
              <GlyphButton
                onClick={() => {
                  ask(
                    `What can you do with ${appMentionToken({ name, slug })} for me?`,
                  );
                }}
                size="sm"
              >
                Ask about {name}
              </GlyphButton>
            ) : null}
          </div>
        </div>

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

        {/* Requests a person might make of the app, each one press from
          the conversation. */}
        {examples.length > 0 ? (
          <div className="mt-8">
            <PageSection title="Try asking">
              <div className="flex flex-wrap gap-2">
                {examples.map((example) => (
                  <button
                    className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-left text-[13px] leading-5 shadow-xs hover:bg-accent"
                    key={example}
                    onClick={() => {
                      ask(`${appMentionToken({ name, slug })}: ${example}`);
                    }}
                    type="button"
                  >
                    {/* The glyph every button that opens a prefilled draft
                      carries, so these read as asking Instrument. */}
                    <InstrumentGlyph className="size-3.5 shrink-0 text-brand-600 dark:text-brand-400" />
                    {example}
                  </button>
                ))}
              </div>
            </PageSection>
          </div>
        ) : null}

        {isBrowsable ? (
          <AppCapabilities
            name={name}
            onAsk={(action) => {
              ask(`Use ${action} in ${appMentionToken({ name, slug })} to `);
            }}
            onInspect={(action) => {
              setInspectingAction(action);
              setIsInspecting(true);
            }}
            slug={slug}
          />
        ) : null}

        {isBrowsable ? (
          <Dialog
            onOpenChange={(isOpen) => {
              setIsInspecting(isOpen);
              if (!isOpen) {
                setReading(undefined);
              }
            }}
            open={isInspecting}
          >
            <DialogContent
              className="flex h-full flex-col"
              maxHeight="46rem"
              maxWidth="72rem"
            >
              <DialogHeader>
                <DialogTitle>Every action in {name}</DialogTitle>
                <DialogDescription>
                  Try any action that only reads data to see what {name} sends
                  back.
                </DialogDescription>
              </DialogHeader>
              <AppInspector
                initialAction={inspectingAction}
                name={name}
                onReading={setReading}
                runsHere={runsHere}
                slug={slug}
              />
            </DialogContent>
          </Dialog>
        ) : null}

        {/* While the app is still being set up, the one thing that
          finishes it: a line saying what, the controls for it, what went
          wrong last time (kept whole for copying), and the agent beside them
          for when the controls alone are not getting there. Gone the moment
          the connection lands. */}
        {isConnected ? null : (
          <div className="mt-8">
            <PageSection title="Setting up">
              <div className="space-y-3 rounded-xl border border-border bg-card p-4">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">{setupTitle}</p>
                  {setupDetail ? (
                    <p className="text-xs text-muted-foreground">
                      {setupDetail}
                    </p>
                  ) : null}
                </div>
                {app?.standing === "failed" && app.connection?.error ? (
                  <div className="group/detail relative rounded-lg bg-muted/60 px-3 py-2 select-text">
                    <pre className="max-h-32 scrollbar-thin scrollbar-color overflow-auto pr-7 font-mono text-xs leading-5 wrap-break-word whitespace-pre-wrap text-foreground/80">
                      {app.connection.error}
                    </pre>
                    {/* `focus-within` as well as hover: the button stays in
                        the tab order while it is transparent. */}
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
                ) : null}
                {isWeb ? (
                  <ConnectControls
                    alongside={withInstrument}
                    kind="web"
                    name={name}
                    slug={slug}
                  />
                ) : app?.standing === "needs-sign-in" ? (
                  <ConnectControls
                    alongside={withInstrument}
                    describesDestination={false}
                    kind="sign-in"
                    name={name}
                    slug={slug}
                  />
                ) : app?.standing === "needs-approval" ? (
                  <ConnectControls
                    alongside={withInstrument}
                    kind="run"
                    name={name}
                    runs={app.runs}
                    slug={slug}
                  />
                ) : app?.standing === "needs-key" ? (
                  <ConnectControls
                    alongside={withInstrument}
                    kind="key"
                    name={name}
                    slug={slug}
                  />
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    {/* A service the directory lists and nothing here yet
                        is set up from the directory; one already here that
                        failed or changed is tested again. */}
                    {app ? (
                      <Button
                        disabled={test.isPending}
                        onClick={() => {
                          test.mutate({ slug });
                        }}
                        size="sm"
                      >
                        {test.isPending ? "Trying…" : "Try again"}
                      </Button>
                    ) : entry ? (
                      <Button
                        disabled={isConnecting}
                        onClick={() => {
                          connect(entry);
                        }}
                        size="sm"
                      >
                        Connect {name}
                      </Button>
                    ) : null}
                    {withInstrument}
                  </div>
                )}
              </div>
            </PageSection>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The account line as a field: Enter keeps what was typed (an empty field
 * clears the name), Escape or leaving it keeps the name as it was.
 */
function AccountField({
  initial,
  onDone,
}: {
  initial: string;
  /** The name to keep, or undefined to leave it as it was. */
  onDone: (account: string | undefined) => void;
}) {
  const [value, setValue] = useState(initial);
  // Saving takes the field away, which can blur it on the way out; the
  // first ending is the one that counts.
  const ended = useRef(false);
  const end = (account: string | undefined) => {
    if (!ended.current) {
      ended.current = true;
      onDone(account);
    }
  };
  return (
    <input
      aria-label="Account"
      autoFocus
      className="h-5 w-full max-w-xs rounded-sm bg-transparent text-xs leading-5 text-foreground ring-1 ring-border outline-none focus-visible:ring-brand-500/40"
      onBlur={() => {
        end(undefined);
      }}
      onChange={(event) => {
        setValue(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          end(value.trim());
        } else if (event.key === "Escape") {
          event.preventDefault();
          end(undefined);
        }
      }}
      placeholder="jeremy@example.com"
      value={value}
    />
  );
}
