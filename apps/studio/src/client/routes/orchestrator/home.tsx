import {
  type FileTab,
  pinsAtom,
  selectedChannelAtom,
} from "@/client/atoms/orchestrator";
import { FileSystemFolderGlyph } from "@/client/components/extend/file-system";
import { FileIcon } from "@/client/components/file-icon";
import { AppIcon } from "@/client/components/orchestrator/app-icon";
import { useAppsBySlug } from "@/client/components/orchestrator/apps-by-slug";
import { computerName } from "@/client/components/orchestrator/computer-name";
import { RECENTS_ROOT } from "@/client/components/orchestrator/computer-page";
import { useOrchestrator } from "@/client/components/orchestrator/context";
import { useOpenFileTab } from "@/client/components/orchestrator/file-tabs";
import {
  folderOf,
  homeRelative,
} from "@/client/components/orchestrator/host-path";
import { useOnScreen } from "@/client/components/orchestrator/on-screen";
import { useQuickLook } from "@/client/components/orchestrator/quick-look";
import { SiteIcon } from "@/client/components/orchestrator/sidebar";
import { ScreenIcon } from "@/client/components/orchestrator/window-tab-strip";
import { RelativeTime } from "@/client/components/relative-time";
import { InstrumentGlyph } from "@/client/components/wordmark";
import { cn } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { LaptopIcon } from "@phosphor-icons/react/Laptop";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import ms from "ms";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * A new tab: the apps this workspace reaches, the places the user kept, the
 * computer and the folders a person keeps things in, each a door, and under
 * them the files the conversation has shown, as a list to open one from.
 * Whatever is picked, this tab becomes it.
 */
export const Route = createFileRoute("/orchestrator/home")({
  component: HomeRoute,
});

type RecentFile = RPCOutput["workspace"]["computer"]["recents"][number];

/**
 * How many apps and how many bookmarks the page shows before the rest are
 * behind the tile at the end of the row. Both rows are one line and never two:
 * the rows under them should stay in view in a small window, and a row that
 * wraps is the one thing on this page that can grow without being asked.
 */
const APPS_SHOWN = 8;
const PINS_SHOWN = 8;

/**
 * How many of the files the conversation showed the list carries before the
 * rest are behind a row at its foot. Enough to find the one from this morning,
 * few enough that the page is a page and not the Recents place itself.
 */
const RECENTS_SHOWN = 8;

/**
 * What names a row of things. As small as a label can be and still be read,
 * on the same left edge as the marks under it.
 */
const SECTION_LABEL =
  "mb-1.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase";

/**
 * A row of doors: the marks a fixed pitch apart, the row's left edge the
 * label's, and a little room at each end for a hover to bleed past a mark.
 */
const DOOR_ROW = "-m-1 flex flex-nowrap gap-3 overflow-hidden p-1";

/** A mark drawn on a card, for a door whose thing has no icon of its own. */
const MARK_CARD =
  "grid size-12 shrink-0 place-items-center rounded-xl border border-border bg-card shadow-sm";

/**
 * How often the list of shown files is re-read. Slower than a folder's clock:
 * it can only change when the conversation says something new, and this page
 * can sit open all day beside the work.
 */
const RECENTS_REFRESH_MS = ms("30 seconds");

/**
 * One tile of a row: a mark with its name under it, both on the tile's left
 * edge so a row of them lines up with the label above. The hover is drawn
 * close around the mark, since the mark is the thing being pressed; the name
 * is one line, cut where the tile ends.
 */
function Door({
  icon,
  name,
  onOpen,
}: {
  icon: ReactNode;
  name: string;
  onOpen: () => void;
}) {
  return (
    <button
      className="group flex w-18 shrink-0 flex-col items-start gap-1.5 text-left"
      onClick={onOpen}
      type="button"
    >
      <span className="-m-1 rounded-xl p-1 group-hover:bg-foreground/8 group-focus-visible:bg-foreground/8">
        {icon}
      </span>
      <span className="w-full truncate text-xs leading-tight text-foreground/80 group-hover:text-foreground">
        {name}
      </span>
    </button>
  );
}

