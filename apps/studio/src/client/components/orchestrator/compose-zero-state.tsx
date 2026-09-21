import {
  pinsAtom,
  type VisitedPage,
  visitedPagesAtom,
} from "@/client/atoms/orchestrator";
import { FileSystemFolderGlyph } from "@/client/components/extend/file-system";
import { FileIcon } from "@/client/components/file-icon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { Skeleton } from "@/client/components/ui/skeleton";
import { resolveUrlOrSearch } from "@/client/lib/resolve-url-or-search";
import { cn } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { type TaskId } from "@instrument-org/workspace/client";
import { type Icon } from "@phosphor-icons/react";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/ClockCounterClockwise";
import { FolderIcon } from "@phosphor-icons/react/Folder";
import { GlobeSimpleIcon } from "@phosphor-icons/react/GlobeSimple";
import { LaptopIcon } from "@phosphor-icons/react/Laptop";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { PaperclipIcon } from "@phosphor-icons/react/Paperclip";
import { SquaresFourIcon } from "@phosphor-icons/react/SquaresFour";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { type ReactNode, useState } from "react";

import { AppIcon } from "./app-icon";
import { computerName } from "./computer-name";
import { SiteIcon } from "./sidebar";

type App = RPCOutput["apps"]["list"]["apps"][number];

/** How many of each a line shows: enough to find this morning's, few enough to stay one line. */
const SITES_SHOWN = 8;
const PLACES_SHOWN = 6;
const FILES_SHOWN = 5;

/**
 * The empty band under a draft's words: four doors stacked down the band,
 * each named over the box that is drawn as the thing it opens, so the
 * browser, the computer and the apps are in sight before anything is
 * gathered. Attach is a drop strip with the two choosers, files and a
 * folder, since a folder is attached on its own terms; Browse an address
 * field over the sites kept and lately seen; This Mac the places and the
 * files lately shown; Apps their icons, each of which names itself in the
 * words rather than opening. Whatever a door opens arrives as a tab in the
 * band, in this tab's place.
 */
