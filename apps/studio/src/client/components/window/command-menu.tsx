import { commandMenuOpenAtom } from "@/client/atoms/command-menu";
import {
  openSettings,
  type SettingsTab,
} from "@/client/atoms/settings-modal";
import { openShortcutGuide } from "@/client/atoms/shortcut-guide-modal";
import {
  APPS_HREF,
  bookmarksAtom,
  CHATS_HREF,
  visitedPagesAtom,
} from "@/client/atoms/window";
import { PageFavicon } from "@/client/components/favicon";
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
import { useAppsBySlug } from "@/client/components/window/apps-by-slug";
import { byActivity, type Chat } from "@/client/components/window/chats";
import { useShell } from "@/client/components/window/shell-context";
import { useChatSearchFallback } from "@/client/components/window/use-chat-search-fallback";
import { useDecisionModelAvailable } from "@/client/components/window/use-decision-model-available";
import { useBlockTabNavigation } from "@/client/hooks/use-block-tab-navigation";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { formatAccelerator } from "@/client/lib/format-accelerator";
import { joinFuzzyFields } from "@/client/lib/join-fuzzy-fields";
import { bareAddress } from "@/client/components/window/omnibar-match";
import {
  componentPages,
  debugNavigationRoutes,
  onboardingScreens,
} from "@/client/routes/debug/-debug-routes";
import { scenarios } from "@/client/routes/debug/-transcript/scenarios";
import { rpcClient } from "@/client/rpc/client";
import { SHORTCUT_GUIDE } from "@/shared/shortcut-guide";
import { SHORTCUTS, type ShortcutAccelerator } from "@/shared/shortcuts";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";
import uFuzzy from "@leeoniya/ufuzzy";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/ArrowsClockwise";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { CodeIcon } from "@phosphor-icons/react/Code";
import { FlaskIcon } from "@phosphor-icons/react/Flask";
import { GearIcon } from "@phosphor-icons/react/Gear";
import { KeyboardIcon } from "@phosphor-icons/react/Keyboard";
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
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const fuzzy = new uFuzzy({ intraMode: 1 });

/** Rows per kind past which a search stops listing: enough to choose from, few enough to read. */
const APPS_SHOWN = 6;
const PAGES_SHOWN = 6;
/**
 * Below this many chats or apps found by name, the search also asks the
 * decision model for the ones it means, from this many letters on: the
 * Apps page's numbers.
 */
const FEW = 3;
const MEANING_MIN_LENGTH = 3;
const MEANING_DEBOUNCE_MS = 300;
/** Chats listed before anything is typed, newest first. */
const RECENT_CHATS_SHOWN = 30;

type Row =
  | { label: string; type: "header" }
  | {
      chord?: ShortcutAccelerator;
      detail?: string | undefined;
      icon: ReactNode;
      id: string;
      label: string;
      ranges: null | number[];
      run: () => void;
      type: "item";
    };

type Item = Extract<Row, { type: "item" }>;

/**
 * The window's command menu (Cmd+K): one place to run a command, change the
 * theme, or jump to a chat, an app, or a page the browser has been to. A
 * search that turns up nothing at all is handed to the decision model, which
 * looks through the chats for the one the words mean. Words starting `!`
 * reach the switches kept out of sight: `!dev` and `!beta`.
 */
