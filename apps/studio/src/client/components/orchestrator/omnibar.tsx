import {
  orchestratorRecentsAtom,
  visitedPagesAtom,
} from "@/client/atoms/orchestrator";
import { FileSystemFolderGlyph } from "@/client/components/extend/file-system";
import { AppIcon } from "@/client/components/orchestrator/app-icon";
import { computerName } from "@/client/components/orchestrator/computer-name";
import { RECENTS_ROOT } from "@/client/components/orchestrator/computer-page";
import { useOrchestrator } from "@/client/components/orchestrator/context";
import {
  fileHref,
  mountOfHostPath,
} from "@/client/components/orchestrator/file-tabs";
import { RecentIcon, SiteIcon } from "@/client/components/orchestrator/sidebar";
import { InstrumentGlyph } from "@/client/components/wordmark";
import { getAssetBaseUrl } from "@/client/lib/asset-base-url";
import { getAssetUrl } from "@/client/lib/get-asset-url";
import { isTypingTarget } from "@/client/lib/is-typing-target";
import { siteFromWords } from "@/client/lib/site-from-words";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import uFuzzy from "@leeoniya/ufuzzy";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { LaptopIcon } from "@phosphor-icons/react/Laptop";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { unique } from "radashi";
import {
  type ComponentType,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

const SCREENS: {
  icon: ComponentType<{ className?: string }>;
  name: string;
  open: (navigate: ReturnType<typeof useNavigate>) => void;
}[] = [
  {
    icon: LaptopIcon,
    name: computerName(),
    open: (navigate) =>
      void navigate({
        search: { path: "", root: "~" },
        to: "/orchestrator/computer",
      }),
  },
  {
    icon: AppWindowIcon,
    name: "Apps",
    open: (navigate) => void navigate({ to: "/orchestrator/apps" }),
  },
];

const RECENTS_SHOWN = 6;
const SCREENS_SHOWN = 4;

const fuzzy = new uFuzzy({ intraMode: 1 });

interface OmniRow {
  group: string;
  icon: ReactNode;
  /**
   * What the row stands for, unique across the list: the key React keeps the
   * row's element by. Two rows keyed by their words (two pages titled alike,
   * a page in the history and again in the recents) left orphaned elements
   * at the top of the list that no highlight could reach.
   */
  id: string;
  name: string;
  note: string;
  run: () => void;
}

/**
 * The one box that reaches everything: every screen, every app, any site, a
 * task or a place the window has been, and failing those, the conversation.
 * It lives in the row above a new tab, where a browser keeps its address
 * field, so a new tab is the field with nothing in it yet rather than a page
 * with a second field drawn on it.
 */
export function Omnibar({
  initial = "",
  onSite,
  resting,
}: {
  /** What the field says when it is edited: the place, ready to be typed over. */
  initial?: string;
  /** Where a site goes when one is asked for: the tab's own guest, on a page. Absent, a new tab. */
  onSite?: (url: string) => void;
  /**
   * What the field shows until it is pressed: the place, in its own marks.
   * Absent on a new tab, which has nowhere to show and takes the caret at once.
   */
  resting?: ReactNode;
}) {
  const { ask, openPage, taskId } = useOrchestrator();
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const location = useRouterState({
    select: (routerState) => routerState.location,
  });
  const recents = useAtomValue(orchestratorRecentsAtom);
  const visited = useAtomValue(visitedPagesAtom);
  const [query, setQuery] = useState(initial);
  const [highlight, setHighlight] = useState(0);
  const [isEditing, setEditing] = useState(resting === undefined);
  // What was typed over the place, which is what the rows answer to; the
  // place itself, left as it was, asks for nothing.
  const typed = query.trim() === initial.trim() ? "" : query.trim();
  const words = typed.toLowerCase();
  const input = useRef<HTMLInputElement>(null);
  // A new tab the user opened should be ready to type in, but this field also
  // appears when a channel with no tabs is switched to, and there the caret
  // belongs in that channel's composer. So it takes the keyboard as it
  // arrives and only while nothing else is holding it.
  useEffect(() => {
    if (resting === undefined && !isTypingTarget(document.activeElement)) {
      input.current?.focus();
    }
    // Once, as the field arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const appList = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const catalog = useQuery(rpcClient.apps.catalog.queryOptions());
  // The matcher the model picker uses: typed letters in order, close
  // together, so "lsbn" finds lisbon.md and "pel news" the pelican task.
  const matches = (name: string) =>
    !words || (fuzzy.filter([name], typed)?.length ?? 0) > 0;
  // A name typed whole is that thing asked for, the way an address typed
  // whole is: it opens on Enter rather than being searched for.
  const isNamed = (name: string) =>
    words !== "" && name.toLowerCase() === words;
  const typedSite = siteFromWords(typed);
  const typedPath = pathFromWords(typed);

  /**
   * Opens a typed path where the field is: the folder in this tab, rooted
   * where the tab already is when the folder is under it, so the columns keep
   * their place; a file as its tab when a granted folder covers it. Whether
   * it is a folder is learned by asking for it as one, which is the read the
   * folder view is about to make anyway.
   */
  const openPath = async (written: string) => {
    const places = await queryClient.fetchQuery(
      rpcClient.workspace.computer.places.queryOptions(),
    );
    const home = places.favorites.find((place) => place.name === "Home")?.path;
    const host = expandHome(written, home);
    try {
      await queryClient.fetchQuery(
        rpcClient.workspace.computer.list.queryOptions({
          input: { id: taskId, path: host },
          retry: false,
        }),
      );
    } catch {
      const state = await queryClient.fetchQuery(
        rpcClient.workspace.task.state.get.queryOptions({
          input: { id: taskId },
        }),
      );
      const mount = mountOfHostPath(host, state.attachedFolders ?? {});
      // Not a folder: a file, if one is there. Asked of the asset origin
      // first, since opening a tab on nothing would close the tab this field
      // sits in once the viewer found the file missing.
      if (mount && (await fileExists(getAssetBaseUrl(taskId), mount))) {
        router.history.push(fileHref(mount));
        return;
      }
      toast(`Nothing at “${written}”`, {
        description: mount
          ? "No folder or file there."
          : "Not a folder, and not a file in a folder Instrument can reach.",
      });
      return;
    }
    const search = location.search as Record<string, unknown>;
    const currentRoot =
      location.pathname === "/orchestrator/computer" &&
      typeof search.root === "string" &&
      search.root !== RECENTS_ROOT
        ? search.root
        : undefined;
    const currentRootHost =
      currentRoot === undefined ? undefined : expandHome(currentRoot, home);
    const under =
      currentRoot !== undefined &&
      currentRootHost !== undefined &&
      (host === currentRootHost || host.startsWith(`${currentRootHost}/`));
    void navigate({
      search: under
        ? {
            path:
              host === currentRootHost
                ? ""
                : `${host.slice(currentRootHost.length + 1)}/`,
            root: currentRoot,
          }
        : { path: "", root: host === home ? "~" : host },
      to: "/orchestrator/computer",
    });
  };

  const screens = SCREENS.filter((screen) => matches(screen.name)).slice(
    0,
    words ? SCREENS_SHOWN : SCREENS.length,
  );
  // The apps this workspace has, each opening its page; then what the
  // directory knows, each a request to connect it.
  const known = new Set((appList.data?.apps ?? []).map((app) => app.slug));
  const apps = [
    ...(appList.data?.apps ?? []).map((app) => ({
      id: `app:${app.slug}`,
      name: app.name,
      note: app.standing === "connected" ? "App" : "Setting up",
      run: () => {
        void navigate({
          params: { slug: app.slug },
          to: "/orchestrator/apps/$slug",
        });
      },
      site: app.site,
    })),
    ...(catalog.data ?? [])
      .filter((entry) => !known.has(entry.slug))
      .map((entry) => ({
        id: `catalog:${entry.slug}`,
        name: entry.name,
        note: "Directory",
        // Its page, the same as an app the workspace has: what it is and how
        // it is reached, with connecting it the one thing to do there.
        run: () => {
          void navigate({
            params: { slug: entry.slug },
            to: "/orchestrator/apps/$slug",
          });
        },
        site: `https://${entry.domain}`,
      })),
  ].filter((app) => matches(app.name));
  // Where the window has been: the screens it landed on and the pages the
  // browser showed, newest first, as one list.
  // The work is not in here: a task looks like a place and is not one, and
  // the Tasks bookmark is the way to it.
  // One row per place: a page the browser showed is also a recent screen when
  // the window landed on it, and the two are the same place.
  const wasAt = unique(
    [
      ...recents
        .filter((entry) => entry.kind !== "task")
        .map((entry) => ({
          at: entry.at,
          icon: <RecentIcon recent={entry} />,
          id:
            entry.kind === "browser"
              ? `page:${entry.href}`
              : `recent:${entry.href}`,
          note: {
            browser: "Page",
            file: "File",
            folder: "Folder",
            task: "Task",
          }[entry.kind],
          run: () => {
            router.history.push(entry.href);
          },
          title: entry.title,
        })),
      // A page it has been to goes where a typed site goes: this tab's own
      // guest on a page, a tab of its own anywhere else.
      ...visited.map((page) => ({
        at: page.at,
        icon: <SiteIcon favicon={page.favicon} url={page.url} />,
        id: `page:${page.url}`,
        note: "Page",
        run: () => {
          (onSite ?? openPage)(page.url);
        },
        title: page.title || page.url,
      })),
    ].sort((a, b) => b.at - a.at),
    (entry) => entry.id,
  );
  const recentRows = wasAt
    .filter((entry) => matches(entry.title))
    .slice(0, words ? RECENTS_SHOWN : 0);
  const screenRows: OmniRow[] = screens.map((screen) => ({
    group: "Screens",
    icon: <screen.icon className="size-4" />,
    id: `screen:${screen.name}`,
    name: screen.name,
    note: "Screen",
    run: () => {
      screen.open(navigate);
    },
  }));
  const recentOmniRows: OmniRow[] = recentRows.map((entry) => ({
    group: "Recent",
    icon: entry.icon,
    id: entry.id,
    name: entry.title,
    note: entry.note,
    run: entry.run,
  }));
  const appRows: OmniRow[] = apps.map((app) => ({
    group: "Apps",
    icon: <AppIcon site={app.site} size="sm" />,
    id: app.id,
    name: app.name,
    note: app.note,
    run: app.run,
  }));
  const matched = [...screenRows, ...recentOmniRows, ...appRows];
  const rows: OmniRow[] = [
    // What the words are, when they are a place: a path on the computer, an
    // address, or the whole name of something the box knows. Each opens on
    // Enter, which is what the field is for when it is edited in place.
    ...(typedPath
      ? [
          {
            group: "Open",
            icon: <FileSystemFolderGlyph className="h-3 w-auto" />,
            id: "path",
            name: typedPath,
            note: computerName(),
            run: () => {
              void openPath(typedPath);
            },
          },
        ]
      : []),
    ...(typedSite
      ? [
          {
            group: "Open",
            icon: <GlobeIcon className="size-4" />,
            id: "site",
            name: `Open ${typedSite.host}`,
            note: "Site",
            run: () => {
              (onSite ?? openPage)(typedSite.url);
            },
          },
        ]
      : []),
    ...matched
      .filter((row) => isNamed(row.name))
      .map((row) => ({ ...row, group: "Open" })),
    // What the words can be used with, next: searching the web and asking
    // the conversation are what typed words most often mean, and the rows
    // that matched them follow.
    ...(words
      ? [
          {
            group: `Use “${typed}” with`,
            icon: <MagnifyingGlassIcon className="size-4" />,
            id: "search",
            name: "Search the web",
            note: "Browser",
            run: () => {
              (onSite ?? openPage)(
                `https://www.google.com/search?q=${encodeURIComponent(typed)}`,
              );
              setQuery("");
            },
          },
          {
            group: `Use “${typed}” with`,
            icon: <InstrumentGlyph className="size-4" />,
            id: "ask",
            name: "Ask Instrument",
            note: "Agent",
            run: () => {
              ask(typed);
              setQuery("");
            },
          },
        ]
      : []),
    ...matched.filter((row) => !isNamed(row.name)),
  ];
  const current = Math.min(highlight, Math.max(0, rows.length - 1));

  return (
    <>
      {isEditing || resting === undefined ? (
        <MagnifyingGlassIcon className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        resting
      )}
      <input
        aria-label="Search or ask"
        className={cn(
          "h-full min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground",
          // Kept in the box while the place is shown, so a press on the box
          // has something to put the caret in; it takes the box over on focus.
          !isEditing && resting !== undefined && "absolute inset-0 opacity-0",
        )}
        onBlur={() => {
          if (resting !== undefined) {
            setEditing(false);
            setQuery(initial);
          }
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setHighlight(0);
        }}
        onFocus={(event) => {
          setEditing(true);
          // The place, selected whole, so typing replaces it the way it does
          // in a browser's address bar.
          event.currentTarget.select();
        }}
        onKeyDown={(event) => {
          switch (event.key) {
            case "ArrowDown": {
              event.preventDefault();
              setHighlight((value) => Math.min(rows.length - 1, value + 1));
              break;
            }
            case "ArrowUp": {
              event.preventDefault();
              setHighlight((value) => Math.max(0, value - 1));
              break;
            }
            case "Enter": {
              event.preventDefault();
              rows[current]?.run();
              break;
            }
            case "Escape": {
              if (resting === undefined) {
                setQuery("");
              } else {
                event.currentTarget.blur();
              }
              break;
            }
            // No default
          }
        }}
        placeholder="Search, open a file, or ask Instrument"
        ref={input}
        spellCheck={false}
        type="text"
        value={query}
      />
      {words ? (
        <div className="absolute inset-x-0 top-full z-20 mt-1.5 max-h-[calc(60vh/var(--app-zoom))] overflow-y-auto rounded-xl border border-border bg-popover shadow-lg">
          {rows.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              Nothing by that name.
            </p>
          ) : (
            rows.map((row, index) => (
              <div key={row.id}>
                {index === 0 || rows[index - 1]?.group !== row.group ? (
                  <p className="px-4 pt-3 pb-1 text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
                    {row.group}
                  </p>
                ) : null}
                <button
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-2 text-left text-sm",
                    index === current ? "bg-accent" : "hover:bg-accent/50",
                  )}
                  onClick={row.run}
                  onMouseEnter={() => {
                    setHighlight(index);
                  }}
                  // The arrows move the highlight past the list's fold; the
                  // list follows, so the row picked is the row seen.
                  ref={(element) => {
                    if (index === current) {
                      element?.scrollIntoView({ block: "nearest" });
                    }
                  }}
                  type="button"
                >
                  <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                    {row.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{row.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {row.note}
                  </span>
                </button>
              </div>
            ))
          )}
        </div>
      ) : null}
    </>
  );
}

/** The path with `~` written out, so it can be compared with paths the Mac gives. */
function expandHome(path: string, home: string | undefined) {
  if (home === undefined) {
    return path;
  }
  return path === "~" ? home : path.replace(/^~\//, `${home}/`);
}

/**
 * Whether the asset origin has a file at a virtual path. An origin that is
 * not up, or a request cut off, is not the file's absence, so those count as
 * present and the viewer says what it finds.
 */
async function fileExists(assetBase: string, mount: string) {
  try {
    const response = await fetch(getAssetUrl({ assetBase, filePath: mount }), {
      headers: { Range: "bytes=0-0" },
    });
    return response.status !== 404;
  } catch {
    return true;
  }
}

/**
 * Typed words that are a place on the computer: a path from the root, from
 * the home folder as `~`, or from a drive letter, the way the field shows one.
 * A trailing slash says nothing about a folder the field will open anyway.
 */
function pathFromWords(words: string): string | undefined {
  if (!/^(?:~(?:\/|$)|\/|[A-Z]:[\\/])/i.test(words)) {
    return;
  }
  return words.length > 1 ? words.replace(/[\\/]+$/, "") || words[0] : words;
}