export function ComposeZeroState({
  onAttachFiles,
  onAttachFolder,
  onOpenApp,
  onOpenFile,
  onOpenFolder,
  onOpenPage,
  taskId,
}: {
  /** The file chooser, for the Attach door's button. */
  onAttachFiles: () => void;
  /** The folder chooser: a folder the thread may work in, attached rather than opened. */
  onAttachFolder: () => void;
  /** Names the app in the words, as a chip. */
  onOpenApp: (app: App) => void;
  onOpenFile: (hostPath: string) => void;
  onOpenFolder: (hostPath: string) => void;
  onOpenPage: (url: string) => void;
  taskId: TaskId;
}) {
  const pins = useAtomValue(pinsAtom);
  const visited = useAtomValue(visitedPagesAtom);
  const appList = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const places = useQuery(rpcClient.workspace.computer.places.queryOptions());
  const recents = useQuery(
    rpcClient.workspace.computer.recents.queryOptions({
      input: { id: taskId },
    }),
  );
  const [address, setAddress] = useState("");

  // The sites kept first, then the pages lately seen that are not among
  // them, one per site on the line, so the line is the places a person goes
  // back to; the whole list waits behind the clock at the line's end.
  const bookmarks = pins.filter((pin) => pin.kind === "page");
  const seen = visited.filter(
    (page) => !bookmarks.some((pin) => pin.target === page.url),
  );
  const seenOrigins = new Set<string>();
  const seenOnLine = seen
    .filter((page) => {
      const origin = originOf(page.url);
      if (seenOrigins.has(origin)) {
        return false;
      }
      seenOrigins.add(origin);
      return true;
    })
    .slice(0, SITES_SHOWN);
  const homePath = places.data?.favorites.find(
    (place) => place.name === "Home",
  )?.path;
  const folders = (places.data?.favorites ?? [])
    .filter((place) => place.path !== homePath)
    .slice(0, PLACES_SHOWN);
  const apps = appList.data?.apps ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 overflow-y-auto px-4 pt-4 pb-4">
      <Door icon={PaperclipIcon} name="Attach">
        <div className="flex h-12 items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 px-3 text-[12px] text-gray-500 dark:border-gray-600 dark:text-gray-400">
          <span className="min-w-0 truncate">Drop files or folders here</span>
          <Chooser icon={PaperclipIcon} onPick={onAttachFiles}>
            Choose files
          </Chooser>
          <Chooser icon={FolderIcon} onPick={onAttachFolder}>
            Choose a folder
          </Chooser>
        </div>
      </Door>

      <Door icon={GlobeSimpleIcon} name="Browse">
        <Box>
          <form
            className="flex h-11 items-center px-3"
            onSubmit={(event) => {
              event.preventDefault();
              const url = resolveUrlOrSearch(address);
              if (url) {
                onOpenPage(url);
              }
            }}
          >
            <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md bg-muted px-2.5 text-[12px] focus-within:ring-1 focus-within:ring-ring">
              <MagnifyingGlassIcon className="size-3 shrink-0 text-muted-foreground" />
              <input
                aria-label="Address or search"
                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
                onChange={(event) => {
                  setAddress(event.target.value);
                }}
                placeholder="Type an address or search"
                spellCheck={false}
                type="text"
                value={address}
              />
            </label>
          </form>
          {bookmarks.length > 0 && (
            <Line label="Bookmarks">
              {bookmarks.slice(0, SITES_SHOWN).map((pin) => (
                <Mark
                  icon={<SiteIcon favicon={pin.favicon} url={pin.target} />}
                  key={pin.id}
                  name={pin.title}
                  onOpen={() => {
                    onOpenPage(pin.target);
                  }}
                />
              ))}
            </Line>
          )}
          {seen.length > 0 && (
            <Line
              label="Recent"
              trailing={<HistoryPopover onOpenPage={onOpenPage} pages={seen} />}
            >
              {seenOnLine.map((page) => (
                <Mark
                  icon={<SiteIcon favicon={page.favicon} url={page.url} />}
                  key={page.url}
                  name={page.title || hostOf(page.url)}
                  onOpen={() => {
                    onOpenPage(page.url);
                  }}
                  title={`${page.title || page.url}\n${page.url}`}
                />
              ))}
            </Line>
          )}
          {bookmarks.length === 0 && seen.length === 0 && (
            <Line label="Bookmarks">
              <span className="text-[11px] text-muted-foreground">
                Pin a tab, and the site is kept here.
              </span>
            </Line>
          )}
        </Box>
      </Door>

      <Door icon={LaptopIcon} name={computerName()}>
        <Box>
          <Line label="Places">
            {places.data === undefined ? (
              <MarkSkeletons count={4} />
            ) : (
              folders.map((place) => (
                <Mark
                  icon={<FileSystemFolderGlyph className="h-3.5 w-auto" />}
                  key={place.path}
                  name={place.name}
                  onOpen={() => {
                    onOpenFolder(place.path);
                  }}
                />
              ))
            )}
          </Line>
          <Line label="Recent">
            {recents.data === undefined ? (
              <MarkSkeletons count={3} />
            ) : recents.data.length === 0 ? (
              <span className="text-[11px] text-muted-foreground">
                Files Instrument shows you will appear here.
              </span>
            ) : (
              recents.data.slice(0, FILES_SHOWN).map((file) => (
                <Mark
                  icon={
                    <FileIcon
                      className="size-3.5"
                      filename={file.name}
                      mimeType={file.mimeType}
                    />
                  }
                  key={file.path}
                  name={file.name}
                  onOpen={() => {
                    onOpenFile(file.path);
                  }}
                />
              ))
            )}
          </Line>
        </Box>
      </Door>

      <Door icon={SquaresFourIcon} name="Apps">
        {appList.data === undefined ? (
          <div className="flex gap-1">
            {Array.from({ length: 4 }, (_, index) => (
              <div
                className="flex w-16 flex-col items-center gap-1.5"
                key={index}
              >
                <Skeleton className="size-11 rounded-xl" />
                <Skeleton className="h-2.5 w-10" />
              </div>
            ))}
          </div>
        ) : apps.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            Connect a service in Apps, and it is here to name.
          </p>
        ) : (
          <div className="flex flex-wrap gap-x-1 gap-y-3">
            {apps.map((app) => (
              <button
                className="group/app flex w-16 flex-col items-center gap-1.5 rounded-lg py-1 hover:bg-black/4 dark:hover:bg-white/6"
                key={app.slug}
                onClick={() => {
                  onOpenApp(app);
                }}
                title={`Name ${app.name} in your message`}
                type="button"
              >
                <span className="grid size-11 place-items-center overflow-hidden rounded-xl bg-card shadow-xs">
                  <AppIcon
                    className="size-7 rounded-md"
                    name={app.name}
                    site={app.site}
                    size="md"
                  />
                </span>
                <span className="w-full truncate px-0.5 text-center text-[10px] text-gray-700 dark:text-gray-300">
                  {app.name}
                </span>
              </button>
            ))}
          </div>
        )}
      </Door>
    </div>
  );
}