export function CommandMenu({
  openPage,
  openScreen,
}: {
  openPage: (url: string) => void;
  openScreen: (href: string) => void;
}) {
  const [open, setOpen] = useAtom(commandMenuOpenAtom);
  const [search, setSearch] = useState("");
  useBlockTabNavigation(open);
  const shell = useShell();
  const { setTheme, theme } = useTheme();
  const developerMode = useDeveloperMode();
  const appsBySlug = useAppsBySlug();
  const visited = useAtomValue(visitedPagesAtom);
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

  const close = () => {
    setOpen(false);
    // After the close animation, so the list does not visibly empty first.
    setTimeout(() => {
      setSearch("");
    }, 200);
  };
  /** A row's action, run once the menu is out of the way. */
  const andClose = (run: () => void) => () => {
    close();
    run();
  };

  const words = search.trim();
  const chats = shell.chats ?? [];

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
    {
      chord: WINDOW_SHORTCUTS.newTab.accelerator,
      icon: <PlusIcon />,
      id: "new-tab",
      label: "New tab",
      run: shell.appTabs.openNewTab,
    },
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
  const chatMatches = isSearch
    ? fuzzyMatch(byActivity(chats), (chat) => [chat.title], words)
    : [];
  const appMatches = isSearch
    ? fuzzyMatch([...appsBySlug], ([, app]) => [app.name], words).slice(
        0,
        APPS_SHOWN,
      )
    : [];

  const sections: { items: Item[]; label: string }[] = isBang
    ? [{ items: bangRows, label: "Switches" }]
    : words === ""
      ? [
          {
            items: commands.map((command) => ({
              ...command,
              ranges: null,
              type: "item",
            })),
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
        ];

  // Words that find few chats or apps by name also go to the decision
  // model, as the Apps page does, so a search like "taxes" or "design tool"
  // finds what it means. What it finds goes at the foot, below everything
  // the words matched, so it moves nothing already there.
  const asksMeaning = (matched: number) =>
    open && isSearch && words.length >= MEANING_MIN_LENGTH && matched < FEW;
  const shownChats = new Set(chatMatches.map(({ item }) => item.id));
  const chatsByMeaning = useChatSearchFallback({
    active: asksMeaning(chatMatches.length),
    candidates: chats.filter((chat) => !shownChats.has(chat.id)),
    search: words,
    topicNames: new Map(shell.topics.map((topic) => [topic.id, topic.name])),
  });
  const appsByMeaning = useAppsByMeaning({
    active: asksMeaning(appMatches.length),
    words,
  });
  if (chatsByMeaning.chats.length > 0) {
    sections.push({
      items: chatsByMeaning.chats.map((chat) => chatItem(chat, null)),
      label: "Chats about this",
    });
  }
  const shownApps = new Set(appMatches.map(({ item: [slug] }) => slug));
  const meantApps = appsByMeaning.apps.filter(
    (entry) => !shownApps.has(entry.slug),
  );
  if (meantApps.length > 0) {
    sections.push({
      items: meantApps.map((entry) =>
        appItem(
          entry.slug,
          {
            icon: entry.icon,
            name: entry.name,
            site: `https://${entry.domain}`,
          },
          null,
        ),
      ),
      label: "Apps for this",
    });
  }
  const isLooking = chatsByMeaning.isLooking || appsByMeaning.isLooking;

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

  const rows: Row[] = sections.flatMap((section) =>
    section.items.length === 0
      ? []
      : [
          { label: section.label, type: "header" } satisfies Row,
          ...section.items.map((item) => ({
            ...item,
            run: andClose(item.run),
          })),
        ],
  );

  return (
    <CommandDialog
      description="Run a command or go to a chat, an app, or a page"
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
        placeholder="Search chats, apps, pages, and commands…"
        value={search}
      />
      <CommandList className="max-h-none! min-h-48 overflow-visible!">
        {rows.length > 0 ? (
          <>
            {/* A list of its own per search: a fresh scroller starts at the
                top, where cmdk's pick of the first row then lands, rather
                than at wherever the last search's list was scrolled to. */}
            <ResultRows key={words} rows={rows} />
            {isLooking ? (
              <div className="flex items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
                <Spinner className="size-3" />
                Looking for more by meaning…
              </div>
            ) : null}
          </>
        ) : isLooking ? (
          <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Looking by meaning…
          </div>
        ) : words !== "" && !(isBang && words.length < 3) ? (
          <div className="flex min-h-48 flex-col items-center justify-center gap-1 text-sm text-muted-foreground">
            Nothing matches “{words}”
            {chatsByMeaning.failed || appsByMeaning.failed ? (
              <span className="text-xs">
                The decision model could not be reached
              </span>
            ) : null}
          </div>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}

/**
 * Every section in one virtualized, single-scroll region, so a workspace with
 * thousands of chats keeps the dialog a normal height and a quick render.
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
    initialRect: { height: 384, width: 0 },
    // Layout px, not the on-screen rect: the menu sits inside CSS `zoom`.
    measureElement: (el) => el.offsetHeight,
    overscan: 8,
  });

  return (
    <div className="max-h-96 overflow-y-auto p-1" ref={parentRef}>
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
                  {row.chord === undefined ? null : (
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

/**
 * The directory's services a search means without naming them, asked once
 * typing settles and only when the decision model could answer.
 */
function useAppsByMeaning({
  active,
  words,
}: {
  active: boolean;
  words: string;
}) {
  const [settled, setSettled] = useState(words);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(words);
    }, MEANING_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [words]);
  const available = useDecisionModelAvailable(active);
  const askable = active && available !== false;
  const asking = askable && available === true && settled === words;
  const meant = useQuery(
    rpcClient.apps.catalogByMeaning.queryOptions({
      enabled: asking,
      input: { query: settled },
      retry: false,
      staleTime: Number.POSITIVE_INFINITY,
    }),
  );
  return {
    apps: asking ? (meant.data ?? []) : [],
    failed: asking && meant.isError,
    isLooking: askable && (!asking || meant.isFetching),
  };
}
