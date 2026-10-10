import { commandMenuOpenAtom } from "@/client/atoms/command-menu";
import { openSettings, type SettingsTab } from "@/client/atoms/settings-modal";
import { openClearBrowsingData } from "@/client/atoms/clear-browsing-data-modal";
import { openShortcutGuide } from "@/client/atoms/shortcut-guide-modal";
import {
  type AppPlace,
  APPS_HREF,
  bookmarksAtom,
  CHATS_HREF,
} from "@/client/atoms/window";
import { PageFavicon } from "@/client/components/favicon";
import { useRecentPages } from "@/client/hooks/use-browser-history";
import { useRecentFiles } from "@/client/hooks/use-recent-files";
import { FileTypeIcon } from "@/client/components/extend/file-system";
import { folderOf, homeRelative } from "@/client/components/window/host-path";
import { fileHref } from "@/shared/computer-href";
import { FuzzyHighlight } from "@/client/components/fuzzy-highlight";
import { useTheme } from "@/client/components/theme-provider";
import {
  CommandDialog,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/client/components/ui/command";
import { Spinner } from "@/client/components/ui/spinner";
import { AppIcon } from "@/client/components/window/app-icon";
import { PLACES } from "@/client/components/window/app-rail";
import { useAppsBySlug } from "@/client/components/window/apps-by-slug";
import { byActivity, type Chat } from "@/client/components/window/chats";
import { PlaceIcon } from "@/client/components/window/place-icons";
import { useShell } from "@/client/components/window/shell-context";
import { useChatSearchFallback } from "@/client/components/window/use-chat-search-fallback";
import { useHoldWindow } from "@/client/hooks/use-hold-window";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { formatAccelerator } from "@/client/lib/format-accelerator";
import { joinFuzzyFields } from "@/client/lib/join-fuzzy-fields";
import { webSearchUrl } from "@/client/lib/resolve-url-or-search";
import { siteFromWords } from "@/client/lib/site-from-words";
import {
  bareAddress,
  isSearchWords,
} from "@/client/components/window/omnibar-match";
import {
  componentPages,
  debugNavigationRoutes,
  onboardingScreens,
} from "@/client/routes/debug/-debug-routes";
import { scenarios } from "@/client/routes/debug/-transcript/scenarios";
import { rpcClient } from "@/client/rpc/client";
import { SHORTCUT_GUIDE } from "@/shared/shortcut-guide";
import { SHORTCUTS, type ShortcutAccelerator } from "@/shared/shortcuts";
import {
  WINDOW_SHORTCUTS,
  type WindowShortcutId,
} from "@/shared/window-shortcuts";
import uFuzzy from "@leeoniya/ufuzzy";
import { BroomIcon } from "@phosphor-icons/react/Broom";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/ArrowsClockwise";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { CodeIcon } from "@phosphor-icons/react/Code";
import { FlaskIcon } from "@phosphor-icons/react/Flask";
import { GearIcon } from "@phosphor-icons/react/Gear";
import { KeyboardIcon } from "@phosphor-icons/react/Keyboard";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { MonitorIcon } from "@phosphor-icons/react/Monitor";
import { MoonIcon } from "@phosphor-icons/react/Moon";
import { NotePencilIcon } from "@phosphor-icons/react/NotePencil";
import { NewspaperIcon } from "@phosphor-icons/react/Newspaper";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { SunIcon } from "@phosphor-icons/react/Sun";
import { WrenchIcon } from "@phosphor-icons/react/Wrench";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAtom, useAtomValue } from "jotai";
import { unique } from "radashi";
import { type ReactNode, useDeferredValue, useRef, useState } from "react";
import { toast } from "@/client/lib/toast";

const fuzzy = new uFuzzy({ intraMode: 1 });

/** Rows per kind past which a search stops listing: enough to choose from, few enough to read. */
const APPS_SHOWN = 6;
const PAGES_SHOWN = 6;
const FILES_SHOWN = 6;
/** How long a search has to be before the decision model is asked what it means. */
const MEANING_MIN_LENGTH = 3;
/** Chats listed before anything is typed, newest first. */
const RECENT_CHATS_SHOWN = 5;
/**
 * The commands listed before anything is typed: the ones worth reaching
 * often, each with its chord. The rest (the theme, clearing browsing data,
 * updates) are found by typing.
 */