/** A door's white box, its lines divided. */
function Box({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-border rounded-lg bg-card shadow-xs">
      {children}
    </div>
  );
}

/** One of the two choosers on the Attach strip: its own mark, so files and a folder read as the two things they are. */
function Chooser({
  children,
  icon: ChooserIcon,
  onPick,
}: {
  children: ReactNode;
  icon: Icon;
  onPick: () => void;
}) {
  return (
    <button
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-[12px] font-medium text-foreground shadow-xs hover:bg-accent"
      onClick={onPick}
      type="button"
    >
      <ChooserIcon className="size-3.5 text-muted-foreground" />
      {children}
    </button>
  );
}

/** A door: its name over what it opens, a mark and the word, so the band reads top to bottom. */
function Door({
  children,
  icon: DoorIcon,
  name,
}: {
  children: ReactNode;
  icon: Icon;
  name: string;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 px-1 text-[12px] font-medium text-gray-700 dark:text-gray-300">
        <DoorIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{name}</span>
      </h3>
      {children}
    </section>
  );
}

/**
 * Every page lately seen, behind the clock at the Recent line's end, for
 * the ones the line had no room for: each by its title with its site under
 * it, newest first.
 */
function HistoryPopover({
  onOpenPage,
  pages,
}: {
  onOpenPage: (url: string) => void;
  pages: VisitedPage[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          aria-label="All recent pages"
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
          title="All recent pages"
          type="button"
        >
          <ClockCounterClockwiseIcon className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 p-1"
        maxHeight="20rem"
        side="bottom"
        sideOffset={4}
      >
        <ul aria-label="Recent pages" className="flex flex-col">
          {pages.map((page) => (
            <li key={page.url}>
              <button
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent"
                onClick={() => {
                  setOpen(false);
                  onOpenPage(page.url);
                }}
                type="button"
              >
                <span className="grid size-4 shrink-0 place-items-center [&_img]:size-4 [&_svg]:size-4">
                  <SiteIcon favicon={page.favicon} url={page.url} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] text-foreground">
                    {page.title || hostOf(page.url)}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {hostOf(page.url)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** The site a page is on, as its bar would name it. */
function hostOf(url: string): string {
  if (!URL.canParse(url)) {
    return url;
  }
  return new URL(url).hostname.replace(/^www\./, "") || url;
}

/**
 * A line inside a box, with a small name at its left saying what the line
 * is. One row, ending where the room does rather than wrapping into columns
 * of cut-off names, with room at the end for a way to the rest.
 */
function Line({
  children,
  label,
  trailing,
}: {
  children: ReactNode;
  label: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex min-h-9 items-center gap-3 px-3 py-1">
      <span className="w-16 shrink-0 text-[11px] text-muted-foreground">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-x-1 overflow-hidden">
        {children}
      </div>
      {trailing}
    </div>
  );
}

/** One thing to open on a line: its mark and its name, the whole of it the button. */
function Mark({
  className,
  icon,
  name,
  onOpen,
  title = name,
}: {
  className?: string;
  icon: ReactNode;
  name: string;
  onOpen: () => void;
  /** What the hover says, when it says more than the name. */
  title?: string;
}) {
  return (
    <button
      className={cn(
        "inline-flex h-6 max-w-40 min-w-0 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[11px] text-gray-700 hover:bg-muted dark:text-gray-300",
        className,
      )}
      onClick={onOpen}
      title={title}
      type="button"
    >
      <span className="grid size-3.5 shrink-0 place-items-center [&_img]:size-3.5 [&_svg]:size-3.5">
        {icon}
      </span>
      <span className="truncate">{name}</span>
    </button>
  );
}

function MarkSkeletons({ count }: { count: number }) {
  return Array.from({ length: count }, (_, index) => (
    <Skeleton className="mx-1.5 my-1.5 h-3 w-14" key={index} />
  ));
}

function originOf(url: string): string {
  return URL.canParse(url) ? new URL(url).origin : url;
}
