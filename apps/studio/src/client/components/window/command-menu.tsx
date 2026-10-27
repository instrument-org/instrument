import { commandMenuOpenAtom } from "@/client/atoms/command-menu";
import { openSettings } from "@/client/atoms/settings-modal";
import { openClearBrowsingData } from "@/client/atoms/clear-browsing-data-modal";
import { openShortcutGuide } from "@/client/atoms/shortcut-guide-modal";
import { type AppPlace, APPS_HREF, CHATS_HREF } from "@/client/atoms/window";
import { bookmarksAtom } from "@/client/bookmarks/store";
import { PageFavicon } from "@/client/components/favicon";
import { useRecentPages } from "@/client/hooks/use-browser-history";
import { useRecentFiles } from "@/client/hooks/use-recent-files";
import {
  FileSystemFolderGlyph,
  FileTypeIcon,
} from "@/client/components/extend/file-system";
import { useSettingsTabs } from "@/client/components/settings/use-settings-tabs";
import { folderOf } from "@/client/components/window/host-path";
import { displayPath } from "@/client/lib/path-utils";
import { fileHref, folderHref } from "@/shared/computer-href";
import { FuzzyHighlight } from "@/client/components/fuzzy-highlight";
import { useTheme } from "@/client/components/theme-provider";
import { CommandShortcut } from "@/client/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Spinner } from "@/client/components/ui/spinner";
import { AppIcon } from "@/client/components/window/app-icon";
import { PLACES } from "@/client/components/window/app-rail";
import { useAppsBySlug } from "@/client/components/window/apps-by-slug";
import { ChatMarkDot } from "@/client/components/window/chat-mark";
import { TopicPill } from "@/client/components/window/chat-row";
import {
  byLastUserMessage,
  type Chat,
  railMarkOf,
  type Topic,
  topicSearch,
} from "@/client/components/window/chats";
import { FolderMark } from "@/client/components/window/folder-mark";
import { PlaceIcon } from "@/client/components/window/place-icons";
import { useShell } from "@/client/components/window/shell-context";
import { TopicMark } from "@/client/components/window/topic-mark";
import { useChatSearchFallback } from "@/client/components/window/use-chat-search-fallback";
import { useModalBack } from "@/client/hooks/use-modal-back";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { formatAcceleratorText } from "@/client/lib/format-accelerator";
import { joinFuzzyFields } from "@/client/lib/join-fuzzy-fields";
import {
  locateTypedPath,
  type MissedPath,
  missedPathNotice,
  shownTypedPath,
  typedPathHere,
} from "@/client/lib/locate-typed-path";
import { typedFileName } from "@/client/lib/typed-path";
import {
  webSearchLabel,
  webSearchUrl,
} from "@/client/lib/resolve-url-or-search";
import { siteFromWords } from "@/client/lib/site-from-words";
import { iconHostOf } from "@/client/lib/favicon-url";
import { cn, osConventions } from "@/client/lib/utils";
import {
  bareAddress,
  isSearchWords,
} from "@/client/components/window/omnibar-match";
import {
  componentPages,
  debugNavigationRoutes,
} from "@/client/routes/debug/-debug-routes";
import { scenarios } from "@/client/routes/debug/-transcript/scenarios";
import { rpcClient } from "@/client/rpc/client";
import { SHORTCUT_GUIDE } from "@/shared/shortcut-guide";
import { SHORTCUTS, type ShortcutAccelerator } from "@/shared/shortcuts";
import {
  WINDOW_SHORTCUTS,
  type WindowShortcutId,
} from "@/shared/window-shortcuts";
import { boundedFuzzy } from "@/client/lib/bounded-fuzzy";
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
import { StarIcon } from "@phosphor-icons/react/Star";
import { SunIcon } from "@phosphor-icons/react/Sun";
import { WrenchIcon } from "@phosphor-icons/react/Wrench";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAtom, useAtomValue } from "jotai";
import { unique } from "radashi";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
} from "react";
import { displayHostPath, folderNameFromPath } from "@instrument-org/shared";
import { NO_SIDEBAR_CHANGES, pinnedPlaces } from "@/shared/sidebar-places";
import { toast } from "@/client/lib/toast";

const fuzzy = boundedFuzzy({ intraMode: 1 });