/** The tab a shown file opens in, when a granted folder covers it. */
function fileTabOf(file: RecentFile): FileTab | undefined {
  return file.access
    ? { hostPath: file.path, mount: file.access.mountPath, name: file.name }
    : undefined;
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
  const selectedChannel = useAtomValue(selectedChannelAtom);
  const pins = useAtomValue(pinsAtom);
  useOnScreen({ screen: "home" });

  const channels = useQuery(
    rpcClient.workspace.orchestrator.channels.list.queryOptions({
      input: { id: taskId },
    }),
  );
  // Work spans every channel, so the way into it belongs in the one channel
  // that is about the app itself rather than repeated at the foot of every
  // new tab, where it sat beside the user's own things and read as one.
  const isHomeChannel =
    channels.data?.[0]?.id !== undefined &&
    channels.data[0].id === selectedChannel;
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
  // The home folder is where the computer itself opens, so it is not a door
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
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-8 pt-5 pb-8">
      {/* The services the workspace reaches: marks with names, small enough
          that the row reads as a strip of faces rather than as cards. One line
          and never two, since a page that grows a row per handful of apps
          pushes everything under the fold; the rest are behind the tile at the
          end, which is also where a new one is added. An app still being
          connected is drawn faint, since it is not yet a way in to anything. */}
      <section className="mx-auto mt-5 w-full max-w-5xl">
        <p className={SECTION_LABEL}>Apps</p>
        <div className={DOOR_ROW}>
          {(appList.data?.apps ?? []).slice(0, APPS_SHOWN).map((app) => (
            <Door
              icon={
                <AppIcon
                  className={
                    app.standing === "connected" ? undefined : "opacity-50"
                  }
                  site={app.site}
                  size="lg"
                />
              }
              key={app.slug}
              name={app.name}
              onOpen={() => {
                void navigate({
                  params: { slug: app.slug },
                  to: "/orchestrator/apps/$slug",
                });
              }}
            />
          ))}
          <Door
            icon={
              <span className="grid size-12 shrink-0 place-items-center rounded-xl border border-dashed border-border text-muted-foreground">
                <PlusIcon className="size-5" />
              </span>
            }
            name="All apps"
            onOpen={() => {
              void navigate({ to: "/orchestrator/apps" });
            }}
          />
        </div>
      </section>

      {/* The places the user kept, which is what a bookmark is: their own
          choice, before anything the app has to offer. Drawn as the apps above
          are, since they are the same gesture and reading as two kinds of
          thing would be the only difference between them. */}
      <section className="mx-auto mt-3 w-full max-w-5xl">
        <p className={SECTION_LABEL}>Bookmarks</p>
        {pins.length === 0 && !isHomeChannel ? (
          <p className="text-xs text-muted-foreground">
            Right-click a tab to pin it here.
          </p>
        ) : (
          <div className={DOOR_ROW}>
            {/* The app's own room keeps one bookmark it did not have to be
                given: the work, which spans every channel and so belongs to
                the channel that is about the app rather than to a tab. */}
            {isHomeChannel && (
              <Door
                icon={
                  <span className={MARK_CARD}>
                    <InstrumentGlyph className="size-6 text-brand-600" />
                  </span>
                }
                name="Tasks"
                onOpen={() => {
                  void navigate({ to: "/orchestrator/tasks" });
                }}
              />
            )}
            {pins.slice(0, PINS_SHOWN).map((pin) => (
              <Door
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
              />
            ))}
          </div>
        )}
      </section>

      {/* The computer, and the folders a person keeps things in. The computer
          is the door that opens on everything, the Finder whole in this tab;
          the folders beside it are the same door already stood in the right
          place, since a folder is where most trips into the computer end. */}
      <section className="mx-auto mt-3 w-full max-w-5xl">
        <p className={SECTION_LABEL}>Places</p>
        <div className={DOOR_ROW}>
          <Door
            icon={
              <span className={MARK_CARD}>
                <LaptopIcon className="size-6" />
              </span>
            }
            name={computerName()}
            onOpen={() => {
              openFolder("~");
            }}
          />
          {folders.map((place) => (
            <Door
              icon={
                <span className="grid size-12 shrink-0 place-items-center">
                  <FileSystemFolderGlyph className="h-9 w-auto" />
                </span>
              }
              key={place.path}
              name={place.name}
              onOpen={() => {
                openFolder(place.path);
              }}
            />
          ))}
        </div>
      </section>

      {/* The files the conversation has put in front of the user, newest
          first: the quickest way back to one, without opening the computer
          to find it. The same list the Recents place in the computer shows,
          which is where the rest of it is. */}
      <section className="mx-auto mt-5 w-full max-w-5xl">
        <p className={SECTION_LABEL}>Recent files</p>
        {recents.data === undefined ? null : recents.data.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Files Instrument shows you in the conversation will appear here.
          </p>
        ) : (
          <RecentFiles
            files={recents.data.slice(0, RECENTS_SHOWN)}
            homePath={homePath}
            onOpen={(file) => {
              const tab = fileTabOf(file);
              if (tab) {
                openFileTab(tab);
                return;
              }
              // Out of the agent's reach, so the viewer cannot show it; the
              // Mac's own app for it can.
              rpcClient.utils.openPath
                .call({ filepath: file.path })
                .catch((error: unknown) => {
                  toast.error("Could not open the file", {
                    description:
                      error instanceof Error ? error.message : String(error),
                  });
                });
            }}
            {...(recents.data.length > RECENTS_SHOWN
              ? {
                  onOpenAll: () => {
                    openFolder(RECENTS_ROOT);
                  },
                  total: recents.data.length,
                }
              : {})}
            {...quickLook.props}
          />
        )}
      </section>

      {quickLook.dialog}
    </div>
  );
}