const LISTED_COMMANDS = new Set([
  "new-chat",
  "new-tab",
  "settings",
  "shortcuts",
]);

/** Each place's chord, which its Go to row shows. */
const PLACE_CHORDS = {
  apps: "goToApps",
  browser: "goToBrowser",
  chat: "goToChat",
  files: "goToFiles",
} as const satisfies Record<AppPlace, WindowShortcutId>;

export const COMMAND_MENU_PLACEHOLDER = "Search or type an address";

type Item = {
  chord?: ShortcutAccelerator;
  detail?: string | undefined;
  icon: ReactNode;
  id: string;
  label: string;
  ranges: null | number[];
  run: () => void;
  type: "item";
};

type Row =
  | { label: string; type: "header" }
  /** The decision model still reading the chats, in the place its rows will take. */
  | { type: "looking" }
  | Item;

/** Where the menu is drawn: over the window by Cmd+K, or as a new tab's page. */
export type CommandMenuSurface = "dialog" | "page";

/**
 * The menu's rows for the words typed, the same wherever it is drawn: what
 * the words name (an address to open, the places, commands, chats, the apps
 * set up here, pages, files), then a web search for words that are a search, then, when
 * nothing matched by name and the words are no address, the chats the
 * decision model says they mean, below the search so Return never changes
 * under the caret. Before anything is typed, the places, the commands worth
 * reaching often, and the newest chats. Words
 * starting `!` reach the switches kept out of sight: `!dev` and `!beta`.
 *
 * The rows follow the words a beat behind while typing, so the field keeps
 * up with the keys; `words` in the result is what the rows are for.
 */
