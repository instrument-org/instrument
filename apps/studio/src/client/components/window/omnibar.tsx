import { PageFavicon } from "@/client/components/favicon";
import {
  bookmarksAtom,
  CHATS_HREF,
  visitedPagesAtom,
} from "@/client/atoms/window";
import {
  FileSystemFolderGlyph,
  FileTypeIcon,
} from "@/client/components/extend/file-system";
import { AppIcon } from "@/client/components/window/app-icon";
import { useAppsBySlug } from "@/client/components/window/apps-by-slug";
import { useChatTasks } from "@/client/components/window/child-tasks-query";
import { computerName } from "@/client/components/window/computer-name";
import { RECENTS_ROOT } from "@/client/components/window/computer-page";
import { useWindow } from "@/client/components/window/context";
import {
  addressCompletion,
  bareAddress,
  isSearchWords,
  matchEntries,
  matchNames,
  matchPages,
  pathFromWords,
  pathQuery,
} from "@/client/components/window/omnibar-match";
import {
  initialOmnibarField,
  omnibarField,
} from "@/client/components/window/omnibar-field";
import { ShellContext } from "@/client/components/window/shell-context";
import {
  type TabLocation,
  taskHref,
} from "@/client/components/window/tab-location";
import { getComputerFileUrl } from "@/client/lib/computer-file-url";
import { isTypingTarget } from "@/client/lib/is-typing-target";
import { webSearchUrl } from "@/client/lib/resolve-url-or-search";
import { siteFromWords } from "@/client/lib/site-from-words";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { fileHref } from "@/shared/computer-href";
import { displayHostPath, expandHomePath } from "@instrument-org/shared";
import { WINDOW_ID } from "@instrument-org/workspace/client";
import { CheckSquareIcon } from "@phosphor-icons/react/CheckSquare";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import {
  keepPreviousData,
  skipToken,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import ms from "ms";
import { unique } from "radashi";
import { toast } from "sonner";
import {
  type ReactNode,
  use,
  useEffect,
  useId,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";

/** Rows past the one Enter takes: enough to choose from, few enough to read at a glance. */
const PAGES_SHOWN = 4;
const SUGGESTIONS_SHOWN = 5;
const ENTRIES_SHOWN = 8;
const MATCHES_SHOWN = 8;

/**
 * What a tab's field reaches, decided by what the tab holds: the web from a
 * page or a new tab, the computer from a folder or a file, and from any other
 * screen the list that screen is one of, so an app's page finds apps and a
 * task's page finds tasks.
 */
export type OmnibarMode = "apps" | "chats" | "files" | "tasks" | "web";

function omnibarModeOf(location: TabLocation): OmnibarMode {
  switch (location.kind) {
    case "app":
    case "apps": {
      return "apps";
    }
    case "chat": {
      return "chats";
    }
    case "file":
    case "folder": {
      return "files";
    }
    case "task":
    case "tasks": {
      return "tasks";
    }
    case "newTab":
    case "page": {
      return "web";
    }
  }
}

/** What the field says it is for, empty and to a screen reader. */
const PROMPTS: Record<OmnibarMode, string> = {
  apps: "Find an app",
  chats: "Find a chat",
  files: "Go to a folder or file",
  tasks: "Find a task",
  web: "Search or enter address",
};

/** What a list with nothing matching is a list of. */
const NOUNS: Record<Exclude<OmnibarMode, "files" | "web">, string> = {
  apps: "apps",
  chats: "chats",
  tasks: "tasks",
};

interface OmniRow {
  /** Muted after the name: a page's address, what Enter does with the words. */
  detail?: string | undefined;
  /**
   * What the field says while the row is picked with the arrows, and what Tab
   * writes into it to go on typing from there: a page's address, a folder's
   * path ending in a separator.
   */
  fill?: string;
  icon: ReactNode;
  /** What the row stands for, unique across the list: the key React keeps its element by. */
  id: string;
  /**
   * Whether the row puts the field away itself, once it knows it has gone
   * somewhere: a path is looked for first, and the words stay when nothing is
   * there.
   */
  leavesItself?: boolean;
  name: string;
  run: () => void;
}

/**
 * A tab's address field, which reads what is typed in the terms of what the
 * tab holds (see `OmnibarMode`).
 *
 * The first row is always what Enter does with the words in the field, and it
 * is what the field says: an address a browser would open, a search, a path,
 * or the best match in the screen's list. The rows under it are other things
 * the words could mean, and the arrows pick one without the field forgetting
 * what was typed. On the web and the computer the field finishes an address or
 * a name ahead of the caret, from where the browser has been or what the
 * folder holds, the way a browser's address bar does.
 *
 * It lives in the row above a new tab, where a browser keeps its address
 * field, so a new tab is the field with nothing in it yet rather than a page
 * with a second field drawn on it.
 */
export function Omnibar({
  initial = "",
  location,
  onSite,
  onVisit,
  resting,
}: {
  /** What the field says when it is edited: the place, ready to be typed over. */
  initial?: string;
  /** Where the tab is, which is what the field reaches and where a relative path starts. */
  location: TabLocation;
  /** Where a site goes when one is asked for: the tab's own guest, on a page. Absent, a new tab. */
  onSite?: (url: string) => void;
  /** Where a screen the field names goes: the tab this row is over, when that tab is not the router's. */
  onVisit?: (href: string) => void;
  /**
   * What the field shows until it is pressed: the place, in its own marks.
   * Absent on a new tab, which has nowhere to show and takes the caret at once.
   */
  resting?: ReactNode;
}) {
  const mode = omnibarModeOf(location);
  const { openPage } = useWindow();
  const router = useRouter();
  const queryClient = useQueryClient();
  const routerLocation = useRouterState({
    select: (routerState) => routerState.location,
  });
  const [{ canComplete, highlight, isEditing, isFocused, query }, send] =
    useReducer(
      omnibarField,
      initialOmnibarField(initial, resting === undefined),
    );
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  // What was typed over the place, which is what the rows answer to; the
  // place itself, left as it was, asks for nothing.
  const typed = query.trim() === initial.trim() ? "" : query;

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

  /** Takes the tab this field is over to a screen: its own when it keeps one, the router's otherwise. */
  const visit = (href: string) => {
    if (onVisit) {
      onVisit(href);
    } else {
      router.history.push(href);
    }
  };
  /** Where a site goes: this tab's own guest on a page, a tab of its own anywhere else. */
  const openSite = (url: string) => {
    (onSite ?? openPage)(url);
  };
  // Done with: the field goes back to showing the place, or to empty on a
  // new tab, which has no place to show.
  const leave = () => {
    if (resting === undefined) {
      send({ type: "clear" });
    }
    input.current?.blur();
  };

  /**
   * Opens a folder where the field is, rooted where the tab already is when
   * the folder is under it, so the columns keep their place.
   */
  const openFolder = (host: string) => {
    const home = window.api.homeDir;
    const search = routerLocation.search as Record<string, unknown>;
    const currentRoot =
      routerLocation.pathname === "/files" &&
      typeof search.root === "string" &&
      search.root !== RECENTS_ROOT
        ? search.root
        : undefined;
    const currentRootHost =
      currentRoot === undefined ? undefined : expandHomePath(currentRoot, home);
    const under =
      currentRoot !== undefined &&
      currentRootHost !== undefined &&
      (host === currentRootHost || host.startsWith(`${currentRootHost}/`));
    visit(
      router.buildLocation({
        search: under
          ? {
              path:
                host === currentRootHost
                  ? ""
                  : `${host.slice(currentRootHost.length + 1)}/`,
              root: currentRoot,
            }
          : { path: "", root: host === home ? "~" : host },
        to: "/files",
      }).href,
    );
    leave();
  };
  /**
   * Opens a path where the field is: a folder in this tab, a file as its tab.
   * Whether it is a folder is learned by asking for it as one, which is the
   * read the folder view is about to make anyway.
   */
  const openPath = async (host: string) => {
    try {
      await queryClient.fetchQuery(
        rpcClient.workspace.computer.list.queryOptions({
          input: { id: WINDOW_ID, path: host },
          retry: false,
        }),
      );
    } catch {
      // Not a folder: a file, if one is there. Asked of the channel first,
      // since opening a tab on nothing would close the tab this field sits in
      // once the viewer found the file missing.
      if (await fileExists(host)) {
        visit(fileHref(host));
        leave();
        return;
      }
      toast(`Nothing at “${displayHostPath(host, window.api.homeDir)}”`, {
        description: "No folder or file there.",
      });
      return;
    }
    openFolder(host);
  };

  const { completion, empty, rows } = useRows({
    canComplete,
    location,
    mode,
    open: { openFolder, openPath, openSite, visit },
    typed,
  });
  const current = Math.min(highlight, Math.max(0, rows.length - 1));
  const isListShown = isEditing && typed.trim() !== "";
  const picked = current > 0 ? rows[current] : undefined;
  // The field says what Enter will do: the words with the rest of an address
  // written in ahead of the caret, or the row the arrows are on.
  const shown = picked?.fill ?? `${query}${completion}`;

  // The part the field wrote in is selected, so the next letter typed
  // replaces it and Backspace takes it away, the way a browser's does.
  useLayoutEffect(() => {
    const box = input.current;
    if (completion && !picked && box && document.activeElement === box) {
      box.setSelectionRange(query.length, query.length + completion.length);
    }
  }, [completion, picked, query]);

  const run = (row: OmniRow | undefined) => {
    if (!row) {
      return;
    }
    row.run();
    if (!row.leavesItself) {
      leave();
    }
  };
  /** The words as the field shows them become the words typed, and the field goes on from there. */
  const takeShown = (words: string) => {
    send({ query: words, type: "take" });
  };

  return (
    <>
      {!isEditing && resting !== undefined && resting}
      <input
        aria-activedescendant={
          isListShown && rows.length > 0 ? `${listId}-${current}` : undefined
        }
        aria-autocomplete="both"
        aria-controls={isListShown ? listId : undefined}
        aria-expanded={isListShown}
        aria-label={PROMPTS[mode]}
        className={cn(
          "h-full min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground",
          // A new tab's empty box rests with its placeholder centered, the
          // way a search box does; the caret and the words typed start at
          // the left.
          resting === undefined && query === "" && !isFocused && "text-center",
          // Kept in the box while the place is shown, so a press on the box
          // has something to put the caret in; it takes the box over on focus.
          // Out of the pointer's way while it lies over the place, so a press
          // reaches the part of the place under it; the box hands it the caret
          // itself for a press anywhere else.
          !isEditing &&
            resting !== undefined &&
            "pointer-events-none absolute inset-0 opacity-0",
        )}
        onBlur={() => {
          send({
            place: resting === undefined ? undefined : initial,
            type: "blur",
          });
        }}
        onChange={(event) => {
          const box = event.currentTarget;
          const { nativeEvent } = event;
          send({
            canComplete:
              nativeEvent instanceof InputEvent &&
              nativeEvent.inputType === "insertText" &&
              box.selectionEnd === box.value.length,
            query: box.value,
            type: "input",
          });
        }}
        onFocus={(event) => {
          send({ type: "focus" });
          // The place, selected whole, so typing replaces it the way it does
          // in a browser's address bar.
          event.currentTarget.select();
        }}
        onKeyDown={(event) => {
          switch (event.key) {
            case "ArrowDown": {
              event.preventDefault();
              send({
                index: Math.max(0, Math.min(rows.length - 1, current + 1)),
                type: "highlight",
              });
              break;
            }
            case "ArrowRight":
            case "End": {
              // The written-in rest is kept, and the caret goes past it.
              if (completion && !picked) {
                takeShown(shown);
              }
              break;
            }
            case "ArrowUp": {
              event.preventDefault();
              send({ index: Math.max(0, current - 1), type: "highlight" });
              break;
            }
            case "Enter": {
              event.preventDefault();
              if (typed.trim() !== "") {
                // A path with no row for it (a hidden name, a folder past the
                // listing's cut or refused to it, a listing still on its way)
                // is still opened as typed.
                const typedPath = rows[current]
                  ? undefined
                  : pathFromWords(typed.trim());
                if (typedPath) {
                  void openPath(expandHomePath(typedPath, window.api.homeDir));
                } else {
                  run(rows[current]);
                }
                break;
              }
              // Nothing typed over the place, so no list is showing and no
              // row is what was asked for. The place itself, entered as it
              // stands, goes there again the way a browser's address does: a
              // path is opened afresh, and anything else hands the field
              // back to the place.
              const again = pathFromWords(query.trim());
              if (again) {
                void openPath(expandHomePath(again, window.api.homeDir));
              } else if (resting !== undefined) {
                event.currentTarget.blur();
              }
              break;
            }
            case "Escape": {
              // Back to the words typed first, then to the place.
              if (picked || completion) {
                event.preventDefault();
                send({ type: "revert" });
              } else if (resting === undefined) {
                send({ type: "clear" });
              } else {
                event.currentTarget.blur();
              }
              break;
            }
            case "Tab": {
              // Takes what the field shows, to go on typing from it: a
              // folder's path, ready for a name in it.
              const fill = rows[current]?.fill;
              if (isListShown && !event.shiftKey && fill && fill !== query) {
                event.preventDefault();
                takeShown(fill);
              }
              break;
            }
            // No default
          }
        }}
        placeholder={PROMPTS[mode]}
        ref={input}
        role="combobox"
        spellCheck={false}
        type="text"
        value={shown}
      />
      {isListShown && (rows.length > 0 || empty) ? (
        // A press on a row must not take the caret first: the box would blur,
        // the list would go, and the click would land on nothing.
        <div
          className="absolute inset-x-0 top-full z-20 mt-1.5 max-h-[calc(60vh/var(--app-zoom))] overflow-y-auto rounded-xl border border-border bg-popover py-1 shadow-lg"
          id={listId}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          role="listbox"
        >
          {rows.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">{empty}</p>
          ) : (
            rows.map((row, index) => (
              <button
                aria-selected={index === current}
                className={cn(
                  "flex h-8 w-full items-center gap-2.5 px-3 text-left text-sm",
                  index === current ? "bg-accent" : "hover:bg-accent/50",
                )}
                id={`${listId}-${index}`}
                key={row.id}
                onClick={() => {
                  run(row);
                }}
                // The arrows move the highlight past the list's fold; the
                // list follows, so the row picked is the row seen.
                ref={(element) => {
                  if (index === current) {
                    element?.scrollIntoView({ block: "nearest" });
                  }
                }}
                role="option"
                tabIndex={-1}
                type="button"
              >
                <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                  {row.icon}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {row.name}
                  {row.detail ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {row.detail}
                    </span>
                  ) : null}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </>
  );
}

/**
 * The rows the words in the field stand for, in the terms of what the tab
 * holds, the first of them what Enter does, and the rest of a name or an
 * address the field writes in ahead of the caret.
 */
function useRows({
  canComplete,
  location,
  mode,
  open,
  typed,
}: {
  canComplete: boolean;
  location: TabLocation;
  mode: OmnibarMode;
  open: {
    openFolder: (host: string) => void;
    openPath: (host: string) => Promise<void>;
    openSite: (url: string) => void;
    visit: (href: string) => void;
  };
  typed: string;
}): { completion: string; empty?: string; rows: OmniRow[] } {
  const home = window.api.homeDir;
  const words = typed.trim();
  const shell = use(ShellContext);

  // On the web: the pages the window knows, bookmarks ahead of history.
  const visited = useAtomValue(visitedPagesAtom);
  const bookmarks = useAtomValue(bookmarksAtom);
  const pages = unique(
    [
      ...bookmarks.map((bookmark) => ({
        favicon: undefined,
        title: bookmark.title,
        url: bookmark.url,
      })),
      ...visited.map((page) => ({
        favicon: page.favicon,
        title: page.title,
        url: page.url,
      })),
    ],
    (page) => page.url,
  );
  // What the engine would finish the words as, asked once typing pauses
  // rather than on every letter, and never for a path or an address.
  const wantsSuggestions = mode === "web" && isSearchWords(words);
  const [asked, setAsked] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setAsked(wantsSuggestions ? words : "");
    }, 120);
    return () => {
      clearTimeout(timer);
    };
  }, [wantsSuggestions, words]);
  const suggestions = useQuery(
    rpcClient.browser.searchSuggestions.queryOptions({
      input: asked ? { query: asked } : skipToken,
      // The last answer stands until the next arrives, so the list does not
      // empty and refill with every letter.
      placeholderData: keepPreviousData,
      staleTime: ms("5 minutes"),
    }),
  );

  // On the computer: the folder the words are in, and the start of a name.
  const here = hereOf(location, home);
  const path = pathQuery(typed, { here, home });
  const listing = useQuery(
    rpcClient.workspace.computer.list.queryOptions({
      input:
        mode === "files" && words !== ""
          ? { id: WINDOW_ID, path: path.folder }
          : skipToken,
      retry: false,
      staleTime: ms("10 seconds"),
    }),
  );

  // The lists the other screens are one of.
  const appsBySlug = useAppsBySlug();
  // The tasks of the chat the tasks screen or the task's page is for.
  const tasks = useChatTasks(
    mode === "tasks" && (location.kind === "task" || location.kind === "tasks")
      ? location.chat
      : undefined,
  );

  if (mode === "web") {
    const completion =
      canComplete && pathFromWords(words) === undefined
        ? addressCompletion(typed, pages)
        : "";
    const whole = `${typed}${completion}`.trim();
    const typedPath = pathFromWords(whole);
    const site = typedPath ? undefined : siteFromWords(whole);
    const known = site
      ? pages.find((page) => bareAddress(page.url) === bareAddress(site.url))
      : undefined;
    const first: OmniRow = typedPath
      ? pathRow(expandHomePath(typedPath, home), open.openPath)
      : site
        ? {
            detail: known?.title,
            fill: whole,
            icon: <PageFavicon url={site.url} />,
            id: "site",
            name: whole,
            run: () => {
              // A page the window knows opens at the address it was at, the
              // one the field finished the words as.
              open.openSite(known?.url ?? site.url);
            },
          }
        : {
            detail: "Search DuckDuckGo",
            fill: whole,
            icon: <MagnifyingGlassIcon className="size-4" />,
            id: "search",
            name: whole,
            run: () => {
              open.openSite(webSearchUrl(whole));
            },
          };
    const pageRows = matchPages(words, pages)
      .filter((page) => page.url !== known?.url)
      .slice(0, PAGES_SHOWN)
      .map(
        (page): OmniRow => ({
          detail: bareAddress(page.url),
          fill: page.url,
          icon: <PageFavicon favicon={page.favicon} url={page.url} />,
          id: `page:${page.url}`,
          name: page.title || bareAddress(page.url),
          run: () => {
            open.openSite(page.url);
          },
        }),
      );
    const suggestionRows = wantsSuggestions
      ? (suggestions.data ?? [])
          .filter(
            (suggestion) => suggestion.toLowerCase() !== whole.toLowerCase(),
          )
          .slice(0, SUGGESTIONS_SHOWN)
          .map((suggestion): OmniRow => {
            const suggestedSite = siteFromWords(suggestion);
            return {
              fill: suggestion,
              icon: suggestedSite ? (
                <PageFavicon url={suggestedSite.url} />
              ) : (
                <MagnifyingGlassIcon className="size-4" />
              ),
              id: `suggestion:${suggestion}`,
              name: suggestion,
              run: () => {
                open.openSite(suggestedSite?.url ?? webSearchUrl(suggestion));
              },
            };
          })
      : [];
    return {
      completion,
      rows: [first, ...pageRows, ...suggestionRows],
    };
  }

  if (mode === "files") {
    // Only what is there: the folder's own entries, and the folder itself
    // once the words end in it. Nothing is offered at a path with nothing at
    // it, and words that are not a path find names in the folder on screen.
    const isWhole = pathFromWords(words) !== undefined;
    // A folder the system refused is still a folder, and opens to say so; it
    // just has no names in it to offer.
    const listed = listing.data;
    const entries = matchEntries(
      path.prefix,
      listed?.kind === "listing" ? listed.entries : [],
    );
    // The name the field finishes a whole path as: the first the start typed
    // begins, letter for letter, so what it writes in is a real name's rest.
    // Bare words are a search of the folder on screen, and are left as typed.
    const finished =
      canComplete && isWhole && path.prefix !== ""
        ? entries.find((entry) => entry.name.startsWith(path.prefix))
        : undefined;
    const completion = finished ? finished.name.slice(path.prefix.length) : "";
    const whole = `${typed}${completion}`;
    const entryRow = (entry: (typeof entries)[number]): OmniRow => ({
      fill:
        entry === finished
          ? `${whole}${entry.kind === "folder" ? "/" : ""}`
          : `${path.lead}${entry.name}${entry.kind === "folder" ? "/" : ""}`,
      icon:
        entry.kind === "folder" ? (
          <FileSystemFolderGlyph className="h-3 w-auto" />
        ) : (
          <FileTypeIcon className="size-4" fileName={entry.name} />
        ),
      id: `entry:${entry.path}`,
      name: entry.name,
      run: () => {
        if (entry.kind === "folder") {
          open.openFolder(entry.path);
        } else {
          open.visit(fileHref(entry.path));
        }
      },
      ...(entry.kind === "folder" ? { leavesItself: true } : {}),
    });
    const folderRows: OmniRow[] =
      listed && path.prefix === ""
        ? [
            {
              ...pathRow(path.folder, open.openPath),
              run: () => {
                open.openFolder(path.folder);
              },
            },
          ]
        : [];
    const rows = [
      ...folderRows,
      ...(finished ? [entryRow(finished)] : []),
      ...entries
        .filter((entry) => entry !== finished)
        .slice(0, ENTRIES_SHOWN)
        .map(entryRow),
    ];
    const folderName = displayHostPath(path.folder, home);
    return {
      completion,
      ...(listing.isError
        ? { empty: `Nothing at “${folderName}”` }
        : listed?.kind === "refused"
          ? { empty: `Instrument can’t read “${folderName}”` }
          : listed
            ? { empty: `Nothing in “${folderName}” matches “${path.prefix}”` }
            : {}),
      rows,
    };
  }

  // Anywhere else, a path pasted in is still a path, and opens on Enter.
  const typedPath = pathFromWords(words);
  if (typedPath) {
    return {
      completion: "",
      rows: [pathRow(expandHomePath(typedPath, home), open.openPath)],
    };
  }
  const matches = ((): OmniRow[] => {
    switch (mode) {
      case "apps": {
        return matchNames(words, [...appsBySlug], ([, app]) => app.name).map(
          ([slug, app]) => ({
            icon: (
              <AppIcon
                name={app.name}
                icon={app.icon}
                site={app.site}
                size="sm"
              />
            ),
            id: `app:${slug}`,
            name: app.name,
            run: () => {
              open.visit(`/apps/${slug}`);
            },
          }),
        );
      }
      case "chats": {
        return matchNames(
          words,
          [...(shell?.chatTitles ?? [])],
          ([, title]) => title,
        ).map(([id, title]) => ({
          icon: <ChatCircleIcon className="size-4" />,
          id: `chat:${id}`,
          name: title,
          run: () => {
            open.visit(`${CHATS_HREF}/${id}`);
          },
        }));
      }
      case "tasks": {
        // A task's page finds the tasks of the chat it was opened from, the
        // list its crumb goes back to.
        const chat =
          location.kind === "task" || location.kind === "tasks"
            ? location.chat
            : undefined;
        return matchNames(words, tasks.data ?? [], (task) => task.title).map(
          (task) => ({
            icon: <CheckSquareIcon className="size-4" />,
            id: `task:${task.id}`,
            name: task.title,
            run: () => {
              open.visit(taskHref(task.id, chat));
            },
          }),
        );
      }
    }
  })().slice(0, MATCHES_SHOWN);
  return {
    completion: "",
    empty: `No ${NOUNS[mode]} match “${words}”`,
    rows: [...matches],
  };
}

/** The row that opens a path on the computer, which says it before looking. */
function pathRow(host: string, openPath: (host: string) => Promise<void>) {
  return {
    detail: `Open on ${computerName()}`,
    icon: <FileSystemFolderGlyph className="h-3 w-auto" />,
    id: "path",
    leavesItself: true,
    name: displayHostPath(host, window.api.homeDir),
    run: () => {
      void openPath(host);
    },
  } satisfies OmniRow;
}

/**
 * The folder a path typed bare is in: the folder on screen, a file's own
 * folder, and the home folder from anywhere else.
 */
function hereOf(location: TabLocation, home: string) {
  if (location.kind === "folder" && location.path !== "") {
    return expandHomePath(location.path, home);
  }
  if (location.kind === "file") {
    const host = expandHomePath(location.path, home);
    const cut = Math.max(host.lastIndexOf("/"), host.lastIndexOf("\\"));
    return cut > 0 ? host.slice(0, cut) : host.slice(0, cut + 1) || home;
  }
  return home;
}

/**
 * Whether there is a file at a path on the computer. A channel that is not
 * up, or a request cut off, is not the file's absence, so those count as
 * present and the viewer says what it finds.
 */
async function fileExists(hostPath: string) {
  try {
    const response = await fetch(getComputerFileUrl({ hostPath }), {
      headers: { Range: "bytes=0-0" },
    });
    return response.status !== 404;
  } catch {
    return true;
  }
}