/**
 * The shown files as a column: each its type's mark, its name, the folder it
 * lives in and when it was shown. A row opens the file; the arrows walk the
 * rows and Space shows the one they are on over the whole window, the way the
 * Finder's Quick Look does, following the arrows while it is up.
 */
function RecentFiles({
  files,
  homePath,
  onOpen,
  onOpenAll,
  onQuickLook,
  onQuickLookFollow,
  quickLookOpen,
  total,
}: {
  files: RecentFile[];
  homePath: string | undefined;
  onOpen: (file: RecentFile) => void;
  /** The way to the whole list, when this shows only the start of it. */
  onOpenAll?: () => void;
  onQuickLook: (tab: FileTab) => void;
  onQuickLookFollow: (tab: FileTab) => void;
  quickLookOpen: boolean;
  total?: number;
}) {
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
      const tab = file && fileTabOf(file);
      if (tab) {
        onQuickLookFollow(tab);
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
      // No wider than the rows of tiles above: a list edge to edge read as
      // the widest thing on the page.
      className="max-w-3xl divide-y divide-border overflow-hidden rounded-xl border border-border bg-card"
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
            const tab = file && fileTabOf(file);
            if (tab) {
              event.preventDefault();
              onQuickLook(tab);
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
      {files.map((file, index) => (
        <li aria-selected={index === selected} key={file.path} role="option">
          <button
            className={cn(
              "flex w-full items-center gap-3 px-3 py-2 text-left text-sm outline-none hover:bg-accent/40",
              index === selected && "bg-accent/60",
            )}
            data-index={index}
            onClick={() => {
              onOpen(file);
            }}
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
            <FileIcon
              className="size-5 shrink-0"
              filename={file.name}
              mimeType={file.mimeType}
            />
            <span className="min-w-0 flex-1 truncate">{file.name}</span>
            {/* Where it lives, the home folder as `~`: the one thing about a
                file its name does not say. */}
            <span className="max-w-2/5 min-w-0 truncate text-xs text-muted-foreground">
              {homeRelative(folderOf(file.path), homePath)}
            </span>
            <RelativeTime
              className="w-14 shrink-0 text-right text-xs text-muted-foreground"
              compact
              date={new Date(file.shownAt)}
              tooltip={false}
            />
          </button>
        </li>
      ))}
      {onOpenAll ? (
        <li>
          <button
            className="flex w-full items-center gap-3 px-3 py-2 text-left text-xs text-muted-foreground hover:bg-accent/40 hover:text-foreground"
            onClick={onOpenAll}
            type="button"
          >
            <span className="size-5 shrink-0" />
            <span className="min-w-0 flex-1">All {total} recent files</span>
            <CaretRightIcon className="size-3.5 shrink-0" />
          </button>
        </li>
      ) : null}
    </ul>
  );
}