export function useCommandMenuRows({
  active,
  done,
  openPage,
  openScreen,
  surface,
  words: typed,
}: {
  /** Whether the menu is on screen, for what it reads off the disk or asks the model. */
  active: boolean;
  /** Wraps a row's action: the dialog gets out of the way first. */
  done: (run: () => void) => () => void;
  openPage: (url: string) => void;
  openScreen: (href: string) => void;
  surface: CommandMenuSurface;
  words: string;
}): { isBang: boolean; rows: Row[]; words: string } {
  const words = useDeferredValue(typed);
  const shell = useShell();
  const { setTheme, theme } = useTheme();
  const developerMode = useDeveloperMode();
  // The apps set up here, by the names the window has for them: one only in
  // the directory is no place to go yet.
  const appsBySlug = useAppsBySlug();
  const installed = useQuery(
    rpcClient.apps.live.list.experimental_liveOptions(),
  );
  const visited = useRecentPages();
  // Described only while the menu is up: each file is looked at on the disk.
  const recentFiles = useRecentFiles({ enabled: active }).files;
  const bookmarks = useAtomValue(bookmarksAtom);

  const preferences = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  const setDeveloperMode = useMutation(
    rpcClient.preferences.setDeveloperMode.mutationOptions(),
  );
  const setReleaseChannel = useMutation(
    rpcClient.preferences.setReleaseChannel.mutationOptions(),
  );
  const checkForUpdates = useMutation(
    rpcClient.preferences.checkForUpdates.mutationOptions(),
  );
  const simulateNoUpdate = useMutation(
    rpcClient.debug.trigger.testNoUpdateNotification.mutationOptions(),
  );

  const chats = shell.chats ?? [];
  const isPage = surface === "page";

  const commands: Omit<Item, "ranges" | "type">[] = [
    {
      chord: WINDOW_SHORTCUTS.newChat.accelerator,
      icon: <NotePencilIcon />,
      id: "new-chat",
      label: "New chat",
      run: () => {
        shell.newDraft();
      },
    },
    // A new tab opening another from its own menu would only stand beside it.
    ...(isPage
      ? []
      : [
          {
            chord: WINDOW_SHORTCUTS.newTab.accelerator,
            icon: <PlusIcon />,
            id: "new-tab",
            label: "New tab",
            run: shell.appTabs.openNewTab,
          },
        ]),
    {
      chord: SHORTCUTS.settings.accelerator,
      icon: <GearIcon />,
      id: "settings",
      label: "Settings",
      run: () => {
        openSettings({ tab: "General" });
      },
    },
    {
      chord: SHORTCUT_GUIDE.accelerator,
      icon: <KeyboardIcon />,
      id: "shortcuts",
      label: "Keyboard shortcuts",
      run: openShortcutGuide,
    },
    {
      icon: <BroomIcon />,
      id: "clear-browsing-data",
      label: "Clear browsing data",
      run: openClearBrowsingData,
    },
    ...(
      [
        { icon: <SunIcon />, label: "Light", value: "light" },
        { icon: <MoonIcon />, label: "Dark", value: "dark" },
        { icon: <MonitorIcon />, label: "System", value: "system" },
      ] as const
    ).map(({ icon, label, value }) => ({
      detail: theme === value ? "Current" : undefined,
      icon,
      id: `theme-${value}`,
      label: `Theme: ${label}`,
      run: () => {
        setTheme(value);
      },
    })),
    {
      icon: <ArrowsClockwiseIcon />,
      id: "check-for-updates",
      label: "Check for updates",
      run: () => {
        if (import.meta.env.DEV) {
          simulateNoUpdate.mutate(undefined);
        } else {
          checkForUpdates.mutate({ notify: true });
        }
      },
    },
    {
      icon: <NewspaperIcon />,
      id: "release-notes",
      label: "Release notes",
      run: () => {
        openScreen("/release-notes");
      },
    },
  ];

  // The switches answer to their word alone, from three letters on, and
  // nothing else is listed beside them.
  const isBang = words.startsWith("!");
  const bangRows: Item[] = [];
  if (isBang && words.length >= 3) {
    const lower = words.toLowerCase();
    const isBeta = preferences.data?.releaseChannel === "beta";
    const switches = [
      {
        icon: <WrenchIcon />,
        id: "developer-mode",
        label: developerMode
          ? "Turn off developer mode"
          : "Turn on developer mode",
        run: () => {
          setDeveloperMode.mutate({ enabled: !developerMode });
          toast(developerMode ? "Developer mode off" : "Developer mode on");
        },
        word: "!dev",
      },
      {
        icon: <FlaskIcon />,
        id: "beta-channel",
        label: isBeta ? "Leave the beta channel" : "Join the beta channel",
        run: () => {
          setReleaseChannel.mutate({ channel: isBeta ? undefined : "beta" });
          toast(isBeta ? "Beta channel removed" : "Beta channel enabled");
        },
        word: "!beta",
      },
    ];
    for (const { word, ...row } of switches) {
      if (word.startsWith(lower)) {
        bangRows.push({ ...row, ranges: null, type: "item" });
      }
    }
  }

  // Each tab of Settings by name, found by typing it and never listed
  // before, so the empty menu stays short. General is the Settings row
  // itself; the tabs for building the app only show in developer mode.
  const settingsTabs: SettingsTab[] = [
    "Providers",
    "Skills",
    "Memory",
    "Storage",
    ...(developerMode ? (["Features", "Debug"] as const) : []),
  ];
  const settingsRows = settingsTabs.map((tab) => ({
    icon: <GearIcon />,
    id: `settings-${tab}`,
    label: `Settings: ${tab}`,
    run: () => {
      openSettings({ tab });
    },
  }));

  const debugItems = developerMode
    ? [
        ...debugNavigationRoutes.map((route) => ({
          href: route.to,
          label: route.label,
        })),
        ...componentPages.map((page) => ({
          href: page.to,
          label: `Component: ${page.label}`,
        })),
        ...onboardingScreens.map((screen) => ({
          href: screen.to,
          label: `Onboarding: ${screen.label}`,
        })),
        ...scenarios.map((scenario) => ({
          href: `/debug/components/transcript?scenario=${encodeURIComponent(scenario.id)}`,
          label: `Transcript: ${scenario.name}`,
        })),
      ]
    : [];

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

  const isSearch = words !== "" && !isBang;
  const site = isSearch ? siteFromWords(words) : undefined;
  const chatMatches = isSearch
    ? nameMatch(byActivity(chats), (chat) => [chat.title], words)
    : [];
  const appMatches = isSearch
    ? nameMatch(
        [...appsBySlug].filter(([slug]) =>
          installed.data?.apps.some((app) => app.slug === slug),
        ),
        ([, app]) => [app.name],
        words,
      ).slice(0, APPS_SHOWN)
    : [];

  const goTo: Item[] = PLACES.map(({ id, label }) => ({
    chord: WINDOW_SHORTCUTS[PLACE_CHORDS[id]].accelerator,
    icon: <PlaceIcon place={id} />,
    id: `goto:${id}`,
    label,
    ranges: null,
    run: () => {
      shell.goToPlace(id);
    },
    type: "item",
  }));

  const named: { items: Item[]; label: string }[] = isSearch
    ? [
        {
          items: fuzzyMatch(goTo, (item) => [item.label], words).map(
            ({ item, ranges }) => ({ ...item, ranges }),
          ),
          label: "Go to",
        },
        {
          items: fuzzyMatch(
            [...commands, ...settingsRows],
            (command) => [command.label],
            words,
          ).map(({ item, ranges }) => ({ ...item, ranges, type: "item" })),
          label: "Commands",
        },
        {
          items: chatMatches.map(({ item, ranges }) => chatItem(item, ranges)),
          label: "Chats",
        },
        {
          items: appMatches.map(({ item: [slug, app], ranges }) =>
            appItem(slug, app, ranges),
          ),
          label: "Apps",
        },
        {
          items: fuzzyMatch(
            pages,
            (page) => [page.title || bareAddress(page.url), page.url],
            words,
          )
            .slice(0, PAGES_SHOWN)
            .map(({ item: page, ranges }) => ({
              detail: page.title ? bareAddress(page.url) : undefined,
              icon: <PageFavicon favicon={page.favicon} url={page.url} />,
              id: `page:${page.url}`,
              label: page.title || bareAddress(page.url),
              ranges,
              run: () => {
                openPage(page.url);
              },
              type: "item",
            })),
          label: "Recent pages",
        },
        {
          items: fuzzyMatch(
            recentFiles,
            (file) => [file.name, homeRelative(file.path, window.api.homeDir)],
            words,
          )
            .slice(0, FILES_SHOWN)
            .map(({ item: file, ranges }) => ({
              detail: homeRelative(folderOf(file.path), window.api.homeDir),
              icon: <FileTypeIcon fileName={file.name} />,
              id: `file:${file.path}`,
              label: file.name,
              ranges,
              run: () => {
                openScreen(fileHref(file.path));
              },
              type: "item",
            })),
          label: "Recent files",
        },
        {
          items: fuzzyMatch(
            debugItems,
            (item) => [item.label, item.href],
            words,
          ).map(({ item, ranges }) => ({
            icon: <CodeIcon />,
            id: `debug:${item.href}`,
            label: item.label,
            ranges,
            run: () => {
              openScreen(item.href);
            },
            type: "item",
          })),
          label: "Debug pages",
        },
      ]
    : [];

  // Words that find nothing by name go to the decision model, so a search
  // like "taxes" finds the chat about 1099 forms. Only then, and never for
  // an address: the model is not asked about searches the names answer, or
  // about a site the person is on their way to.
  const hasNameMatches = named.some((section) => section.items.length > 0);
  const asksMeaning =
    active &&
    isSearch &&
    site === undefined &&
    words.length >= MEANING_MIN_LENGTH &&
    !hasNameMatches;
  const chatsByMeaning = useChatSearchFallback({
    active: asksMeaning,
    candidates: chats,
    search: words,
  });

  const sections: { items: Item[]; label: string; looking?: boolean }[] = isBang
    ? [{ items: bangRows, label: "Switches" }]
    : words === ""
      ? [
          { items: goTo, label: "Go to" },
          {
            items: commands
              .filter((command) => LISTED_COMMANDS.has(command.id))
              .map((command) => ({ ...command, ranges: null, type: "item" })),
            label: "Commands",
          },
          {
            items: byActivity(chats.filter((chat) => !chat.archived))
              .slice(0, RECENT_CHATS_SHOWN)
              .map((chat) => chatItem(chat, null)),
            label: "Recent chats",
          },
        ]
      : [
          ...(site
            ? [
                {
                  items: [
                    {
                      detail: isPage ? "Open in this tab" : "Open in a new tab",
                      icon: <PageFavicon url={site.url} />,
                      id: `open:${site.url}`,
                      label: words,
                      ranges: null,
                      run: () => {
                        openPage(site.url);
                      },
                      type: "item" as const,
                    },
                  ],
                  label: "Open",
                },
              ]
            : []),
          ...named,
          ...(site === undefined && isSearchWords(words)
            ? [
                {
                  items: [
                    {
                      icon: <MagnifyingGlassIcon />,
                      id: "web-search",
                      label: `Search the web for “${words}”`,
                      ranges: null,
                      run: () => {
                        openPage(webSearchUrl(words));
                      },
                      type: "item" as const,
                    },
                  ],
                  label: "Web",
                },
              ]
            : []),
          {
            items: chatsByMeaning.chats.map((chat) => chatItem(chat, null)),
            label: "Chats about this",
            looking: asksMeaning && chatsByMeaning.isLooking,
          },
        ];

  function appItem(
    slug: string,
    app: { icon?: string | undefined; name: string; site: string | undefined },
    ranges: null | number[],
  ): Item {
    return {
      icon: (
        <AppIcon icon={app.icon} name={app.name} site={app.site} size="sm" />
      ),
      id: `app:${slug}`,
      label: app.name,
      ranges,
      run: () => {
        openScreen(`${APPS_HREF}/${slug}`);
      },
      type: "item",
    };
  }

  function chatItem(chat: Chat, ranges: null | number[]): Item {
    return {
      detail: chat.archived ? "Archived" : undefined,
      icon: <ChatCircleIcon />,
      id: `chat:${chat.id}`,
      label: chat.title,
      ranges,
      run: () => {
        openScreen(`${CHATS_HREF}/${chat.id}`);
      },
      type: "item",
    };
  }

  const rows: Row[] = sections.flatMap((section): Row[] =>
    section.items.length === 0 && !section.looking
      ? []
      : [
          { label: section.label, type: "header" },
          ...section.items.map((item) => ({ ...item, run: done(item.run) })),
          ...(section.looking ? [{ type: "looking" as const }] : []),
        ],
  );
  return { isBang, rows, words };
}

