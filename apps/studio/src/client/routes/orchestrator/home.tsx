import { type FileTab, pinsAtom } from "@/client/atoms/orchestrator";
import { FileSystemFolderGlyph } from "@/client/components/extend/file-system";
import { FileIcon } from "@/client/components/file-icon";
import { AppIcon } from "@/client/components/orchestrator/app-icon";
import { useAppsBySlug } from "@/client/components/orchestrator/apps-by-slug";
import { computerName } from "@/client/components/orchestrator/computer-name";
import { RECENTS_ROOT } from "@/client/components/orchestrator/computer-page";
import { useOrchestrator } from "@/client/components/orchestrator/context";
import {
  fileHref,
  folderHref,
  useOpenFileTab,
} from "@/client/components/orchestrator/file-tabs";
import {
  folderOf,
  homeRelative,
} from "@/client/components/orchestrator/host-path";
import { useOnScreen } from "@/client/components/orchestrator/on-screen";
import { useQuickLook } from "@/client/components/orchestrator/quick-look";
import { SiteIcon } from "@/client/components/orchestrator/sidebar";
import { SKILLS_HREF } from "@/client/components/orchestrator/tab-location";
import { ScreenIcon } from "@/client/components/orchestrator/window-tab-strip";
import { RelativeTime } from "@/client/components/relative-time";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  useGesturesFor,
  useOpenGestures,
} from "@/client/hooks/use-open-target";
import { type OpenTarget } from "@/client/lib/open-target";
import { cn } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/ClockCounterClockwise";
import { GraduationCapIcon } from "@phosphor-icons/react/GraduationCap";
import { LaptopIcon } from "@phosphor-icons/react/Laptop";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import ms from "ms";
import { type ReactNode, useEffect, useRef, useState } from "react";

/**
 * A new tab: the places the user kept, the apps this workspace reaches, the
 * computer and the folders a person keeps things in, the kinds of page
 * Instrument can make, and under them the files the conversation has shown.
 * Each section is a head with a way to the rest of it and a grid of tiles,
 * one gesture for everything on the page; whatever is picked, this tab
 * becomes it. Tasks are reached from the thread that started them.
 */
export const Route = createFileRoute("/orchestrator/home")({
  component: HomeRoute,
});

type RecentFile = RPCOutput["workspace"]["computer"]["recents"][number];

/**
 * How many of each a section shows before the rest are behind the button in
 * its head. Enough to find the one from this morning, few enough that the
 * page stays a page: every section can grow, and only the head's button does.
 */
const PINS_SHOWN = 6;
const APPS_SHOWN = 6;
const PLACES_SHOWN = 6;
const RECENTS_SHOWN = 5;

/**
 * How often the list of shown files is re-read. Slower than a folder's clock:
 * it can only change when the conversation says something new, and this page
 * can sit open all day beside the work.
 */
const RECENTS_REFRESH_MS = ms("30 seconds");

/** A tile's mark when the thing has no icon of its own: a card with a glyph on it. */
const MARK_CARD =
  "grid size-11 shrink-0 place-items-center rounded-xl border border-border bg-background";

/** The tab a shown file opens in: the file by where it is on the computer. */
function fileTabOf(file: RecentFile): FileTab {
  return { hostPath: file.path, name: file.name };
}

/** Puts the keyboard on one row of the list, by place. */
function focusRow(list: HTMLElement, index: number) {
  list
    .querySelector<HTMLElement>(`[data-index="${index}"]`)
    ?.focus({ preventScroll: true });
}

