import { pinsAtom, visitedPagesAtom } from "@/client/atoms/orchestrator";
import { FileSystemFolderGlyph } from "@/client/components/extend/file-system";
import { FileIcon } from "@/client/components/file-icon";
import { Skeleton } from "@/client/components/ui/skeleton";
import { resolveUrlOrSearch } from "@/client/lib/resolve-url-or-search";
import { cn } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { type TaskId } from "@instrument-org/workspace/client";
import { type Icon } from "@phosphor-icons/react";
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
 * The empty band under a draft's words: four rows, each drawn as the thing
 * it opens, so the browser, the computer and the apps are in sight before
 * anything is gathered. Attach is a drop strip that is also a button; Browse
 * an address field over the sites kept and lately seen; This Mac the places
 * and the files lately shown; Apps their icons, each of which names itself
 * in the words rather than opening. Whatever a row opens arrives as a tab in
 * the band, in this tab's place.
 */
export function ComposeZeroState({
  onAttach,
  onOpenApp,
  onOpenFile,
  onOpenFolder,
  onOpenPage,
  taskId,
}: {
  /** The file chooser, for the Attach row's button. */
  onAttach: () => void;
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

  // The sites kept first, then the ones lately seen that are not among them,
  // one per site, so the line is the places a person goes back to.
  const bookmarks = pins.filter((pin) => pin.kind === "page");
  const seenOrigins = new Set<string>();
  const seen = visited
    .filter((page) => {
      const origin = URL.canParse(page.url)
        ? new URL(page.url).origin
        : page.url;
      if (
        seenOrigins.has(origin) ||
        bookmarks.some((pin) => pin.target === page.url)
      ) {
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
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-y-auto pt-5 pb-5">
      <Row icon={PaperclipIcon} name="Attach">
        <button
          className="flex h-12 w-full items-center justify-center gap-3 rounded-lg border-2 border-dashed border-gray-300 text-[12px] text-gray-500 hover:border-gray-400 hover:text-gray-600 dark:border-gray-600 dark:text-gray-400 dark:hover:border-gray-500"
          onClick={onAttach}
          type="button"
        >
          <span>Drop files or folders here</span>
          <span className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-[12px] font-medium text-foreground shadow-xs">
            <PaperclipIcon className="size-3.5 text-muted-foreground" />
            Choose files
          </span>
        </button>
      </Row>

      <Row icon={GlobeSimpleIcon} name="Browse">
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
            <Line label="Bookmarks" oneRow>
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
            // The sites by name, the way a browser's own bar names them,
            // one row that ends where the room does: a page's title is a
            // sentence, and a sentence cut short reads as a broken one.
            <Line label="Recent" oneRow>
              {seen.map((page) => (
                <Mark
                  icon={<SiteIcon favicon={page.favicon} url={page.url} />}
                  key={page.url}
                  name={hostOf(page.url)}
                  onOpen={() => {
                    onOpenPage(page.url);
                  }}
                  title={page.title || page.url}
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
      </Row>

      <Row icon={LaptopIcon} name={computerName()}>
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
      </Row>

      <Row icon={SquaresFourIcon} name="Apps">
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
          <p className="pt-2 text-[11px] text-muted-foreground">
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
      </Row>
    </div>
  );
}

/** A row's white box, its lines divided. */
function Box({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-border rounded-lg bg-card shadow-xs">
      {children}
    </div>
  );
}

/**
 * A line inside a box, with a small name at its left saying what the line
 * is. `oneRow` keeps it to one row, ending where the room does, rather than
 * wrapping into columns.
 */
function Line({
  children,
  label,
  oneRow = false,
}: {
  children: ReactNode;
  label: string;
  oneRow?: boolean;
}) {
  return (
    <div className="flex min-h-9 items-center gap-3 px-3 py-1">
      <span className="w-16 shrink-0 text-[11px] text-muted-foreground">
        {label}
      </span>
      <div
        className={cn(
          "flex min-w-0 flex-1 items-center gap-x-1 gap-y-0.5",
          oneRow ? "overflow-hidden" : "flex-wrap",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** The site a page is on, as its bar would name it. */
function hostOf(url: string): string {
  if (!URL.canParse(url)) {
    return url;
  }
  return new URL(url).hostname.replace(/^www\./, "") || url;
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

/** A row: its name at the left, a mark and the word, and what it opens beside it. */
function Row({
  children,
  icon: RowIcon,
  name,
}: {
  children: ReactNode;
  icon: Icon;
  name: string;
}) {
  return (
    <div className="flex items-start gap-4 px-5">
      <span className="inline-flex w-24 shrink-0 items-center gap-2 pt-2 text-[12px] font-medium text-gray-700 dark:text-gray-300">
        <RowIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{name}</span>
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