/**
 * The menu's list, one height whatever the search finds, so it does not
 * grow and shrink under the caret as results come and go.
 */
export function CommandMenuList({
  className,
  isBang,
  rows,
  words,
}: {
  className: string;
  isBang: boolean;
  rows: Row[];
  words: string;
}) {
  return (
    <CommandList className={className}>
      {rows.length > 0 ? (
        // A list of its own per search: a fresh scroller starts at the top,
        // where cmdk's pick of the first row then lands, rather than at
        // wherever the last search's list was scrolled to.
        <ResultRows key={words} rows={rows} />
      ) : words !== "" && !(isBang && words.length < 3) ? (
        <div className="flex h-full flex-col items-center justify-center gap-1 text-sm text-muted-foreground">
          Nothing matches “{words}”
        </div>
      ) : null}
    </CommandList>
  );
}

/** The window's command menu (Cmd+K), over whatever is on screen. */
export function CommandMenu({
  openPage,
  openScreen,
}: {
  openPage: (url: string) => void;
  openScreen: (href: string) => void;
}) {
  const [open, setOpen] = useAtom(commandMenuOpenAtom);
  const [search, setSearch] = useState("");

  const close = () => {
    setOpen(false);
    // After the close animation, so the list does not visibly empty first.
    setTimeout(() => {
      setSearch("");
    }, 200);
  };
  useHoldWindow(open, { onClose: close });

  const { isBang, rows, words } = useCommandMenuRows({
    active: open,
    // A row's action, run once the menu is out of the way.
    done: (run) => () => {
      close();
      run();
    },
    openPage,
    openScreen,
    surface: "dialog",
    words: search.trim(),
  });

  return (
    <CommandDialog
      description="Run a command or go to a chat, an app, a page, or a file"
      onOpenChange={(value) => {
        if (value) {
          setOpen(true);
        } else {
          close();
        }
      }}
      open={open}
      shouldFilter={false}
      showCloseButton={false}
      title="Command menu"
    >
      <CommandInput
        onValueChange={setSearch}
        placeholder={COMMAND_MENU_PLACEHOLDER}
        value={search}
      />
      <CommandMenuList
        className="h-96 max-h-none! overflow-hidden!"
        isBang={isBang}
        rows={rows}
        words={words}
      />
    </CommandDialog>
  );
}

