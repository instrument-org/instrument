import {
  settingsModalAtom,
  type SettingsTab,
} from "@/client/atoms/settings-modal";
import { AccountSection } from "@/client/components/settings/account-section";
import { ActivitySection } from "@/client/components/settings/activity-section";
import { DebugSection } from "@/client/components/settings/debug-section";
import { FeaturesSection } from "@/client/components/settings/features-section";
import { GeneralSection } from "@/client/components/settings/general-section";
import { MemorySection } from "@/client/components/settings/memory-section";
import { PermissionsSection } from "@/client/components/settings/permissions-section";
import { ProvidersSection } from "@/client/components/settings/providers-section";
import { SkillsSection } from "@/client/components/settings/skills-section";
import { StorageSection } from "@/client/components/settings/storage-section";
import { FuzzyHighlight } from "@/client/components/fuzzy-highlight";
import {
  SETTINGS_PAGES,
  type SettingsEntry,
  type SettingsMatch,
  settingsTargetOf,
} from "@/client/components/settings/settings-index";
import { useSettingsSearch } from "@/client/components/settings/use-settings-search";
import { useSettingsTabs } from "@/client/components/settings/use-settings-tabs";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/client/components/ui/dialog";
import {
  Sidebar,
  SidebarContent,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/client/components/ui/sidebar";
import { useModalBack } from "@/client/hooks/use-modal-back";
import { useDeferredModalState } from "@/client/hooks/use-deferred-modal-state";
import { useFindTarget } from "@/client/hooks/use-find-target";
import { flashJumpTarget } from "@/client/lib/flash-jump-target";
import { cn } from "@/client/lib/utils";
import { CodeIcon } from "@phosphor-icons/react/Code";
import { CpuIcon } from "@phosphor-icons/react/Cpu";
import { CubeIcon } from "@phosphor-icons/react/Cube";
import { FadersHorizontalIcon } from "@phosphor-icons/react/FadersHorizontal";
import { FingerprintIcon } from "@phosphor-icons/react/Fingerprint";
import { FlagIcon } from "@phosphor-icons/react/Flag";
import { HardDrivesIcon } from "@phosphor-icons/react/HardDrives";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { LockKeyIcon } from "@phosphor-icons/react/LockKey";
import { UserCircleIcon } from "@phosphor-icons/react/UserCircle";
import { PulseIcon } from "@phosphor-icons/react/Pulse";
import { XIcon } from "@phosphor-icons/react/X";
import { useAtom } from "jotai";
import {
  type CSSProperties,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";

/** The letters of a result a search matched, tinted so they read at a glance. */
const MATCH_CLASS = "rounded-xs bg-brand-500/35 font-semibold text-foreground";

/** How long a jump waits for its row to be drawn before giving up on it. */
const FLASH_WAIT_MS = 2000;

interface NavItem {
  icon: React.ElementType;
  isDeveloperMode?: boolean;
  tab: SettingsTab;
  title: string;
}

/**
 * App-wide settings modal, mounted once at the window root. Reads
 * `settingsModalAtom` (opened via `openSettings`). The visible section is the
 * atom's `tab`, so a second `openSettings({ tab })` while open retargets the
 * modal instead of no-oping. Providers can deep-link straight to the
 * add-provider dialog. Traps tab navigation while open. Back and forward step
 * through the pages visited since it opened, apart from the tab's own history,
 * and back past the first page closes it.
 */
export function SettingsModal() {
  const [state, setState] = useAtom(settingsModalAtom);
  const isOpen = state !== null;
  // Deferred so `DialogContent` stays mounted (and its close animation can
  // play) for a moment after `state` clears to null, instead of unmounting
  // the instant the dialog starts closing.
  const { content, onExitComplete, openKey } = useDeferredModalState(state);
  const activeTab =
    content === null
      ? undefined
      : (content.tab ?? tabOfSetting(content.setting) ?? "General");
  // The pages back and forward of this one, nearest last, which each open
  // starts without. Choosing a page drops those ahead, as a browser does.
  const [visited, setVisited] = useState<{
    ahead: SettingsTab[];
    behind: SettingsTab[];
  }>({ ahead: [], behind: [] });
  if (!isOpen && (visited.ahead.length > 0 || visited.behind.length > 0)) {
    setVisited({ ahead: [], behind: [] });
  }

  useModalBack(
    () => {
      const previous = visited.behind.at(-1);
      if (previous === undefined || activeTab === undefined) {
        setState(null);
        return;
      }
      setVisited({
        ahead: [...visited.ahead, activeTab],
        behind: visited.behind.slice(0, -1),
      });
      setState({ tab: previous });
    },
    isOpen,
    () => {
      const next = visited.ahead.at(-1);
      if (next === undefined || activeTab === undefined) {
        return;
      }
      setVisited({
        ahead: visited.ahead.slice(0, -1),
        behind: [...visited.behind, activeTab],
      });
      setState({ tab: next });
    },
  );

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          setState(null);
        }
      }}
      open={isOpen}
    >
      {content !== null && activeTab !== undefined && (
        <SettingsModalContent
          activeTab={activeTab}
          key={openKey}
          onExitComplete={onExitComplete}
          onSelectTab={(tab) => {
            if (tab !== activeTab) {
              setVisited(({ behind }) => ({
                ahead: [],
                behind: [...behind, activeTab],
              }));
            }
            setState({ tab });
          }}
          setting={content.setting}
        />
      )}
    </Dialog>
  );
}

