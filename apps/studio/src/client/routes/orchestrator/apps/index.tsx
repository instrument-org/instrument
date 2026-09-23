import { visitedPagesAtom } from "@/client/atoms/orchestrator";
import { AppIcon } from "@/client/components/orchestrator/app-icon";
import { visitsWithin } from "@/client/components/orchestrator/app-visits";
import { useOrchestrator } from "@/client/components/orchestrator/context";
import { GlyphButton } from "@/client/components/orchestrator/glyph-button";
import { useOnScreen } from "@/client/components/orchestrator/on-screen";
import { PageSection } from "@/client/components/orchestrator/page-section";
import { VisitedPageRows } from "@/client/components/orchestrator/visited-page-rows";
import { Skeleton } from "@/client/components/ui/skeleton";
import { useOpenGestures } from "@/client/hooks/use-open-target";
import { cn } from "@/client/lib/utils";
import { appMentionToken } from "@/client/lib/app-mention";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CaretUpIcon } from "@phosphor-icons/react/CaretUp";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { useState } from "react";

type App = RPCOutput["apps"]["list"]["apps"][number];
type CatalogEntry = RPCOutput["apps"]["catalog"][number];

/**
 * How many pages visited across the apps the page lists: enough to find the
 * one from this morning, few enough that the apps stay the head of the page.
 */
const RECENT_SHOWN = 8;

/** How many of the directory's services are offered before the rest are behind the head's button. */
const MORE_SHOWN = 12;

/**
 * The services offered first among the directory's, since the directory is
 * alphabetical and its first dozen say nothing about what connecting is for:
 * the ones most people already use, in the order they are most likely to.
 */
const FEATURED = [
  "notion",
  "linear",
  "slack",
  "github",
  "figma",
  "google-workspace",
  "todoist",
  "asana",
  "dropbox",
  "spotify",
  "zoom",
  "stripe",
];

/**
 * The Apps place's new tab: the apps this workspace reaches as marks, the
 * pages you were on lately across all of them, and the services still to
 * connect. Pressing an app shows its own front; pressing a page opens it in
 * this tab. Nothing here is written by the agent: the marks are the apps
 * and Recent is the window's own browsing, so the place is already yours the
 * first time you open it.
 */
export const Route = createFileRoute("/orchestrator/apps/")({
  component: AppsRoute,
});

/**
 * One of the workspace's apps as a mark: its icon on a card with its name
 * under it, and under that, for one not yet connected, what it waits for.
 * The mark is the only control it needs, since pressing one can mean
 * nothing but open it.
 */
function AppMark({ app, onOpen }: { app: App; onOpen: () => void }) {
  const href = `/orchestrator/apps/${app.slug}`;
  const { onAuxClick, onContextMenu } = useOpenGestures({
    href,
    kind: "screen",
  });
  const waiting = app.standing === "connected" ? undefined : waitingLine(app);
  return (
    <button
      className="group flex w-24 flex-col items-center gap-1.5 rounded-xl py-2 text-center"
      onAuxClick={onAuxClick}
      onClick={onOpen}
      onContextMenu={onContextMenu}
      title={waiting ? `${app.name}: ${waiting}` : app.name}
      type="button"
    >
      <AppIcon
        className={cn(
          "transition-shadow group-hover:shadow-md",
          waiting && "opacity-60",
        )}
        name={app.name}
        site={app.site}
        size="xl"
      />
      <span className="w-full truncate text-[13px] leading-4 font-medium">
        {app.name}
      </span>
      {waiting ? (
        <span className="-mt-1 w-full truncate text-[11px] leading-4 text-muted-foreground">
          {waiting}
        </span>
      ) : null}
    </button>
  );
}