/**
 * Every section in one virtualized, single-scroll region, so a workspace with
 * thousands of chats keeps the menu a normal height and a quick render.
 */
function ResultRows({ rows }: { rows: Row[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    estimateSize: (i) => (rows[i]?.type === "header" ? 28 : 36),
    getScrollElement: () => parentRef.current,
    // Rows on the first render, before the scroller is measured, so cmdk
    // finds the top row there when it picks one for the new search.
    initialRect: { height: 512, width: 0 },
    // Layout px, not the on-screen rect: the menu sits inside CSS `zoom`.
    measureElement: (el) => el.offsetHeight,
    overscan: 8,
  });

  return (
    <div className="h-full overflow-y-auto p-1" ref={parentRef}>
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const row = rows[virtualItem.index];
          if (!row) {
            return null;
          }
          return (
            <div
              className="absolute top-0 left-0 w-full"
              data-index={virtualItem.index}
              key={virtualItem.key}
              ref={virtualizer.measureElement}
              style={{ transform: `translateY(${virtualItem.start}px)` }}
            >
              {row.type === "header" ? (
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  {row.label}
                </div>
              ) : row.type === "looking" ? (
                <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                  <Spinner className="size-4" />
                  Looking through your chats…
                </div>
              ) : (
                <CommandItem onSelect={row.run} value={row.id}>
                  <span className="flex size-4 shrink-0 items-center justify-center opacity-60">
                    {row.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    <FuzzyHighlight ranges={row.ranges} text={row.label} />
                    {row.detail ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {row.detail}
                      </span>
                    ) : null}
                  </span>
                  {row.chord === undefined ? (
                    // Return runs the row picked, so it says so.
                    <CommandShortcut className="hidden in-data-[selected=true]:inline">
                      ↩
                    </CommandShortcut>
                  ) : (
                    <CommandShortcut>
                      {formatAccelerator(row.chord).join("")}
                    </CommandShortcut>
                  )}
                </CommandItem>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The items the words match by name: every word, and when no item has every
 * word, any one of them, items with more of the words first. The second is
 * how "fart related" finds both "fart.com" and "farts" without asking the
 * decision model; words under three letters do not count on their own.
 */
function nameMatch<T>(
  items: T[],
  fieldsOf: (item: T) => string[],
  words: string,
): { item: T; ranges: null | number[] }[] {
  const all = fuzzyMatch(items, fieldsOf, words);
  const terms = words.split(/\s+/).filter((term) => term.length >= 3);
  if (all.length > 0 || terms.length < 2) {
    return all;
  }
  const found = new Map<T, { count: number; ranges: null | number[] }>();
  for (const term of terms) {
    for (const { item, ranges } of fuzzyMatch(items, fieldsOf, term)) {
      const seen = found.get(item);
      found.set(item, {
        count: (seen?.count ?? 0) + 1,
        ranges: seen?.ranges ?? ranges,
      });
    }
  }
  return [...found]
    .toSorted(([, a], [, b]) => b.count - a.count)
    .map(([item, { ranges }]) => ({ item, ranges }));
}

/**
 * The items the words fuzzily match, best first, each with the highlight
 * ranges of its first field, which is the one a row shows. The other fields
 * are searched too, so an address finds a page shown by its title.
 */
function fuzzyMatch<T>(
  items: T[],
  fieldsOf: (item: T) => string[],
  words: string,
): { item: T; ranges: null | number[] }[] {
  if (items.length === 0) {
    return [];
  }
  const joined = items.map((item) => joinFuzzyFields(fieldsOf(item)));
  const haystack = joined.map((entry) => entry.haystack);
  // oxlint-disable-next-line unicorn/no-array-method-this-argument
  const indexes = fuzzy.filter(haystack, words);
  if (!indexes || indexes.length === 0) {
    return [];
  }
  const info = fuzzy.info(indexes, haystack, words);
  const order = fuzzy.sort(info, haystack, words);
  return order.flatMap((orderIndex) => {
    const index = info.idx[orderIndex] ?? -1;
    const item = items[index];
    const fields = joined[index];
    if (item === undefined || !fields) {
      return [];
    }
    const [ranges] = fields.splitRanges(info.ranges[orderIndex] ?? null);
    return [{ item, ranges: ranges ?? null }];
  });
}