function HomeRoute() {
  const { openPage, openScreen, taskId } = useOrchestrator();
  const navigate = useNavigate();
  const openFileTab = useOpenFileTab();
  const quickLook = useQuickLook({ openFile: openFileTab });
  const pins = useAtomValue(pinsAtom);
  useOnScreen({ screen: "home" });

  const appList = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const appsBySlug = useAppsBySlug();
  const places = useQuery(rpcClient.workspace.computer.places.queryOptions());
  const recents = useQuery(
    rpcClient.workspace.computer.recents.queryOptions({
      input: { id: taskId },
      refetchInterval: RECENTS_REFRESH_MS,
    }),
  );
  const homePath = places.data?.favorites.find(
    (place) => place.name === "Home",
  )?.path;
  // The home folder is where the computer itself opens, so it is not a tile
  // of its own beside the one that is the computer.
  const folders = (places.data?.favorites ?? []).filter(
    (place) => place.path !== homePath,
  );

  /** This tab becomes the computer, opened on a folder. */
  const openFolder = (root: string) => {
    void navigate({
      search: { path: "", root },
      to: "/orchestrator/computer",
    });
  };

  return (
    <div className="@container/home flex h-full min-h-0 flex-col overflow-y-auto px-8 pt-7 pb-10">
      <div className="mx-auto w-full max-w-3xl space-y-8">
        {/* The places the user kept, which is what a bookmark is: their own
            choice, before anything the app has to offer. */}
        <Section title="Bookmarks">
          {pins.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Right-click a tab to pin it here.
            </p>
          ) : (
            <Tiles>
              {pins.slice(0, PINS_SHOWN).map((pin) => (
                <Tile
                  icon={
                    <span
                      className={cn(MARK_CARD, "[&_img]:size-6 [&_svg]:size-6")}
                    >
                      {pin.kind === "page" ? (
                        <SiteIcon favicon={pin.favicon} url={pin.target} />
                      ) : (
                        <ScreenIcon appsBySlug={appsBySlug} href={pin.target} />
                      )}
                    </span>
                  }
                  key={pin.id}
                  name={pin.title}
                  onOpen={() => {
                    if (pin.kind === "page") {
                      openPage(pin.target);
                    } else {
                      openScreen(pin.target);
                    }
                  }}
                  target={
                    pin.kind === "page"
                      ? { kind: "page", url: pin.target }
                      : { href: pin.target, kind: "screen" }
                  }
                />
              ))}
            </Tiles>
          )}
        </Section>

        {/* The services the workspace reaches, each a tile; the rest, and
            connecting a new one, are behind the head's button. */}
        <Section
          action={{
            icon: <AppWindowIcon className="size-4" />,
            label: "All apps",
            onOpen: () => {
              void navigate({ to: "/orchestrator/apps" });
            },
          }}
          title="Apps"
        >
          {appList.data === undefined ? (
            <TileSkeletons count={APPS_SHOWN} />
          ) : appList.data.apps.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Connect a service and it becomes a place here.
            </p>
          ) : (
            <Tiles>
              {appList.data.apps.slice(0, APPS_SHOWN).map((app) => (
                <Tile
                  icon={<AppIcon name={app.name} site={app.site} size="lg" />}
                  key={app.slug}
                  name={app.name}
                  onOpen={() => {
                    void navigate({
                      params: { slug: app.slug },
                      to: "/orchestrator/apps/$slug",
                    });
                  }}
                  target={{
                    href: `/orchestrator/apps/${app.slug}`,
                    kind: "screen",
                  }}
                />
              ))}
            </Tiles>
          )}
        </Section>

        {/* The computer, and the folders a person keeps things in. The
            computer is the door that opens on everything, the Finder whole
            in this tab; the folders beside it are the same door already
            stood in the right place, since a folder is where most trips into
            the computer end. */}
        <Section
          action={{
            icon: <LaptopIcon className="size-4" />,
            label: "Browse",
            onOpen: () => {
              openFolder("~");
            },
          }}
          title={computerName()}
        >
          {places.data === undefined ? (
            <TileSkeletons count={PLACES_SHOWN} />
          ) : (
            <Tiles>
              {folders.slice(0, PLACES_SHOWN).map((place) => (
                <Tile
                  icon={<FileSystemFolderGlyph className="h-9 w-auto" />}
                  key={place.path}
                  name={place.name}
                  onOpen={() => {
                    openFolder(place.path);
                  }}
                  target={{ href: folderHref(place.path), kind: "screen" }}
                />
              ))}
            </Tiles>
          )}
        </Section>

        {/* The files the conversation has put in front of the user, newest
            first: the quickest way back to one, without opening the computer
            to find it. The same list the Recents place in the computer shows,
            which is where the rest of it is. */}
        <Section
          {...(recents.data && recents.data.length > RECENTS_SHOWN
            ? {
                action: {
                  icon: <ClockCounterClockwiseIcon className="size-4" />,
                  label: `All ${recents.data.length}`,
                  onOpen: () => {
                    openFolder(RECENTS_ROOT);
                  },
                },
              }
            : {})}
          title="Recent files"
        >
          {recents.data === undefined ? (
            <RowSkeletons />
          ) : recents.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Files Instrument shows you in the conversation will appear here.
            </p>
          ) : (
            <RecentFiles
              files={recents.data.slice(0, RECENTS_SHOWN)}
              homePath={homePath}
              onOpen={(file) => {
                openFileTab(fileTabOf(file));
              }}
              {...quickLook.props}
            />
          )}
        </Section>

        {/* What Instrument brings to every thread: the skills its tasks can
            load, and where each comes from. Last, since it is the least of
            what the page offers. */}
        <Section title="Instrument">
          <Tiles>
            <Tile
              icon={
                <span className={MARK_CARD}>
                  <GraduationCapIcon className="size-6" />
                </span>
              }
              name="Skills"
              onOpen={() => {
                void navigate({ to: SKILLS_HREF });
              }}
              target={{ href: SKILLS_HREF, kind: "screen" }}
            />
          </Tiles>
        </Section>
      </div>

      {quickLook.dialog}
    </div>
  );
}