function AppsRoute() {
  useOnScreen({ screen: "apps" });
  const { ask, openPage } = useOrchestrator();
  const navigate = useNavigate();
  const list = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const catalog = useQuery(rpcClient.apps.catalog.queryOptions());
  const visited = useAtomValue(visitedPagesAtom);
  const [other, setOther] = useState("");
  const [showsAll, setShowsAll] = useState(false);

  const apps = list.data?.apps ?? [];
  // Connected first, since theirs are the fronts worth opening; the ones
  // still being set up follow, each saying what it waits for.
  const own = [
    ...apps.filter((app) => app.standing === "connected"),
    ...apps.filter((app) => app.standing !== "connected"),
  ];
  const known = new Set(apps.map((app) => app.slug));
  const more = featuredFirst(
    (catalog.data ?? []).filter((entry) => !known.has(entry.slug)),
  );
  // Across every app the page knows: the workspace's own first, so a page
  // on one of them is filed under it, then the directory's, since a site
  // opened from its front is an app here whether or not it is connected.
  const visits = visitsWithin(visited, [
    ...apps,
    ...more.map((entry) => ({
      name: entry.name,
      site: `https://${entry.domain}`,
    })),
  ]).slice(0, RECENT_SHOWN);
  const openApp = (slug: string) => {
    void navigate({ params: { slug }, to: "/orchestrator/apps/$slug" });
  };

  return (
    <div className="@container/apps flex h-full min-h-0 flex-col overflow-y-auto px-8 pt-7 pb-10">
      <div className="mx-auto w-full max-w-3xl space-y-8">
        {list.data === undefined ? (
          <PageSection title="Your apps">
            <MarkSkeletons />
          </PageSection>
        ) : own.length > 0 ? (
          <PageSection title="Your apps">
            <div className="flex flex-wrap gap-x-2 gap-y-4">
              {own.map((app) => (
                <AppMark
                  app={app}
                  key={app.slug}
                  onOpen={() => {
                    openApp(app.slug);
                  }}
                />
              ))}
            </div>
          </PageSection>
        ) : null}

        {visits.length > 0 ? (
          <PageSection title="Recent">
            <VisitedPageRows onOpen={openPage} visits={visits} />
          </PageSection>
        ) : null}

        {/* The services still to connect: a dozen most people know, the
            rest behind the head's button, and at the end a row for one
            nobody listed. Every Connect is a message to the conversation,
            since Instrument does the connecting. */}
        <PageSection
          {...(more.length > MORE_SHOWN
            ? {
                action: showsAll
                  ? {
                      icon: <CaretUpIcon className="size-4" />,
                      label: "Fewer",
                      onOpen: () => {
                        setShowsAll(false);
                      },
                    }
                  : {
                      icon: <CaretDownIcon className="size-4" />,
                      label: `All ${more.length}`,
                      onOpen: () => {
                        setShowsAll(true);
                      },
                    },
              }
            : {})}
          title={own.length > 0 ? "More apps" : "Connect an app"}
        >
          {catalog.data === undefined ? (
            <TileSkeletons />
          ) : (
            <div className="grid grid-cols-1 gap-3 @lg/apps:grid-cols-2">
              {(showsAll ? more : more.slice(0, MORE_SHOWN)).map((entry) => (
                <CatalogTile
                  entry={entry}
                  key={entry.slug}
                  onConnect={() => {
                    ask(`Connect ${appMentionToken(entry)}`);
                  }}
                  onOpen={() => {
                    openApp(entry.slug);
                  }}
                />
              ))}
            </div>
          )}
          <form
            className="mt-3 flex items-center gap-3 rounded-2xl border border-border bg-card px-3 py-2 shadow-xs"
            onSubmit={(event) => {
              event.preventDefault();
              const name = other.trim();
              if (!name) {
                return;
              }
              ask(`Connect ${name}`);
              setOther("");
            }}
          >
            <AppIcon />
            <input
              aria-label="Something else"
              className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-foreground/30"
              onChange={(event) => {
                setOther(event.target.value);
              }}
              placeholder="Another service, API, or name"
              value={other}
            />
            <GlyphButton disabled={other.trim() === ""} size="sm" type="submit">
              Connect
            </GlyphButton>
          </form>
        </PageSection>

        {list.data && list.data.invalid.length > 0 ? (
          <PageSection title="Broken">
            <div className="divide-y divide-border rounded-2xl border border-border bg-card shadow-xs">
              {list.data.invalid.map((entry) => (
                <div
                  className="flex items-center gap-3 px-3 py-2"
                  key={entry.slug}
                >
                  <AppIcon />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {entry.slug}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {entry.message}
                    </span>
                  </span>
                  <GlyphButton
                    onClick={() => {
                      ask(`Fix the ${entry.slug} app; its manifest is broken`);
                    }}
                    size="sm"
                  >
                    Fix
                  </GlyphButton>
                </div>
              ))}
            </div>
          </PageSection>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A service the directory knows, still to connect: its icon, its name and
 * tagline, and the one control that starts connecting it. The tile itself
 * opens the service's page, which says what connecting takes.
 */
function CatalogTile({
  entry,
  onConnect,
  onOpen,
}: {
  entry: CatalogEntry;
  onConnect: () => void;
  onOpen: () => void;
}) {
  const href = `/orchestrator/apps/${entry.slug}`;
  const { onAuxClick, onContextMenu } = useOpenGestures({
    href,
    kind: "screen",
  });
  return (
    <div className="flex h-16 items-center gap-3 rounded-2xl border border-border bg-card pr-2 pl-3 shadow-xs">
      <button
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        onAuxClick={onAuxClick}
        onClick={onOpen}
        onContextMenu={onContextMenu}
        type="button"
      >
        <AppIcon name={entry.name} site={`https://${entry.domain}`} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium">
            {entry.name}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {entry.tagline}
          </span>
        </span>
      </button>
      <GlyphButton onClick={onConnect} size="sm">
        Connect
      </GlyphButton>
    </div>
  );
}

/** The directory with the services most people know brought to the front, the rest in its own order. */
function featuredFirst(entries: CatalogEntry[]): CatalogEntry[] {
  const bySlug = new Map(entries.map((entry) => [entry.slug, entry]));
  const front = FEATURED.flatMap((slug) => {
    const entry = bySlug.get(slug);
    return entry ? [entry] : [];
  });
  const featured = new Set(front.map((entry) => entry.slug));
  return [...front, ...entries.filter((entry) => !featured.has(entry.slug))];
}

/** Marks holding the section's place while the apps are still on their way. */
function MarkSkeletons() {
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-4">
      {Array.from({ length: 4 }, (_, index) => (
        <div
          className="flex w-24 flex-col items-center gap-1.5 py-2"
          key={index}
        >
          <Skeleton className="size-16 rounded-2xl" />
          <Skeleton className="h-3 w-12" />
        </div>
      ))}
    </div>
  );
}

/** Tiles holding the directory's place while it is still on its way. */
function TileSkeletons() {
  return (
    <div className="grid grid-cols-1 gap-3 @lg/apps:grid-cols-2">
      {Array.from({ length: MORE_SHOWN }, (_, index) => (
        <div
          className="flex h-16 items-center gap-3 rounded-2xl border border-border bg-card px-3 shadow-xs"
          key={index}
        >
          <Skeleton className="size-9 rounded-lg" />
          <span className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** What an app not yet connected is waiting for, in a few words under its name. */
function waitingLine(app: App): string {
  switch (app.standing) {
    case "declined": {
      return "Not connected";
    }
    case "failed": {
      // The service's own words are three lines of SDK talk and belong on
      // the app's page, where there is room to read them and something to
      // press. A mark says which app is the problem; that is the whole of
      // its job.
      return "Could not connect";
    }
    case "needs-approval": {
      return "Needs your go-ahead";
    }
    case "needs-key": {
      return "Needs a key";
    }
    case "needs-sign-in": {
      return "Needs a sign-in";
    }
    case "stale": {
      return "Changed since tested";
    }
    default: {
      return "Not tested yet";
    }
  }
}