/** Rows per kind past which a search stops listing: enough to choose from, few enough to read. */
const APPS_SHOWN = 6;
const PAGES_SHOWN = 6;
const FOLDERS_SHOWN = 6;
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
  /** The dot a chat wears on its icon in a tab: a reply not yet seen, or a question waiting. */
  dot?: "unread" | "waiting" | undefined;
  icon: ReactNode;
  id: string;
  label: string;
  /**
   * Whether the row puts the menu away itself, once it knows it has gone
   * somewhere: a path is looked for first, and the menu stays with the words
   * when nothing is there.
   */
  leavesItself?: true;
  ranges: null | number[];
  run: () => void;
  /** Marks past the label, as a chat's row in the list wears its topic and star. */
  trailing?: ReactNode;
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
 * up with the keys; `words` in the result is what the rows are for, and
 * `selection` is the row Return runs and the keys that move it, for the
 * field and the list to share.
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
}): {
  isBang: boolean;
  rows: Row[];
  selection: Selection;
  words: string;
} {
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
  const places = useQuery(rpcClient.workspace.computer.places.queryOptions());

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
          checkForUpdates.mutate();
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
  // before, so the empty menu stays short: the tabs the Settings sidebar
  // lists, but General, which is the Settings row itself.
  const settingsTabs = useSettingsTabs().filter((tab) => tab !== "General");
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
        ...scenarios.map((scenario) => ({
          href: `/debug/components/transcript?scenario=${encodeURIComponent(scenario.id)}`,
          label: `Transcript: ${scenario.name}`,
        })),
      ]
    : [];

  const bookmarkPages = unique(
    bookmarks.map((bookmark) => ({
      favicon: undefined,
      title: bookmark.title,
      url: bookmark.url,
    })),
    (page) => page.url,
  );
  const bookmarked = new Set(bookmarkPages.map((page) => page.url));
  const recentPages = unique(
    visited
      .filter((page) => !bookmarked.has(page.url))
      .map((page) => ({
        favicon: page.favicon,
        title: page.title,
        url: page.url,
      })),
    (page) => page.url,
  );
  const pages = [...bookmarkPages, ...recentPages];

  // The folders the Files sidebar lists, in its order: the Instrument
  // folder, then Pinned as the person left it, then the disks and the cloud
  // services' folders.
  const sidebarPlaces = preferences.data?.sidebarPlaces ?? NO_SIDEBAR_CHANGES;
  const instrumentPlace = places.data?.pinned.find(
    (place) => place.kind === "output",
  );
  const folders = [
    ...(instrumentPlace ? [instrumentPlace] : []),
    ...pinnedPlaces(
      (places.data?.pinned ?? []).filter((place) => place !== instrumentPlace),
      sidebarPlaces,
      (path) => ({ name: folderNameFromPath(path), path }),
    ),
    ...(places.data?.volumes ?? []),
  ];

  const isSearch = words !== "" && !isBang;
  const typedPath = isSearch ? typedPathHere(words) : undefined;
  const typedFile = typedPath && typedFileName(typedPath);
  const site = isSearch && !typedPath ? siteFromWords(words) : undefined;
  const isKnownSite =
    site !== undefined &&
    pages.some((page) => iconHostOf(page.url) === iconHostOf(site.url));
  // A path pressed Return on that led nowhere, kept until the words change:
  // it answers that Return alone, so the same words typed again later are
  // looked for again.
  const [missedAt, setMissedAt] = useState<
    undefined | { outcome: MissedPath; typed: string }
  >();
  if (missedAt !== undefined && missedAt.typed !== typed.trim()) {
    setMissedAt(undefined);
  }
  // A path still being looked for, once the look has gone on long enough
  // to say so.
  const [looking, setLooking] = useState<string>();
  const missed =
    typedPath !== undefined && missedAt?.typed === typedPath.typed
      ? missedAt.outcome
      : undefined;
  // Where a typed path goes once the menu is out of the way: a folder, or a
  // place the system would not let the app read, to the folder view, which
  // says so and is where it is undone; a file to its own view.
  const openTypedPath = async () => {
    if (!typedPath) {
      return;
    }
    if (looking === typedPath.typed) {
      return;
    }
    const located = await locateTypedPath(typedPath, {
      onSlow: () => {
        setLooking(typedPath.typed);
      },
    });
    setLooking(undefined);
    if (located.kind === "failed" || located.kind === "missing") {
      setMissedAt({ outcome: located, typed: typedPath.typed });
      return;
    }
    done(() => {
      openScreen(
        located.kind === "file"
          ? fileHref(located.path)
          : folderHref(located.path),
      );
    })();
  };
  const webSearchItem: Item = {
    icon: <MagnifyingGlassIcon />,
    id: "web-search",
    label: webSearchLabel(words),
    ranges: null,
    run: () => {
      openPage(webSearchUrl(words));
    },
    type: "item",
  };
  const nearest = missed?.kind === "missing" ? missed.nearest : undefined;
  const pathSection: { items: Item[]; label: string }[] =
    typedPath === undefined
      ? []
      : missed
        ? [
            {
              // The first takes the place of the path's own row under the
              // same value, so the pick stays on the row Return now runs.
              items: [
                ...(nearest === undefined
                  ? []
                  : [
                      {
                        detail: "Closest folder",
                        icon: <FileSystemFolderGlyph className="h-3 w-auto" />,
                        id: "nearest-folder",
                        label: displayHostPath(nearest, window.api.homeDir),
                        ranges: null,
                        run: () => {
                          openScreen(folderHref(nearest));
                        },
                        type: "item" as const,
                      },
                    ]),
                webSearchItem,
              ].map((item, index) =>
                index === 0 ? { ...item, id: "open-path" } : item,
              ),
              label: missedPathNotice(missed),
            },
          ]
        : [
            {
              items: [
                {
                  ...(looking === typedPath.typed
                    ? { detail: "Looking…" }
                    : {}),
                  icon:
                    typedFile === undefined ? (
                      <FileSystemFolderGlyph className="h-3 w-auto" />
                    ) : (
                      <FileTypeIcon className="size-4" fileName={typedFile} />
                    ),
                  id: "open-path",
                  label: shownTypedPath(typedPath),
                  leavesItself: true,
                  ranges: null,
                  run: () => {
                    void openTypedPath();
                  },
                  type: "item",
                },
                ...(typedPath.alsoSearch ? [webSearchItem] : []),
              ],
              label: "Open",
            },
          ];
  const chatMatches = isSearch
    ? nameMatch(byLastUserMessage(chats), (chat) => [chat.title], words)
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
  // A topic is found by its name, and by the word for one: "topic" alone
  // lists them all, and beside a name it is left out of what the name is
  // matched by, so "topic reading" and "reading topic" both find Reading.
  // Every word left has to be in the name, since a topic that shared one
  // word with a chat's title would otherwise sit over that chat.
  const topicAsk = topicSearch(words);
  const liveTopics = shell.topics.filter((topic) => !topic.retired);
  const topicMatches = !isSearch
    ? []
    : topicAsk.name === ""
      ? liveTopics.map((item) => ({ item, ranges: null }))
      : fuzzyMatch(liveTopics, (topic) => [topic.name], topicAsk.name);

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
        // Over the chats rather than under them: there are only ever a few
        // topics, and the chats are the one list here with no end, so under
        // them a topic would be out of sight exactly when its name is in
        // many titles. Asked for by the word, they lead outright, since no
        // place or command answers to it.
        {
          items: topicMatches.map(({ item, ranges }) =>
            topicItem(item, ranges),
          ),
          label: "Topics",
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
          items: pageItems(bookmarkPages),
          label: "Bookmarks",
        },
        {
          items: pageItems(recentPages),
          label: "Recent pages",
        },
        {
          items: fuzzyMatch(folders, (folder) => [folder.name], words)
            .slice(0, FOLDERS_SHOWN)
            .map(({ item: folder, ranges }) => ({
              icon: <FolderMark path={folder.path} />,
              id: `folder:${folder.path}`,
              label: folder.name,
              ranges,
              run: () => {
                openScreen(folderHref(folder.path));
              },
              type: "item",
            })),
          label: "Folders",
        },
        {
          items: fuzzyMatch(
            recentFiles,
            (file) => [file.name, displayPath(file.path)],
            words,
          )
            .slice(0, FILES_SHOWN)
            .map(({ item: file, ranges }) => ({
              detail: displayPath(folderOf(file.path)),
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
    typedPath === undefined &&
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
            items: byLastUserMessage(chats.filter((chat) => !chat.archived))
              .slice(0, RECENT_CHATS_SHOWN)
              .map((chat) => chatItem(chat, null)),
            label: "Recent chats",
          },
        ]
      : [
          ...pathSection,
          ...(site
            ? [
                {
                  items: [
                    {
                      detail: isPage ? "Open in this tab" : "Open in a new tab",
                      // An address being typed is no site anyone has been to
                      // yet, and asking for its icon would send every host
                      // the letters spell out along the way.
                      icon: isKnownSite ? (
                        <PageFavicon url={site.url} />
                      ) : (
                        <GlobeIcon />
                      ),
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
            ? [{ items: [webSearchItem], label: "Web" }]
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

  function pageItems(
    list: { favicon: string | undefined; title: string; url: string }[],
  ): Item[] {
    return fuzzyMatch(
      list,
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
      }));
  }

  // A chat's row wears what its row in the list does: the dot its tab
  // would, then its topic and its star past the title.
  function chatItem(chat: Chat, ranges: null | number[]): Item {
    const topic = shell.topics.find((each) => each.id === chat.topic);
    const mark = railMarkOf([chat]);
    return {
      detail: chat.archived ? "Archived" : undefined,
      dot: mark === "working" ? undefined : mark,
      icon: <ChatCircleIcon />,
      id: `chat:${chat.id}`,
      label: chat.title,
      ranges,
      run: () => {
        openScreen(`${CHATS_HREF}/${chat.id}`);
      },
      trailing:
        topic || chat.starred ? (
          <>
            {topic && <TopicPill quiet topic={topic} />}
            {chat.starred && (
              <StarIcon
                aria-label="Starred"
                className="size-3.5 text-warning-500"
                role="img"
                weight="fill"
              />
            )}
          </>
        ) : undefined,
      type: "item",
    };
  }

  function topicItem(topic: Topic, ranges: null | number[]): Item {
    return {
      icon: <TopicMark topic={topic} />,
      id: `topic:${topic.id}`,
      label: topic.name,
      ranges,
      run: () => {
        shell.openTopic(topic.id);
      },
      type: "item",
    };
  }

  const rows: Row[] = sections.flatMap((section): Row[] =>
    section.items.length === 0 && !section.looking
      ? []
      : [
          { label: section.label, type: "header" },
          ...section.items.map((item) => ({
            ...item,
            run: item.leavesItself ? item.run : done(item.run),
          })),
          ...(section.looking ? [{ type: "looking" as const }] : []),
        ],
  );

  const selection = useSelection({
    loop: isPage,
    rows,
    typed,
    words,
  });
  return { isBang, rows, selection, words };
}

/** The row Return runs, and what the field and the list do to move it. */
interface Selection {
  /** The row Return runs: the one picked for these words, else the first. */
  id: string | undefined;
  /** Whether the pick came from a key, which the list scrolls to follow. */
  isKeyed: boolean;
  /** The field's keys: the arrows move the pick, Return runs it. */
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  /** The pointer moving over a row picks it; a move to where it already was does not. */
  onPointerMove: (id: string, event: MouseEvent) => void;
}

/**
 * Which row Return runs, kept by the menu rather than read off the list on
 * screen, so it answers to the words alone. Each new search starts on its
 * first row, which is what the words name. A key or the pointer picks
 * another for as long as those words stand and the row is listed. The
 * pointer picks only by moving: the rows changing under a pointer at rest
 * make the browser send a move to the place it already was, and that leaves
 * the pick where it is. Return pressed
 * before the rows have caught up with the words waits for them, so it runs
 * a row for what was typed rather than for the letters before it.
 */
function useSelection({
  loop,
  rows,
  typed,
  words,
}: {
  /** Whether the arrows go round from one end to the other. */
  loop: boolean;
  rows: Row[];
  /** The words in the field, which `words` follows a beat behind. */
  typed: string;
  /** The words the rows are for. */
  words: string;
}): Selection {
  const [picked, setPicked] = useState<{
    id: string;
    isKeyed: boolean;
    words: string;
  }>();
  // The words Return was pressed for before the rows had caught up.
  const returnFor = useRef<string>(undefined);
  // Where the pointer last moved to on the list, across searches.
  const pointer = useRef<{ x: number; y: number }>(undefined);
  const items = rows.filter((row) => row.type === "item");
  const ids = items.map((item) => item.id);
  const id =
    picked?.words === words && ids.includes(picked.id) ? picked.id : ids[0];

  const runPicked = () => {
    items.find((item) => item.id === id)?.run();
  };
  const runWaiting = useEffectEvent(() => {
    if (returnFor.current === words) {
      returnFor.current = undefined;
      runPicked();
    }
  });
  useEffect(() => {
    runWaiting();
  }, [words]);

  const step = (event: KeyboardEvent<HTMLInputElement>) => {
    const { ctrlKey, key } = event;
    if (key === "ArrowDown" || (ctrlKey && (key === "n" || key === "j"))) {
      return 1;
    }
    if (key === "ArrowUp" || (ctrlKey && (key === "p" || key === "k"))) {
      return -1;
    }
    return 0;
  };

  return {
    id,
    isKeyed: id !== undefined && id === picked?.id && picked.isKeyed,
    onKeyDown: (event) => {
      if (event.nativeEvent.isComposing) {
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (words === typed) {
          runPicked();
        } else {
          returnFor.current = typed;
        }
        return;
      }
      const by = step(event);
      if (by === 0 || ids.length === 0) {
        return;
      }
      event.preventDefault();
      const at = id === undefined ? -1 : ids.indexOf(id);
      // Cmd with an arrow goes to that end of the list.
      const next = event.metaKey
        ? by > 0
          ? ids.length - 1
          : 0
        : loop
          ? (at + by + ids.length) % ids.length
          : Math.max(0, Math.min(ids.length - 1, at + by));
      const nextId = ids[next];
      if (nextId !== undefined) {
        setPicked({ id: nextId, isKeyed: true, words });
      }
    },
    onPointerMove: (rowId, event) => {
      const last = pointer.current;
      pointer.current = { x: event.screenX, y: event.screenY };
      const hasMoved =
        last !== undefined &&
        (last.x !== event.screenX || last.y !== event.screenY);
      if (!hasMoved || rowId === id) {
        return;
      }
      setPicked({ id: rowId, isKeyed: false, words });
    },
  };
}

/**
 * The menu's field, which keeps the caret while the list under it answers
 * the keys: the arrows move the row picked and Return runs it.
 */
export function CommandMenuField({
  className,
  containerClassName,
  listId,
  onValueChange,
  placeholder,
  ref,
  rows,
  selection,
  value,
}: {
  className?: string;
  containerClassName?: string;
  /** The list the field drives, which names the row picked. */
  listId: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  ref?: Ref<HTMLInputElement>;
  rows: Row[];
  selection: Selection;
  value: string;
}) {
  const at = rows.findIndex(
    (row) => row.type === "item" && row.id === selection.id,
  );
  return (
    <div className={cn("flex h-9 items-center gap-2 px-3", containerClassName)}>
      <MagnifyingGlassIcon className="size-4 shrink-0 opacity-50" />
      <input
        aria-activedescendant={at === -1 ? undefined : `${listId}-${at}`}
        aria-autocomplete="list"
        aria-label={placeholder}
        aria-controls={listId}
        aria-expanded
        autoComplete="off"
        autoCorrect="off"
        className={cn(
          "flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-hidden placeholder:text-muted-foreground",
          className,
        )}
        onChange={(event) => {
          onValueChange(event.currentTarget.value);
        }}
        onKeyDown={selection.onKeyDown}
        placeholder={placeholder}
        ref={ref}
        role="combobox"
        spellCheck={false}
        type="text"
        value={value}
      />
    </div>
  );
}

/**
 * The menu's list, one height whatever the search finds, so it does not
 * grow and shrink under the caret as results come and go.
 */
export function CommandMenuList({
  className,
  isBang,
  itemClassName,
  listId,
  rows,
  selection,
  words,
}: {
  className: string;
  isBang: boolean;
  /** The rows' padding, which the dialog sets a touch roomier than the page. */
  itemClassName: string;
  listId: string;
  rows: Row[];
  selection: Selection;
  words: string;
}) {
  return (
    // A press on a row must not take the caret from the field.
    <div
      aria-label="Suggestions"
      className={cn("overflow-hidden", className)}
      id={listId}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      role="listbox"
    >
      {rows.length > 0 ? (
        // A list of its own per search: a fresh scroller starts at the top,
        // where the first row is picked.
        <ResultRows
          itemClassName={itemClassName}
          key={words}
          listId={listId}
          rows={rows}
          selection={selection}
        />
      ) : words !== "" && !(isBang && words.length < 3) ? (
        <div className="flex h-full flex-col items-center justify-center gap-1 text-sm text-muted-foreground">
          Nothing matches “{words}”
        </div>
      ) : null}
    </div>
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
  const listId = useId();

  const close = () => {
    setOpen(false);
    // After the close animation, so the list does not visibly empty first.
    setTimeout(() => {
      setSearch("");
    }, 200);
  };
  useModalBack(close, open);

  const { isBang, rows, selection, words } = useCommandMenuRows({
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
    <Dialog
      onOpenChange={(value) => {
        if (value) {
          setOpen(true);
        } else {
          close();
        }
      }}
      open={open}
    >
      <DialogHeader className="sr-only">
        <DialogTitle>Command menu</DialogTitle>
        <DialogDescription>
          Search for anything, or type an address.
        </DialogDescription>
      </DialogHeader>
      <DialogContent
        className="overflow-hidden rounded-2xl p-0"
        showCloseButton={false}
      >
        <div className="flex size-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground">
          <CommandMenuField
            containerClassName="h-10"
            listId={listId}
            onValueChange={setSearch}
            placeholder={COMMAND_MENU_PLACEHOLDER}
            rows={rows}
            selection={selection}
            value={search}
          />
          <CommandMenuList
            className="h-96"
            isBang={isBang}
            itemClassName="py-2"
            listId={listId}
            rows={rows}
            selection={selection}
            words={words}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Every section in one virtualized, single-scroll region, so a workspace with
 * thousands of chats keeps the menu a normal height and a quick render.
 */
function ResultRows({
  itemClassName,
  listId,
  rows,
  selection,
}: {
  itemClassName: string;
  listId: string;
  rows: Row[];
  selection: Selection;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    estimateSize: (i) => (rows[i]?.type === "header" ? 28 : 36),
    getScrollElement: () => parentRef.current,
    // Rows on the first render, before the scroller is measured.
    initialRect: { height: 512, width: 0 },
    // Layout px, not the on-screen rect: the menu sits inside CSS `zoom`.
    measureElement: (el) => el.offsetHeight,
    overscan: 8,
  });

  // A row picked by a key is brought into view; the first row brings its
  // section's heading with it. One the pointer picked is already there.
  const at = rows.findIndex(
    (row) => row.type === "item" && row.id === selection.id,
  );
  const firstItem = rows.findIndex((row) => row.type === "item");
  useEffect(() => {
    if (selection.isKeyed && at !== -1) {
      virtualizer.scrollToIndex(at === firstItem ? 0 : at);
    }
  }, [at, firstItem, selection.isKeyed, virtualizer]);

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
                <div
                  aria-selected={row.id === selection.id}
                  className={cn(
                    "relative flex cursor-default items-center gap-2 rounded-sm px-3 text-sm outline-hidden select-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
                    itemClassName,
                  )}
                  data-selected={row.id === selection.id}
                  id={`${listId}-${virtualItem.index}`}
                  onClick={row.run}
                  onMouseMove={(event) => {
                    selection.onPointerMove(row.id, event);
                  }}
                  role="option"
                >
                  {/* The dot outside the icon's fade, so it reads as it does in a tab. */}
                  <span className="relative flex shrink-0">
                    <span className="flex size-4 shrink-0 items-center justify-center opacity-60">
                      {row.icon}
                    </span>
                    {row.dot ? (
                      <ChatMarkDot className="size-2 ring-0" mark={row.dot} />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    <FuzzyHighlight ranges={row.ranges} text={row.label} />
                    {row.detail ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {row.detail}
                      </span>
                    ) : null}
                  </span>
                  {row.trailing ? (
                    <span className="flex shrink-0 items-center gap-1">
                      {row.trailing}
                    </span>
                  ) : null}
                  {row.chord === undefined ? null : (
                    <CommandShortcut>
                      {formatAcceleratorText(row.chord)}
                    </CommandShortcut>
                  )}
                  {/* Return runs the row picked, so it says so, whichever row that is. */}
                  <CommandShortcut className="hidden in-data-[selected=true]:inline">
                    {osConventions().returnKey}
                  </CommandShortcut>
                </div>
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