/**
 * The shown files as rows: each its type's mark, its name with where it
 * lives under it, and when it was shown. A row opens the file; the arrows
 * walk the rows and Space shows the one they are on over the whole window,
 * the way the Finder's Quick Look does, following the arrows while it is up.
 */
function RecentFiles({
  files,
  homePath,
  onOpen,
  onQuickLook,
  onQuickLookFollow,
  quickLookOpen,
}: {
  files: RecentFile[];
  homePath: string | undefined;
  onOpen: (file: RecentFile) => void;
  onQuickLook: (tab: FileTab) => void;
  onQuickLookFollow: (tab: FileTab) => void;
  quickLookOpen: boolean;
}) {
  // Read once for the whole list; each row asks it about its own file.
  const gesturesFor = useGesturesFor();
  // The row the keyboard is on, by place; nothing until a row takes it.
  const [selected, setSelected] = useState<null | number>(null);
  // Where the keyboard lands when the panel hands it back: the row the arrows
  // reached while it was up, rather than the row it opened from, which is
  // where the panel puts it on its own. Read by whichever row gets it.
  const landOn = useRef<null | number>(null);
  const wasOpen = useRef(quickLookOpen);
  useEffect(() => {
    if (wasOpen.current && !quickLookOpen) {
      landOn.current = selected;
    }
    wasOpen.current = quickLookOpen;
  }, [quickLookOpen, selected]);
  const step = (direction: -1 | 1) =>
    Math.max(0, Math.min(files.length - 1, (selected ?? -1) + direction));

  // Quick Look holds the keyboard while it is up, so the arrows are caught on
  // the way down and moved along the rows here; the panel follows.
  useEffect(() => {
    if (!quickLookOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const next = step(event.key === "ArrowDown" ? 1 : -1);
      setSelected(next);
      const file = files[next];
      if (file) {
        onQuickLookFollow(fileTabOf(file));
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
    // `step` and `files` are read afresh each time the selection moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickLookOpen, selected, files, onQuickLookFollow]);

  return (
    <ul
      aria-label="Recent files"
      className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-xs"
      onBlur={(event) => {
        // The keyboard leaving the list takes the highlight with it, unless it
        // left for the panel, which is still showing the row it is on.
        if (
          !quickLookOpen &&
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          setSelected(null);
        }
      }}
      onKeyDown={(event) => {
        switch (event.key) {
          case " ": {
            const file = selected === null ? undefined : files[selected];
            if (file) {
              event.preventDefault();
              onQuickLook(fileTabOf(file));
            }
            break;
          }
          case "ArrowDown":
          case "ArrowUp": {
            event.preventDefault();
            focusRow(
              event.currentTarget,
              step(event.key === "ArrowDown" ? 1 : -1),
            );
            break;
          }
          // No default
        }
      }}
      // A press on a row is the row chosen, whatever the panel left pending.
      onPointerDownCapture={() => {
        landOn.current = null;
      }}
      role="listbox"
    >
      {files.map((file, index) => {
        // Every file has a tab it opens in, and so has the gestures that ask
        // for one there or in a tab of its own.
        const gestures = gesturesFor({
          href: fileHref(fileTabOf(file).hostPath),
          kind: "screen",
        });
        return (
          <li aria-selected={index === selected} key={file.path} role="option">
            <button
              className={cn(
                "flex w-full items-center gap-3 px-3 py-2.5 text-left outline-none hover:bg-accent/40",
                index === selected && "bg-accent/60",
              )}
              data-index={index}
              onAuxClick={gestures.onAuxClick}
              onClick={() => {
                onOpen(file);
              }}
              onContextMenu={gestures.onContextMenu}
              onFocus={(event) => {
                const target = landOn.current;
                landOn.current = null;
                if (target !== null && target !== index) {
                  const list = event.currentTarget.closest("ul");
                  if (list) {
                    focusRow(list, target);
                    return;
                  }
                }
                setSelected(index);
              }}
              // One stop for the whole list: Tab lands on the row the keyboard
              // was on, or the first, and the arrows do the rest.
              tabIndex={(selected ?? 0) === index ? 0 : -1}
              type="button"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted">
                <FileIcon
                  className="size-6"
                  filename={file.name}
                  mimeType={file.mimeType}
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">
                  {file.name}
                </span>
                {/* Where it lives, the home folder as `~`: the one thing about
                  a file its name does not say. */}
                <span className="block truncate text-xs text-muted-foreground">
                  {homeRelative(folderOf(file.path), homePath)}
                </span>
              </span>
              <RelativeTime
                className="shrink-0 text-xs text-muted-foreground"
                compact
                date={new Date(file.shownAt)}
                tooltip={false}
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The recent files' place, as rows, until the list is in. */
function RowSkeletons() {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
      {Array.from({ length: RECENTS_SHOWN }, (_, index) => (
        <div className="flex items-center gap-3 px-3 py-2.5" key={index}>
          <Skeleton className="size-10 rounded-lg" />
          <span className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </span>
          <Skeleton className="h-3 w-10" />
        </div>
      ))}
    </div>
  );
}

/**
 * A section: what it is called, in the quiet weight the page reads its heads
 * in, and beside it the one way to the rest of what it holds.
 */
function Section({
  action,
  children,
  title,
}: {
  action?: { icon: ReactNode; label: string; onOpen: () => void };
  children: ReactNode;
  title: string;
}) {
  return (
    <section>
      <div className="flex h-8 items-center justify-between">
        <h2 className="text-lg font-medium text-muted-foreground">{title}</h2>
        {action ? (
          <button
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-sm text-muted-foreground shadow-xs hover:text-foreground"
            onClick={action.onOpen}
            type="button"
          >
            {action.icon}
            {action.label}
          </button>
        ) : null}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * One thing to open: its mark, its name, and nothing else. The whole tile is
 * the button, since the mark is the thing being pressed and the name is what
 * it is called.
 */
function Tile({
  icon,
  line,
  name,
  onOpen,
  target,
  trailing,
}: {
  icon: ReactNode;
  /** A second line under the name, for a thing whose state is worth a glance. */
  line?: ReactNode;
  name: string;
  onOpen: () => void;
  /** What the tile leads to, for the gestures that ask for it somewhere else. */
  target: OpenTarget;
  /** What sits at the tile's far edge: a time, a count. */
  trailing?: ReactNode;
}) {
  const { onAuxClick, onContextMenu } = useOpenGestures(target);
  return (
    <button
      className="flex h-16 w-full min-w-0 items-center gap-3 rounded-2xl border border-border bg-card px-3 text-left shadow-xs transition-shadow hover:shadow-md"
      onAuxClick={onAuxClick}
      onClick={onOpen}
      onContextMenu={onContextMenu}
      type="button"
    >
      <span className="grid size-12 shrink-0 place-items-center">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{name}</span>
        {line}
      </span>
      {trailing}
    </button>
  );
}

/** Tiles in two columns, one per thing, the way every section lays its things out. */
function Tiles({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3 @lg/home:grid-cols-2">
      {children}
    </div>
  );
}

/**
 * Tiles holding the section's place while its things are still on their way,
 * so the page lays out once rather than growing as each section answers. As
 * many as the section shows when it is full, since a page that has been used
 * for a while fills every section.
 */
function TileSkeletons({ count }: { count: number }) {
  return (
    <Tiles>
      {Array.from({ length: count }, (_, index) => (
        <div
          className="flex h-16 items-center gap-3 rounded-2xl border border-border bg-card px-3 shadow-xs"
          key={index}
        >
          <span className="grid size-12 shrink-0 place-items-center">
            <Skeleton className="size-11 rounded-xl" />
          </span>
          <Skeleton className="h-4 w-2/5" />
        </div>
      ))}
    </Tiles>
  );
}