/** The page a link's setting is on, or none for one Settings searches for instead. */
function tabOfSetting(setting: string | undefined) {
  if (setting === undefined) {
    return undefined;
  }
  const target = settingsTargetOf(setting);
  return target.kind === "search" ? undefined : target.tab;
}

function SettingsModalContent({
  activeTab,
  onExitComplete,
  onSelectTab,
  setting,
}: {
  activeTab: SettingsTab;
  onExitComplete: () => void;
  onSelectTab: (tab: SettingsTab) => void;
  /** The setting a link opened Settings at, which this open starts at. */
  setting: string | undefined;
}) {
  const navItems = useNavItems();
  // Settings opened by a link starts at what it names: a row lit, or a
  // search for a name it has no row for. Read once, since each open is a
  // fresh mount of this.
  const [opened] = useState(() =>
    setting === undefined ? undefined : settingsTargetOf(setting),
  );
  const [query, setQuery] = useState(
    opened?.kind === "search" ? opened.search : "",
  );
  const isSearching = query.trim().length > 0;
  const search = useSettingsSearch({
    query,
    tabs: navItems.map((item) => item.tab),
  });
  // The result last opened, which stays lit in the list; the row it lights,
  // which a page has none of; and a count so opening the same one again
  // lights its row again.
  const [jump, setJump] = useState<{
    id: string;
    mark: string | undefined;
    n: number;
  } | null>(
    opened?.kind === "row"
      ? { id: opened.mark, mark: opened.mark, n: 1 }
      : null,
  );
  // Each page gets a scroller of its own (keyed by its tab below), so it opens
  // at its top, and a short page never keeps the edge fade a long one left on
  // a shared scroller. A jump to a row scrolls in `useFlashSetting`.
  const contentRef = useRef<HTMLElement>(null);
  useFlashSetting(contentRef, jump);
  // ⌘F anywhere in Settings is its search, over any list's own inside it.
  const searchRef = useRef<HTMLInputElement>(null);
  useFindTarget({
    anchor: searchRef,
    openFind: () => {
      searchRef.current?.focus();
      searchRef.current?.select();
    },
  });

  const ordered = search.matches.map((match) => match.entry);
  // The result the keys are on, which a new search starts back at the top.
  const [cursor, setCursor] = useState({ index: 0, query });
  const highlighted =
    ordered[
      cursor.query === query ? Math.min(cursor.index, ordered.length - 1) : 0
    ];
  const moveCursor = (by: number) => {
    const at = highlighted ? ordered.indexOf(highlighted) : 0;
    setCursor({
      index: Math.max(0, Math.min(ordered.length - 1, at + by)),
      query,
    });
  };

  const openResult = (entry: SettingsEntry) => {
    onSelectTab(entry.tab);
    setJump((last) => ({
      id: entry.id,
      mark: entry.page ? undefined : (entry.mark ?? entry.id),
      n: (last?.n ?? 0) + 1,
    }));
  };

  return (
    <DialogContent
      aria-describedby={undefined}
      className="h-full gap-0 overflow-hidden p-0 outline-none focus:outline-none focus-visible:outline-none"
      maxHeight="60rem"
      maxWidth="80rem"
      data-find-surface
      onExitComplete={onExitComplete}
      showCloseButton={false}
    >
      <DialogTitle className="sr-only">Settings</DialogTitle>
      <div className="absolute top-3 right-3 z-10">
        <DialogClose asChild>
          <Button aria-label="Close" type="button" variant="outline-opaque">
            <XIcon className="size-4" />
          </Button>
        </DialogClose>
      </div>
      <div className="flex h-full w-full flex-col overflow-hidden bg-background">
        <div className="shrink-0 p-3 text-center text-sm font-semibold">
          Settings
        </div>
        <div className="flex min-h-0 flex-1 overflow-x-auto px-3">
          <SidebarProvider
            className="h-full min-h-0"
            defaultOpen
            // Wide enough for the longest page name; CSSProperties has no custom properties.
            style={{ "--sidebar-width": "11rem" } as CSSProperties}
          >
            <Sidebar
              className="h-full max-w-[40%] shrink-0 bg-transparent"
              collapsible="none"
            >
              <div className="relative shrink-0 pb-2">
                <MagnifyingGlassIcon className="pointer-events-none absolute top-4 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <SidebarInput
                  aria-activedescendant={
                    isSearching && highlighted
                      ? resultElementId(highlighted.id)
                      : undefined
                  }
                  aria-label="Search settings"
                  ref={searchRef}
                  // The ring is drawn inside the field: the sidebar's scroller
                  // clips anything drawn past its edge.
                  className="pr-8 pl-8 focus-visible:-outline-offset-3 [&::-webkit-search-cancel-button]:hidden"
                  onChange={(event) => {
                    setQuery(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && query) {
                      // Clears the search rather than closing Settings.
                      event.preventDefault();
                      event.stopPropagation();
                      setQuery("");
                    } else if (event.key === "ArrowDown") {
                      event.preventDefault();
                      moveCursor(1);
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      moveCursor(-1);
                    } else if (event.key === "Enter" && highlighted) {
                      openResult(highlighted);
                    }
                  }}
                  placeholder="Search"
                  type="search"
                  value={query}
                />
                {query ? (
                  <button
                    aria-label="Clear search"
                    className="absolute top-4 right-1.5 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                    onClick={() => {
                      setQuery("");
                    }}
                    type="button"
                  >
                    <XIcon className="size-4" />
                  </button>
                ) : null}
              </div>
              <SidebarContent>
                {isSearching ? (
                  <SearchResults
                    activeId={jump?.id}
                    highlightedId={highlighted?.id}
                    isLooking={search.isLooking}
                    matches={search.matches}
                    navItems={navItems}
                    onHighlight={(entry) => {
                      setCursor({ index: ordered.indexOf(entry), query });
                    }}
                    onOpen={openResult}
                  />
                ) : (
                  <SidebarMenu>
                    {navItems.map((item) => (
                      <SidebarMenuItem className="group" key={item.title}>
                        <SidebarMenuButton
                          className={
                            item.isDeveloperMode
                              ? "text-dev-700 group-hover:bg-white/10 focus-visible:-outline-offset-2 dark:text-dev-300 [&>svg]:text-dev-700 dark:[&>svg]:text-dev-300"
                              : "group-hover:bg-black/10 focus-visible:-outline-offset-2 dark:group-hover:bg-white/10"
                          }
                          isActive={item.tab === activeTab}
                          onClick={() => {
                            onSelectTab(item.tab);
                          }}
                        >
                          <item.icon />
                          <span>{item.title}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                )}
              </SidebarContent>
            </Sidebar>
            <SidebarInset
              className="min-w-0 overflow-y-auto scroll-fade-y"
              key={activeTab}
              ref={contentRef}
            >
              <div className="flex flex-1 flex-col gap-4 p-6">
                <SettingsSectionBody tab={activeTab} />
              </div>
            </SidebarInset>
          </SidebarProvider>
        </div>
      </div>
    </DialogContent>
  );
}

/**
 * The sidebar while there is a search: what matched, best first, each under
 * its page's icon. A row says its own name with the page it is on beneath; a
 * page says only its name. Opening one keeps the list up, so the next can be
 * tried without searching again.
 */
function SearchResults({
  activeId,
  highlightedId,
  isLooking,
  matches,
  navItems,
  onHighlight,
  onOpen,
}: {
  activeId: string | undefined;
  /** The result the arrow keys are on, which Enter opens. */
  highlightedId: string | undefined;
  isLooking: boolean;
  matches: SettingsMatch[];
  navItems: NavItem[];
  onHighlight: (entry: SettingsEntry) => void;
  onOpen: (entry: SettingsEntry) => void;
}) {
  if (matches.length === 0) {
    return (
      <p className="px-2 py-2 text-sm text-muted-foreground">
        {isLooking ? "Searching…" : "No results"}
      </p>
    );
  }
  return (
    <SidebarMenu>
      {matches.map(({ entry, pageRanges, titleRanges }) => {
        const page = navItems.find((item) => item.tab === entry.tab);
        const Icon = page?.icon;
        return (
          <SidebarMenuItem key={entry.id}>
            <SidebarMenuButton
              className={cn(
                "h-auto items-start gap-2.5 py-1.5 focus-visible:-outline-offset-2 [&>svg]:mt-0.5",
                entry.id === highlightedId && "bg-black/10 dark:bg-white/10",
              )}
              id={resultElementId(entry.id)}
              isActive={entry.id === activeId}
              onClick={() => {
                onOpen(entry);
              }}
              onMouseMove={() => {
                onHighlight(entry);
              }}
              ref={
                entry.id === highlightedId
                  ? (element: HTMLButtonElement | null) => {
                      element?.scrollIntoView({ block: "nearest" });
                    }
                  : undefined
              }
            >
              {Icon ? <Icon /> : null}
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  <FuzzyHighlight
                    matchClassName={MATCH_CLASS}
                    ranges={titleRanges}
                    text={entry.title}
                  />
                </span>
                {entry.page ? null : (
                  <span className="block truncate text-xs text-muted-foreground">
                    <FuzzyHighlight
                      matchClassName={MATCH_CLASS}
                      ranges={pageRanges}
                      text={entry.tab}
                    />
                  </span>
                )}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
      {isLooking ? (
        <li className="px-2 py-1.5 text-xs text-muted-foreground">
          Searching…
        </li>
      ) : null}
    </SidebarMenu>
  );
}

/** The DOM id of a result's row, which the search field names as the one the keys are on. */
function resultElementId(id: string) {
  return `settings-result-${encodeURIComponent(id)}`;
}

/**
 * Brings the row a result names into view and lights it, once the page it is
 * on has drawn it: a page reading its data draws the row a moment after it
 * opens, so the row is looked for each frame for a short while.
 */
function useFlashSetting(
  contentRef: RefObject<HTMLElement | null>,
  jump: { mark: string | undefined; n: number } | null,
) {
  useEffect(() => {
    const mark = jump?.mark;
    if (mark === undefined) {
      return;
    }
    const deadline = performance.now() + FLASH_WAIT_MS;
    let frame = 0;
    const find = () => {
      const row = contentRef.current?.querySelector(
        `[data-setting="${CSS.escape(mark)}"]`,
      );
      if (row) {
        row.scrollIntoView({ behavior: "smooth", block: "center" });
        flashJumpTarget(row);
      } else if (performance.now() < deadline) {
        frame = requestAnimationFrame(find);
      }
    };
    find();
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [contentRef, jump]);
}

function SettingsSectionBody({ tab }: { tab: SettingsTab }) {
  switch (tab) {
    case "Account": {
      return <AccountSection />;
    }
    case "Activity": {
      return <ActivitySection />;
    }
    case "Debug": {
      return <DebugSection />;
    }
    case "Features": {
      return <FeaturesSection />;
    }
    case "General": {
      return <GeneralSection />;
    }
    case "Memory": {
      return <MemorySection />;
    }
    case "Permissions": {
      return <PermissionsSection />;
    }
    case "Providers": {
      return <ProvidersSection />;
    }
    case "Skills": {
      return <SkillsSection />;
    }
    case "Storage": {
      return <StorageSection />;
    }
    default: {
      tab satisfies never;
      return null;
    }
  }
}

/** Each tab's mark in the sidebar. */
const NAV_ICONS: Record<SettingsTab, React.ElementType> = {
  Debug: CodeIcon,
  Features: FlagIcon,
  General: FadersHorizontalIcon,
  Memory: FingerprintIcon,
  Permissions: LockKeyIcon,
  Providers: CpuIcon,
  Skills: CubeIcon,
  Storage: HardDrivesIcon,
  Account: UserCircleIcon,
  Activity: PulseIcon,
};

function useNavItems(): NavItem[] {
  return useSettingsTabs().map((tab) => ({
    icon: NAV_ICONS[tab],
    isDeveloperMode: SETTINGS_PAGES[tab].developerOnly === true,
    tab,
    title: tab,
  }));
}
