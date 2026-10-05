import { visitedPagesAtom } from "@/client/atoms/window";
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
import { zoomMaxSize } from "@/client/hooks/use-app-zoom";
import { useBlockTabNavigation } from "@/client/hooks/use-block-tab-navigation";
import { appMentionToken } from "@/client/lib/app-mention";
import { rpcClient } from "@/client/rpc/client";
import { DotsThreeVerticalIcon } from "@phosphor-icons/react/DotsThreeVertical";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
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
  const app = list.data?.apps.find((entry) => entry.slug === slug);
  const entry = catalog.data?.find((candidate) => candidate.slug === slug);
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
  useBlockTabNavigation(isInspecting);
  const isBrowsable =
    isConnected && (app.type === "mcp" || app.type === "mcp-local");
  const runsHere =
    isBrowsable &&
    (app.type === "mcp-local" ||
      /^https?:\/\/(?:127\.|localhost|\[::1\])/.test(app.endpoint));
  const [reading, setReading] = useState<InspectorReading>();
  const [isNaming, setIsNaming] = useState(false);
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
  const visited = useAtomValue(visitedPagesAtom);
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
  const needs = app
    ? app.type === "web"
      ? `Sign in to ${name} in Instrument’s browser, then say so here.`
      : app.type === "mcp-local"
        ? `Runs on ${thisComputer()}: Instrument installs and starts ${app.runs ?? app.endpoint}${app.authKind === "env" ? `, with a key from ${name}` : ""}.`
        : app.type === "mcp" && app.authKind === "oauth"
          ? `Sign in to ${name} once.`
          : app.authKind === "none"
            ? "No sign-in needed."
            : `A key from ${name}. Instrument keeps it encrypted on ${thisComputer()}.`
    : methods.length > 0
      ? `Connects with ${methods.join(" or ")}.`
      : "";
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
                        See every action
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                      onSelect={() => {
                        setIsNaming(true);
                      }}
                    >
                      {app.account ? "Rename the account" : "Name the account"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={test.isPending}
                      onSelect={() => {
                        test.mutate({ slug });
                      }}
                    >
                      Test the connection
                    </DropdownMenuItem>
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
              className="flex flex-col"
              maxWidth="72rem"
              style={{ height: zoomMaxSize("height", "46rem") }}
            >
              <DialogHeader>
                <DialogTitle>Every action in {name}</DialogTitle>
                <DialogDescription>
                  Press anything that only reads to see what {name} answers.
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
          finishes it, in a quiet block: what connecting takes, the control
          for it, and what went wrong the last time, kept whole for copying.
          Gone the moment the connection lands; nothing about a connection
          stands on a connected app's front. */}
        {isConnected ? null : (
          <section className="mt-8">
            <p className="mb-2.5 text-[13px] font-medium text-muted-foreground">
              Setting up
            </p>
            <div className="rounded-xl border border-border bg-card p-4">
              {needs ? (
                <p className="mb-3 text-sm text-muted-foreground">{needs}</p>
              ) : null}
              {isWeb ? (
                <ConnectControls kind="web" name={name} slug={slug} />
              ) : app?.standing === "needs-sign-in" ? (
                <ConnectControls kind="sign-in" name={name} slug={slug} />
              ) : app?.standing === "needs-approval" ? (
                <ConnectControls
                  kind="run"
                  name={name}
                  runs={app.runs}
                  slug={slug}
                />
              ) : app?.standing === "needs-key" ? (
                <ConnectControls kind="key" name={name} slug={slug} />
              ) : (
                <GlyphButton
                  onClick={() => {
                    ask(
                      app && app.standing !== "untested"
                        ? `Finish connecting ${appMentionToken({ name, slug })}`
                        : `Connect ${appMentionToken({ name, slug })}`,
                    );
                  }}
                  size="sm"
                >
                  Connect {name}
                </GlyphButton>
              )}
              {app?.standing === "failed" && app.connection?.error ? (
                <div className="group/detail relative mt-3 rounded-lg bg-muted/60 px-3 py-2">
                  <pre className="max-h-32 scrollbar-thin scrollbar-color overflow-auto pr-7 font-mono text-xs leading-5 wrap-break-word whitespace-pre-wrap text-foreground/80">
                    {app.connection.error}
                  </pre>
                  {/* `focus-within` as well as hover: the button stays in the
                      tab order while it is transparent. */}
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
            </div>
          </section>
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
