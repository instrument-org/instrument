import { useSteadyCallbacks } from "@/client/hooks/use-steady-callbacks";
import { PageFavicon } from "@/client/components/favicon";
import {
  noteTypedPage,
  useCompletionPages,
} from "@/client/hooks/use-browser-history";
import {
  type AddressTarget,
  sameAddress,
  targetOfAddress,
} from "@/client/bookmarks/address";
import { hrefOfTarget } from "@/client/bookmarks/open-address";
import { bookmarksAtom } from "@/client/bookmarks/store";
import {
  FileSystemFolderGlyph,
  FileTypeIcon,
} from "@/client/components/extend/file-system";
import { RECENTS_ROOT } from "@/client/components/window/computer-page";
import { useWindow } from "@/client/components/window/context";
import {
  addressCompletion,
  bareAddress,
  isSearchWords,
  matchEntries,
  matchPages,
  pathQuery,
  siteOf,
} from "@/client/components/window/omnibar-match";
import {
  initialOmnibarField,
  omnibarField,
  registerFieldEditor,
} from "@/client/components/window/omnibar-field";
import {
  relativeHostPath,
  segmentsOf,
} from "@/client/components/window/host-path";
import { debugHrefOf } from "@/client/components/window/debug-address";
import { isGroupScreenHref } from "@/client/components/window/group-screen";
import { ShellContext } from "@/client/components/window/shell-context";
import { matchScreen } from "@/client/components/window/window-href";
import {
  fieldScopeOf,
  type TabLocation,
} from "@/client/components/window/tab-location";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { iconHostOf } from "@/client/lib/favicon-url";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import { isTypingTarget } from "@/client/lib/is-typing-target";
import { focusScreenHome } from "@/client/lib/keyboard-home";
import {
  locateTypedPath,
  type MissedPath,
  missedPathNotice,
  shownTypedPath,
  typedPathHere,
} from "@/client/lib/locate-typed-path";
import {
  type TypedPath,
  typedFileName,
  withoutTrailingSeparators,
} from "@/client/lib/typed-path";
import {
  webSearchLabel,
  webSearchUrl,
} from "@/client/lib/resolve-url-or-search";
import { siteFromWords } from "@/client/lib/site-from-words";
import { cn } from "@/client/lib/utils";
import { computerFolderOptions } from "@/client/lib/live-computer-folder";
import { rpcClient } from "@/client/rpc/client";
import { type Bookmark, inOrder } from "@/shared/bookmarks";
import { COMPUTER_ROOT, fileHref } from "@/shared/computer-href";
import {
  type BuiltInPage,
  builtInPages,
  SETTINGS_SECTIONS,
} from "@/shared/instrument-screens";
import {
  chatAddressOf,
  displayHostPath,
  expandHomePath,
  isInstrumentAddress,
} from "@instrument-org/shared";
import { WINDOW_ID } from "@instrument-org/workspace/client";
import { CodeIcon } from "@phosphor-icons/react/Code";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import ms from "ms";
import { unique } from "radashi";
import {
  type ReactNode,
  use,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";

import { AddressMark, AppChip, AppMark } from "./app-chip";
import {
  OmniList,
  type OmniRow,
  SCOPE_PROMPTS,
  ScopeList,
  type ScopeListHandle,
} from "./omnibar-scope";
import { whereOfAddress } from "./row-text";
import { chatListOptions } from "./chat-list-query";
import { bookmarkName } from "./web-start";

/** Rows of each kind past the one Enter takes: three, as the command menu lists. */
const PER_KIND_SHOWN = 3;
/** A folder's names a path reaches, which read as the folder's listing rather than a kind of result. */
const ENTRIES_SHOWN = 8;

/**
 * What a tab's field reaches once it searches no one app (`FieldScope`):
 * the computer from a folder or a file, and the web, with the app's own
 * pages and chats, from anything else.
 */
type OmnibarMode = "files" | "web";

function omnibarModeOf(location: TabLocation): OmnibarMode {
  switch (location.kind) {
    // A file shown as a page is a page: its field takes an address the way a
    // browser's does, and a path still opens the file's own view.
    case "file": {
      return location.asPage ? "web" : "files";
    }
    case "folder": {
      return "files";
    }
    default: {
      return "web";
    }
  }
}

/**
 * What an address in the field opens: in developer mode a debug page's
 * (`debugHrefOf`), which nowhere but the field takes, and otherwise what
 * any address opens (`targetOfAddress`).
 */
function fieldTargetOf(
  address: string,
  isDeveloperMode: boolean,
): AddressTarget | undefined {
  const debugHref = isDeveloperMode ? debugHrefOf(address) : undefined;
  return debugHref === undefined
    ? targetOfAddress(address)
    : { href: debugHref, kind: "screen" };
}

/** What the field says it is for, empty and to a screen reader. */
const PROMPTS: Record<OmnibarMode, string> = {
  files: "Go to a folder or file",
  web: "Search or enter address",
};

/**
 * A tab's address field, which reads what is typed in the terms of what the
 * tab holds (see `OmnibarMode`).
 *
 * In the app's own pages and in a chat, the field searches the app the
 * tab's chip names (`FieldScope`): the chip stays at the field's start as
 * the caret goes in, the way a browser's keyword does once Tab takes it,
 * and the box is empty, since the place has no address a person types.
 * Whatever is typed or pasted there is words to search that app for, an
 * address or a path included, so a link pasted in a chat's field searches
 * the chats for it and opens nothing. Backspace in the empty box puts the
 * chip away, and the field is the general one: the web, the app's pages,
 * chats and bookmarks, where an address opens.
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
  hint,
  initial = "",
  liveAddress,
  location,
  onSite,
  onVisit,
  resting,
  takesCaret = true,
}: {
  /** What the field shows at its end while it is empty and has no caret: the keys that put the caret in it. */
  hint?: ReactNode;
  /** What the field says when it is edited: the place, ready to be typed over. */
  initial?: string;
  /**
   * The address of what is up as it stands when the field is pressed, read
   * then rather than kept: a page's, with wherever it has gone in itself.
   * Undefined when it has none, which leaves `initial`.
   */
  liveAddress?: () => string | undefined;
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
  /** Whether an empty field takes the caret as it arrives; false where something beside it has the caret first. */
  takesCaret?: boolean;
}) {
  const mode = omnibarModeOf(location);
  // The app the field searches while the caret is in it, from where the tab
  // is whenever the caret goes in, until Backspace puts it away.
  const [scope, setScope] = useState(() => fieldScopeOf(location));
  const scopeList = useRef<ScopeListHandle>(null);
  const { openPage, openScreen } = useWindow();
  const isDeveloperMode = useDeveloperMode();
  const router = useRouter();
  const routerLocation = useRouterState({
    select: (routerState) => routerState.location,
  });
  const [
    { canComplete, highlight, isAsked, isEditing, isFocused, place, query },
    send,
  ] = useReducer(
    omnibarField,
    initialOmnibarField(initial, resting === undefined),
  );
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  // What was typed over the place, which is what the rows answer to; the
  // place itself, left as it was, asks for nothing.
  const typed = query.trim() === place.trim() ? "" : query;

  // A new tab the user opened should be ready to type in, but this field also
  // appears when a channel with no tabs is switched to, and there the caret
  // belongs in that channel's composer. So it takes the keyboard as it
  // arrives and only while nothing else is holding it. A field in the tab
  // just left still holds focus here, since a tab behind is only made
  // invisible and focus leaves it at the next style pass, so only a field
  // still on screen counts.
  const takeFocus = useEffectEvent(() => {
    const held = document.activeElement;
    if (
      takesCaret &&
      resting === undefined &&
      !(
        isTypingTarget(held) &&
        held?.checkVisibility({ visibilityProperty: true })
      )
    ) {
      input.current?.focus();
    }
  });
  // Once, as the field arrives.
  useEffect(() => {
    takeFocus();
  }, []);
  // What a press on the field and the chord for it open for typing
  // (`editField`).
  useEffect(() => {
    const box = input.current;
    return box
      ? registerFieldEditor(box, () => {
          send({ type: "edit" });
        })
      : undefined;
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
    noteTypedPage(url);
    (onSite ?? openPage)(url);
  };
  /**
   * Opens any address the field takes, the app's own `instrument://` ones
   * too: in this tab where a tab can stand at it, a path looked for first
   * as a typed one is, and anything else where the app keeps it (a chat is
   * a tab group of its own).
   */
  const openAddress = (address: string) => {
    const target = fieldTargetOf(address, isDeveloperMode);
    if (!target) {
      return;
    }
    if (target.kind === "page") {
      openSite(target.url);
      return;
    }
    const typedPath =
      target.kind === "path" ? typedPathHere(target.path) : undefined;
    if (typedPath) {
      void openPath(typedPath);
      return;
    }
    const href = hrefOfTarget(target);
    if (isGroupScreenHref(href)) {
      visit(href);
    } else {
      openScreen(href);
    }
    leave();
  };
  // Done with: the field goes back to showing the place, or to empty on a
  // new tab, which has no place to show.
  const leave = () => {
    if (resting === undefined) {
      send({ type: "clear" });
    }
    input.current?.blur();
    // What was asked for may be the tab up at another address, whose page
    // then has the keyboard, as in a browser.
    focusScreenHome({ leaving: false });
  };

  /**
   * Opens a folder where the field is, rooted where the tab already is when
   * the folder is under it, so the columns keep their place.
   */
  const openFolder = (host: string) => {
    const home = window.api.homeDir;
    const here = matchScreen(routerLocation.href);
    const currentRoot =
      here.kind === "computer" &&
      here.root !== RECENTS_ROOT &&
      here.root !== COMPUTER_ROOT
        ? here.root
        : undefined;
    const currentRootHost =
      currentRoot === undefined ? undefined : expandHomePath(currentRoot, home);
    // Where the path sits under the tab's root, spelled with slashes as the
    // tab's address is.
    const below =
      currentRootHost === undefined
        ? null
        : host === currentRootHost
          ? ""
          : relativeHostPath(currentRootHost, host);
    visit(
      router.buildLocation({
        search:
          currentRoot !== undefined && below !== null
            ? { path: below === "" ? "" : `${below}/`, root: currentRoot }
            : { path: "", root: host === home ? "~" : host },
        to: "/files",
      }).href,
    );
    leave();
  };
  // A path pressed Return on that led nowhere, kept until the words in the
  // field change: it answers that Return alone, so the same words typed
  // again later are looked for again.
  const [missed, setMissed] = useState<
    undefined | { outcome: MissedPath; typed: string }
  >();
  if (missed !== undefined && missed.typed !== typed.trim()) {
    setMissed(undefined);
  }
  // A path still being looked for, once the look has gone on long enough
  // to say so.
  const [looking, setLooking] = useState<string>();
  /**
   * Opens a typed path where the field is: a folder in this tab, a file as
   * its tab, and a place the system would not let the app read as the folder
   * view saying so, which is where it is undone. A path with nothing at it
   * stays in the field, which says so under the words.
   */
  const openPath = async (path: TypedPath) => {
    if (looking === path.typed) {
      return;
    }
    const located = await locateTypedPath(path, {
      onSlow: () => {
        setLooking(path.typed);
      },
    });
    setLooking(undefined);
    switch (located.kind) {
      case "file": {
        visit(fileHref(located.path));
        leave();
        return;
      }
      case "folder":
      case "refused": {
        openFolder(located.path);
        return;
      }
      case "failed":
      case "missing": {
        setMissed({ outcome: located, typed: path.typed });
        send({ index: 0, type: "highlight" });
      }
    }
  };

  // A chat's field, pressed with nothing typed, lists the newest chats. Any
  // other lists nothing until something is typed: a new tab's page already
  // shows the bookmarks and recent pages, and a page's field holds its
  // address.
  const listsRecents =
    isEditing && isFocused && isAsked && scope === "chat" && query === "";
  const found = useOmnibarRows({
    canComplete,
    // A field searching one app reads none of the general rows.
    isEditing: isEditing && scope === undefined,
    location,
    mode,
    open: { openAddress, openFolder, openPath, openSite, visit },
    typed: scope === undefined ? typed : "",
  });
  // Steady, as the rows a missed path offers are built while rendering and
  // these reach the field itself.
  const missedOpeners = useSteadyCallbacks({ openFolder, openSite });
  const notice =
    missed !== undefined && missed.typed === typed.trim() ? missed : undefined;
  const shownRows = notice
    ? missedRows(notice.outcome, notice.typed, missedOpeners)
    : found;
  const { completion, empty } = shownRows;
  const rows =
    looking === typed.trim()
      ? shownRows.rows.map((row) =>
          row.id === "path" ? { ...row, detail: "Looking…" } : row,
        )
      : shownRows.rows;
  /** The rows the keys go by: a scoped list's as it stands, or the general ones. */
  const rowsNow = () =>
    scope === undefined ? rows : (scopeList.current?.rows() ?? []);
  const current = Math.min(highlight, Math.max(0, rows.length - 1));
  const isListShown = isEditing && (typed.trim() !== "" || listsRecents);
  const picked = scope === undefined && current > 0 ? rows[current] : undefined;
  // The field says what Enter will do: the words with the rest of an address
  // written in ahead of the caret, or the row the arrows are on.
  const shown = picked?.fill ?? `${query}${completion}`;
  const prompt = scope === undefined ? PROMPTS[mode] : SCOPE_PROMPTS[scope];

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
      {/* The app searched, where the place's chip was, while the caret is
          in the box. */}
      {isEditing && scope !== undefined && <AppChip app={scope} nameFolds />}
      <input
        aria-activedescendant={
          isListShown && (scope !== undefined || rows.length > 0)
            ? `${listId}-${scope === undefined ? current : highlight}`
            : undefined
        }
        aria-autocomplete="both"
        aria-controls={isListShown ? listId : undefined}
        aria-expanded={isListShown}
        aria-label={prompt}
        className={cn(
          "h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground",
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
          setScope(fieldScopeOf(location));
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
          setScope(fieldScopeOf(location));
          const live = resting === undefined ? undefined : liveAddress?.();
          // In the box before the selection below, which a render would
          // otherwise move to the end when it wrote the address in.
          if (live !== undefined) {
            event.currentTarget.value = live;
          }
          // A new tab's box is open for typing whatever brought the caret.
          send({ edits: resting === undefined, place: live, type: "focus" });
          // The place, selected whole, so typing replaces it the way it does
          // in a browser's address bar.
          event.currentTarget.select();
        }}
        onPointerDown={() => {
          send({ type: "edit" });
        }}
        onKeyDown={(event) => {
          const now = rowsNow();
          const at = Math.min(highlight, Math.max(0, now.length - 1));
          switch (event.key) {
            case "ArrowDown": {
              event.preventDefault();
              send({
                index: Math.max(0, Math.min(now.length - 1, at + 1)),
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
              send({ index: Math.max(0, at - 1), type: "highlight" });
              break;
            }
            case "Backspace": {
              // In the empty box, the chip goes, and the field is the general
              // one, as a browser's keyword goes.
              const box = event.currentTarget;
              if (
                isEditing &&
                scope !== undefined &&
                box.value === "" &&
                box.selectionStart === 0
              ) {
                event.preventDefault();
                setScope(undefined);
              }
              break;
            }
            case "Enter": {
              event.preventDefault();
              if (listsRecents) {
                run(now[at]);
                break;
              }
              if (typed.trim() !== "") {
                // A path with no row for it (a hidden name, a folder past the
                // listing's cut or refused to it, a listing still on its way)
                // is still opened as typed.
                const typedPath =
                  scope !== undefined || now[at]
                    ? undefined
                    : typedPathHere(typed);
                if (typedPath) {
                  void openPath(typedPath);
                } else {
                  run(now[at]);
                }
                break;
              }
              // Nothing typed over the place, so no list is showing and no
              // row is what was asked for. The place itself, entered as it
              // stands, goes there again the way a browser's address does: a
              // path is opened afresh, and anything else hands the field
              // back to the place. A page that doesn't exist may stand at a
              // tab's own address, which reads as a path and is none.
              const here = query.trim();
              const again =
                location.kind === "missing" ? undefined : typedPathHere(query);
              if (
                isInstrumentAddress(here) &&
                fieldTargetOf(here, isDeveloperMode)
              ) {
                openAddress(here);
              } else if (again) {
                void openPath(again);
              } else if (resting !== undefined) {
                event.currentTarget.blur();
                focusScreenHome({ leaving: false });
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
                focusScreenHome({ leaving: false });
              }
              break;
            }
            case "Tab": {
              // Takes what the field shows, to go on typing from it: a
              // folder's path, ready for a name in it.
              const fill = now[at]?.fill;
              if (isListShown && !event.shiftKey && fill && fill !== query) {
                event.preventDefault();
                takeShown(fill);
              }
              break;
            }
            // No default
          }
        }}
        placeholder={prompt}
        ref={input}
        role="combobox"
        spellCheck={false}
        type="text"
        value={shown}
      />
      {hint !== undefined && query === "" && !isFocused && hint}
      {isListShown && scope !== undefined ? (
        <ScopeList
          current={highlight}
          id={listId}
          location={location}
          onRun={run}
          open={{ openScreen, visit }}
          ref={scopeList}
          scope={scope}
          words={typed}
        />
      ) : null}
      {isListShown && scope === undefined ? (
        <OmniList
          current={current}
          empty={empty}
          id={listId}
          notice={notice ? missedPathNotice(notice.outcome) : undefined}
          onRun={run}
          rows={rows}
        />
      ) : null}
    </>
  );
}

/**
 * The rows the words in the field stand for, in the terms of what the tab
 * holds, the first of them what Enter does, and the rest of a name or an
 * address the field writes in ahead of the caret.
 */
function useOmnibarRows({
  canComplete,
  isEditing,
  location,
  mode,
  open,
  typed,
}: {
  canComplete: boolean;
  /** Whether the field is being typed in, the only time the rows are read. */
  isEditing: boolean;
  location: TabLocation;
  mode: OmnibarMode;
  open: {
    /** Opens any address, the app's own included. */
    openAddress: (address: string) => void;
    openFolder: (host: string) => void;
    openPath: (path: TypedPath) => Promise<void>;
    openSite: (url: string) => void;
    visit: (href: string) => void;
  };
  typed: string;
}): { completion: string; empty?: string; rows: OmniRow[] } {
  const home = window.api.homeDir;
  const words = typed.trim();
  const shell = use(ShellContext);
  const isDeveloperMode = useDeveloperMode();

  // On the web: the pages the window knows, bookmarks ahead of history,
  // whose part is the pages the person goes back to (Chromium's significant
  // ones) rather than every page seen once.
  const visited = useCompletionPages({
    enabled: isEditing && mode === "web",
  });
  const bookmarks = useAtomValue(bookmarksAtom);
  // The app's own addresses kept as bookmarks are the app's places, which
  // the rows below offer by name; the pages are the web's.
  const pages = unique(
    [
      ...bookmarks
        .filter((bookmark) => targetOfAddress(bookmark.url)?.kind === "page")
        .map((bookmark) => ({
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
  // A site's icon is asked for only once the window has been there. An
  // address still being typed, or one the engine suggests, would send every
  // host it spells out on the way to the icon service.
  const visitedHosts = new Set(pages.map((page) => iconHostOf(page.url)));
  const siteIcon = (url: string) =>
    visitedHosts.has(iconHostOf(url)) ? (
      <PageFavicon url={url} />
    ) : (
      <GlobeIcon className="size-4" />
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
  // A pasted path is listed as the path it names, out of its quotes.
  const path = pathQuery(typedPathHere(typed)?.written ?? typed, {
    here,
    home,
  });
  const listing = useQuery(
    computerFolderOptions(
      mode === "files" && words !== ""
        ? { id: WINDOW_ID, path: path.folder }
        : skipToken,
      { staleMs: ms("10 seconds") },
    ),
  );

  // A chat's row says the project it is filed under.
  const chats = useQuery({
    ...chatListOptions(),
    enabled: isEditing && mode === "web",
  }).data;
  const projectNames = new Map(
    (shell?.projects ?? []).map((project) => [project.id, project.name]),
  );
  const projectOfChat = (id: string) => {
    const project = chats?.find((chat) => chat.id === id)?.project;
    return project === undefined ? undefined : projectNames.get(project);
  };

  const { openAddress } = open;
  if (words === "") {
    return { completion: "", rows: [] };
  }
  // The bookmarks the words name, which come before anything but what
  // Enter does with them.
  const markRows = matchBookmarks(words, bookmarks)
    .slice(0, PER_KIND_SHOWN)
    .map((bookmark) => bookmarkRow(bookmark, { openAddress }));
  const isBookmarked = (url: string) =>
    bookmarks.some((bookmark) => sameAddress(bookmark.url, url));

  // An address of the app's own, typed or pasted, is one place.
  const target = isInstrumentAddress(words)
    ? fieldTargetOf(words, isDeveloperMode)
    : undefined;
  if (target) {
    return {
      completion: "",
      rows: [
        {
          icon:
            target.kind === "screen" &&
            matchScreen(target.href).kind === "debug" ? (
              <CodeIcon className="size-4" />
            ) : (
              <AddressMark address={words} className="size-4" />
            ),
          id: "address",
          leavesItself: true,
          name: words,
          run: () => {
            openAddress(words);
          },
        },
      ],
    };
  }

  if (mode === "web") {
    const completion =
      canComplete && typedPathHere(words) === undefined
        ? addressCompletion(typed, pages)
        : "";
    const whole = `${typed}${completion}`.trim();
    const typedPath = typedPathHere(whole);
    const site = typedPath ? undefined : siteFromWords(whole);
    const known = site
      ? pages.find((page) => bareAddress(page.url) === bareAddress(site.url))
      : undefined;
    const searchRow: OmniRow = {
      fill: whole,
      icon: <MagnifyingGlassIcon className="size-4" />,
      id: "search",
      name: webSearchLabel(whole),
      run: () => {
        open.openSite(webSearchUrl(whole));
      },
    };
    const first: OmniRow = typedPath
      ? pathRow(
          shownTypedPath(typedPath),
          () => {
            void open.openPath(typedPath);
          },
          typedFileName(typedPath),
        )
      : site
        ? {
            detail: known?.title,
            fill: whole,
            icon: siteIcon(site.url),
            id: "site",
            name: whole,
            run: () => {
              // A page the window knows opens at the address it was at, the
              // one the field finished the words as.
              open.openSite(known?.url ?? site.url);
            },
          }
        : searchRow;
    const pageRows = matchPages(words, pages)
      .filter((page) => page.url !== known?.url && !isBookmarked(page.url))
      .slice(0, PER_KIND_SHOWN)
      .map(
        (page): OmniRow => ({
          detail: siteOf(page.url),
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
          .slice(0, PER_KIND_SHOWN)
          .map((suggestion): OmniRow => {
            const suggestedSite = siteFromWords(suggestion);
            return {
              fill: suggestion,
              icon: suggestedSite ? (
                siteIcon(suggestedSite.url)
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
    // The app's own places the words name: Enter's when they name one
    // whole, and under it otherwise.
    const appRows = appPlaceRows(words, {
      chatTitles: shell?.chatTitles,
      isBookmarked,
      openAddress,
      projectOfChat,
    });
    // A bookmark or a place of the app's own named whole is what Enter
    // takes.
    const placeRows = [...markRows, ...appRows];
    const named = placeRows.find(
      (row) => row.name.toLowerCase() === words.toLowerCase(),
    );
    return {
      completion: named ? "" : completion,
      rows: named
        ? [
            named,
            ...placeRows.filter((row) => row !== named),
            first,
            ...pageRows,
            ...suggestionRows,
          ]
        : [
            first,
            ...(typedPath?.alsoSearch ? [searchRow] : []),
            ...placeRows,
            ...pageRows,
            ...suggestionRows,
          ],
    };
  }

  // On the computer.
  // A `file://` address to a place in a page (`?frame=2`) opens the page
  // there, the way a browser opens it; any other names a path, which opens
  // the file's own view like the path typed.
  const filePage =
    typedPathHere(words) === undefined ? siteFromWords(words) : undefined;
  const filePagePath = hostPathOfFileUrl(filePage?.url);
  if (filePage && filePagePath !== undefined) {
    return {
      completion: "",
      rows: [
        {
          fill: words,
          icon: (
            <FileTypeIcon
              className="size-4"
              fileName={segmentsOf(filePagePath).at(-1) ?? filePagePath}
            />
          ),
          id: "site",
          name: words,
          run: () => {
            open.openSite(filePage.url);
          },
        },
      ],
    };
  }
  // Only what is there: the folder's own entries, and the folder itself
  // once the words end in it. Nothing is offered at a path with nothing at
  // it, and words that are not a path find names in the folder on screen.
  const isWhole = typedPathHere(words) !== undefined;
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
  // A whole path's names are in a folder other than the one on screen,
  // which each row says, or a name the folder on screen has too (its
  // Documents) reads as that one.
  const elsewhere =
    isWhole &&
    withoutTrailingSeparators(path.folder) !== withoutTrailingSeparators(here);
  const entryRow = (entry: (typeof entries)[number]): OmniRow => ({
    ...(elsewhere ? { detail: segmentsOf(path.folder).at(-1) } : {}),
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
          pathRow(displayHostPath(path.folder, home), () => {
            open.openFolder(path.folder);
          }),
        ]
      : [];
  const [enterRow, ...restRows] = [
    ...folderRows,
    ...(finished ? [entryRow(finished)] : []),
    ...entries
      .filter((entry) => entry !== finished)
      .slice(0, ENTRIES_SHOWN)
      .map(entryRow),
  ];
  // The bookmarks the words name come next to what Enter does, and never
  // in its place: Enter on a path with no row still looks for the path.
  const rows = enterRow ? [enterRow, ...markRows, ...restRows] : [];
  const folderName = displayHostPath(path.folder, home);
  return {
    completion,
    ...(listing.isError
      ? { empty: `There’s nothing at “${folderName}”.` }
      : listed?.kind === "refused"
        ? {
            empty:
              listed.reason === "app"
                ? `“${folderName}” has Instrument’s own files, so it stays closed.`
                : `Instrument can’t read “${displayHostPath(listed.refusedBy ?? path.folder, home)}”`,
          }
        : listed
          ? { empty: `Nothing in “${folderName}” matches “${path.prefix}”.` }
          : {}),
    rows,
  };
}

/**
 * The app's own places whose names start with the words, or a word of them
 * does: a built-in page (Files and each part of Settings among them), and a
 * chat by its title, each but those kept as bookmarks, which have rows of
 * their own. Two letters at least, so a single letter typed on the way to a
 * site's address offers none.
 */
function appPlaceRows(
  words: string,
  {
    chatTitles,
    isBookmarked,
    openAddress,
    projectOfChat,
  }: {
    chatTitles: ReadonlyMap<string, string> | undefined;
    isBookmarked: (address: string) => boolean;
    openAddress: (address: string) => void;
    /** The name of the project a chat is filed under, which its row says. */
    projectOfChat: (id: string) => string | undefined;
  },
): OmniRow[] {
  const lower = words.toLowerCase();
  if (lower.length < 2) {
    return [];
  }
  const named = (name: string) => {
    const lowered = name.toLowerCase();
    return (
      lowered.startsWith(lower) ||
      lowered.split(/[\s\-_./]+/).some((word) => word.startsWith(lower))
    );
  };
  const place = (
    id: string,
    name: string,
    address: string,
    icon: ReactNode,
    detail?: string,
  ): OmniRow => ({
    detail,
    icon,
    id: `place:${id}`,
    name,
    run: () => {
      openAddress(address);
    },
  });
  // A part of Settings by its own name, or by Settings' and then its own.
  const pageNamed = (page: BuiltInPage) => {
    if (page.part === undefined) {
      return named(page.title);
    }
    const part = SETTINGS_SECTIONS[page.part];
    return (
      named(part) ||
      (lower.startsWith("settings ") &&
        `settings ${part.toLowerCase()}`.startsWith(lower))
    );
  };
  const pageRows = builtInPages()
    .filter((page) => pageNamed(page) && !isBookmarked(page.address))
    .map((page) =>
      place(
        page.part === undefined ? page.name : `${page.name}/${page.part}`,
        page.title,
        page.address,
        <AppMark app={page.name} className="size-4" />,
      ),
    );
  const chatRows = [...(chatTitles ?? [])]
    .filter(([id, title]) => named(title) && !isBookmarked(chatAddressOf(id)))
    .map(([id, title]) =>
      place(
        id,
        title,
        chatAddressOf(id),
        <AppMark app="chat" className="size-4" />,
        projectOfChat(id),
      ),
    );
  return [
    ...unique(pageRows, (row) => row.id).slice(0, PER_KIND_SHOWN),
    ...chatRows.slice(0, PER_KIND_SHOWN),
  ];
}

/**
 * The bookmarks the words name, best first: a site's by its address or its
 * name, as the pages the window knows are matched, and a place of the
 * app's own by its name alone, since its address is the app's to spell.
 */
function matchBookmarks(
  words: string,
  bookmarks: readonly Bookmark[],
): Bookmark[] {
  const known = inOrder(bookmarks).map((bookmark) => ({
    bookmark,
    title: bookmark.title,
    url: targetOfAddress(bookmark.url)?.kind === "page" ? bookmark.url : "",
  }));
  return matchPages(words, known).map(({ bookmark }) => bookmark);
}

/**
 * A bookmark as a row, worn as the bar wears it: its mark and its name,
 * after it the site, or the folder a file or a folder is in.
 */
function bookmarkRow(
  bookmark: Bookmark,
  { openAddress }: { openAddress: (address: string) => void },
): OmniRow {
  const target = targetOfAddress(bookmark.url);
  return {
    detail: whereOfAddress(bookmark.url),
    ...(target?.kind === "page" ? { fill: target.url } : {}),
    icon: <AddressMark address={bookmark.url} className="size-4" />,
    id: `bookmark:${bookmark.id}`,
    // A path is looked for first, and the words stay if nothing is there.
    ...(target?.kind === "path" ? { leavesItself: true } : {}),
    name: bookmarkName(bookmark),
    run: () => {
      openAddress(bookmark.url);
    },
  };
}

/** The row that opens a path on the computer, which says it before looking. */
/** The row that opens a path; a file it names by an extension takes that file's icon. */
function pathRow(name: string, run: () => void, fileName?: string) {
  return {
    icon:
      fileName === undefined ? (
        <FileSystemFolderGlyph className="h-3 w-auto" />
      ) : (
        <FileTypeIcon className="size-4" fileName={fileName} />
      ),
    id: "path",
    leavesItself: true,
    name,
    run,
  } satisfies OmniRow;
}

/**
 * The rows under a path that led nowhere: the closest folder above it that
 * opens, and the words as a search, in case they were meant for the web.
 */
function missedRows(
  missed: MissedPath,
  typed: string,
  open: { openFolder: (host: string) => void; openSite: (url: string) => void },
): { completion: string; empty?: string; rows: OmniRow[] } {
  const nearest = missed.kind === "missing" ? missed.nearest : undefined;
  return {
    completion: "",
    rows: [
      ...(nearest === undefined
        ? []
        : [
            {
              detail: "Closest folder",
              icon: <FileSystemFolderGlyph className="h-3 w-auto" />,
              id: "nearest",
              name: displayHostPath(nearest, window.api.homeDir),
              run: () => {
                open.openFolder(nearest);
              },
            } satisfies OmniRow,
          ]),
      {
        icon: <MagnifyingGlassIcon className="size-4" />,
        id: "search",
        name: webSearchLabel(typed),
        run: () => {
          open.openSite(webSearchUrl(typed));
        },
      },
    ],
  };
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
