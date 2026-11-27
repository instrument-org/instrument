import { type SettingsTab } from "@/client/atoms/settings-modal";
import { AccountSection } from "@/client/components/settings/account-section";
import { ActivitySection } from "@/client/components/settings/activity-section";
import { AppsSection } from "@/client/components/settings/apps-section";
import { DeveloperSection } from "@/client/components/settings/developer-section";
import { AboutSection } from "@/client/components/settings/about-section";
import { DictationSection } from "@/client/components/settings/dictation-section";
import { SupportSection } from "@/client/components/settings/support-section";
import { GeneralSection } from "@/client/components/settings/general-section";
import { MemorySection } from "@/client/components/settings/memory-section";
import { PermissionsSection } from "@/client/components/settings/permissions-section";
import { ProvidersSection } from "@/client/components/settings/providers-section";
import { FieldKeys } from "@/client/components/field-keys";
import { SkillsSection } from "@/client/components/settings/skills-section";
import { StorageSection } from "@/client/components/settings/storage-section";
import { FuzzyHighlight } from "@/client/components/fuzzy-highlight";
import {
  SETTINGS_PAGES,
  type SettingsEntry,
  type SettingsMatch,
  settingsTabTitle,
} from "@/client/components/settings/settings-index";
import { type SettingsAsk } from "@/client/components/settings/settings-ask";
import { useSettingsSearch } from "@/client/components/settings/use-settings-search";
import { useSettingsTabGroups } from "@/client/components/settings/use-settings-tabs";
import { Input } from "@/client/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { useFindTarget } from "@/client/hooks/use-find-target";
import { PAGE_FOLD_PX, useIsNarrower } from "@/client/hooks/use-is-narrower";
import { flashJumpTarget } from "@/client/lib/flash-jump-target";
import { SIDE_MOTION } from "@/client/lib/motion";
import { cn } from "@/client/lib/utils";
import { CpuIcon } from "@phosphor-icons/react/Cpu";
import { CubeIcon } from "@phosphor-icons/react/Cube";
import { FadersHorizontalIcon } from "@phosphor-icons/react/FadersHorizontal";
import { FingerprintIcon } from "@phosphor-icons/react/Fingerprint";
import { HardDrivesIcon } from "@phosphor-icons/react/HardDrives";
import { InfoIcon } from "@phosphor-icons/react/Info";
import { LockKeyIcon } from "@phosphor-icons/react/LockKey";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { MicrophoneIcon } from "@phosphor-icons/react/Microphone";
import { QuestionIcon } from "@phosphor-icons/react/Question";
import { ShapesIcon } from "@phosphor-icons/react/Shapes";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/ClockCounterClockwise";
import { UserCircleIcon } from "@phosphor-icons/react/UserCircle";
import { WrenchIcon } from "@phosphor-icons/react/Wrench";
import { XIcon } from "@phosphor-icons/react/X";
import { motion, useReducedMotion } from "motion/react";
import {
  type ElementType,
  Fragment,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";

/** The letters of a result a search matched, tinted so they read at a glance. */
const MATCH_CLASS = "rounded-xs bg-brand-500/35 font-semibold text-foreground";

/** How long a jump waits for its row to be drawn before giving up on it. */
const FLASH_WAIT_MS = 2000;

/** The sidebar's width and its rail's, in layout px: `w-44` and `w-12`. */
const NAV_LIST_PX = 176;
const NAV_RAIL_PX = 48;

interface NavItem {
  icon: ElementType;
  isDeveloperMode?: boolean;
  tab: SettingsTab;
  title: string;
}

/**
 * Settings as a tab: its parts down a sidebar of their own, with the search
 * over them, and the part shown beside them. Each part is an address of its
 * own (`/settings/<part>`), so the tab's back and forward step through the
 * parts visited, and a link opens Settings at one. Narrower than
 * `PAGE_FOLD_PX`, as it is beside a chat, the sidebar folds to a rail of the
 * parts' icons, each naming itself on hover, and the search opens over the
 * part from the rail's magnifier.
 *
 * Every part reads what it shows live, so Settings left open beside a chat
 * shows a setting the moment the chat changes it.
 */
export function SettingsPage({
  ask,
  onSearch,
  onSection,
  q,
  section,
}: {
  /** What the address last asked of the page once: a row to light, a panel to open. */
  ask: null | SettingsAsk;
  onSearch: (q: string) => void;
  onSection: (tab: SettingsTab) => void;
  q: string;
  section: SettingsTab;
}) {
  const navGroups = useNavGroups();
  const navItems = navGroups.flat();
  const [frame, setFrame] = useState<HTMLElement | null>(null);
  const isNarrow = useIsNarrower(frame, PAGE_FOLD_PX);
  const isReduced = useReducedMotion() === true;
  const isSearching = q.trim().length > 0;
  const search = useSettingsSearch({
    query: q,
    tabs: navItems.map((item) => item.tab),
  });
  // The result last opened, which stays lit in the list; the row it lights,
  // which a page has none of; and a count so opening the same one again
  // lights its row again. A row the address asked for lights the same way.
  const [jump, setJump] = useState<{
    id: string;
    mark: string | undefined;
    n: number;
  } | null>(null);
  const [askTaken, setAskTaken] = useState<number>();
  if (ask?.setting !== undefined && ask.n !== askTaken) {
    setAskTaken(ask.n);
    setJump((last) => ({
      id: ask.setting ?? "",
      mark: ask.setting,
      n: (last?.n ?? 0) + 1,
    }));
  }
  // Each page gets a scroller of its own (keyed by its tab below), so it opens
  // at its top, and a short page never keeps the edge fade a long one left on
  // a shared scroller. A jump to a row scrolls in `useFlashSetting`.
  const contentRef = useRef<HTMLElement>(null);
  useFlashSetting(contentRef, jump?.mark, jump?.n ?? 0);
  // On the rail the search opens over the part, from the magnifier.
  const [isSearchOpen, setSearchOpen] = useState(false);
  // ⌘F anywhere in Settings is its search, over any list's own inside it.
  const frameRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [focusSearch, setFocusSearch] = useState(0);
  useEffect(() => {
    if (focusSearch > 0) {
      searchRef.current?.focus();
      searchRef.current?.select();
    }
  }, [focusSearch]);
  const openSearch = () => {
    setSearchOpen(true);
    setFocusSearch((count) => count + 1);
  };
  useFindTarget({ anchor: frameRef, openFind: openSearch });

  const ordered = search.matches.map((match) => match.entry);
  // The result the keys are on, which a new search starts back at the top.
  const [cursor, setCursor] = useState({ index: 0, query: q });
  const highlighted =
    ordered[
      cursor.query === q ? Math.min(cursor.index, ordered.length - 1) : 0
    ];
  const moveCursor = (by: number) => {
    const at = highlighted ? ordered.indexOf(highlighted) : 0;
    setCursor({
      index: Math.max(0, Math.min(ordered.length - 1, at + by)),
      query: q,
    });
  };

  const openResult = (entry: SettingsEntry) => {
    setSearchOpen(false);
    onSection(entry.tab);
    setJump((last) => ({
      id: entry.id,
      mark: entry.page ? undefined : (entry.mark ?? entry.id),
      n: (last?.n ?? 0) + 1,
    }));
  };

  const searchField = (
    <div className="group/field relative shrink-0">
      <MagnifyingGlassIcon className="pointer-events-none absolute top-4 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        aria-activedescendant={
          isSearching && highlighted
            ? resultElementId(highlighted.id)
            : undefined
        }
        aria-label="Search settings"
        className="h-8 w-full bg-background pr-8 pl-8 shadow-none focus-visible:-outline-offset-3 [&::-webkit-search-cancel-button]:hidden"
        onChange={(event) => {
          onSearch(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && (q || isNarrow)) {
            // Clears the search, then on the rail puts it away, rather
            // than leaving the tab.
            event.preventDefault();
            event.stopPropagation();
            if (q) {
              onSearch("");
            } else {
              setSearchOpen(false);
            }
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
        ref={searchRef}
        type="search"
        value={q}
      />
      {q ? (
        <button
          aria-label="Clear search"
          className="absolute top-4 right-1.5 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
          onClick={() => {
            onSearch("");
          }}
          type="button"
        >
          <XIcon className="size-4" />
        </button>
      ) : (
        <FieldKeys />
      )}
    </div>
  );
  const results = (
    <SearchResults
      activeId={jump?.id}
      highlightedId={highlighted?.id}
      isLooking={search.isLooking}
      matches={search.matches}
      navItems={navItems}
      onHighlight={(entry) => {
        setCursor({ index: ordered.indexOf(entry), query: q });
      }}
      onOpen={openResult}
    />
  );

  return (
    <div
      className="relative flex h-full min-h-0 bg-background"
      data-find-surface
      ref={(element) => {
        frameRef.current = element;
        setFrame(element);
      }}
    >
      {/* The sidebar and its rail are different things, so the box around
          them carries the change: its width moves from one to the other, the
          way a side opening beside Settings moves, and what is in it changes
          at once under its edge. */}
      <motion.div
        animate={{ width: isNarrow ? NAV_RAIL_PX : NAV_LIST_PX }}
        className="flex shrink-0 overflow-hidden border-r border-border/60"
        initial={false}
        transition={isReduced ? { duration: 0 } : SIDE_MOTION}
      >
      {isNarrow ? (
        <nav
          aria-label="Settings"
          className="flex w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto py-3"
        >
          <RailButton
            icon={MagnifyingGlassIcon}
            isActive={isSearching}
            label="Search"
            onClick={openSearch}
          />
          <div className="my-1 h-px w-6 shrink-0 bg-border" />
          {navGroups.map((group, index) => (
            <Fragment key={group[0]?.tab}>
              {index > 0 && (
                <div className="my-1 h-px w-6 shrink-0 bg-border" />
              )}
              {group.map((item) => (
                <RailButton
                  icon={item.icon}
                  isActive={item.tab === section}
                  isDeveloperMode={item.isDeveloperMode}
                  key={item.tab}
                  label={item.title}
                  onClick={() => {
                    onSection(item.tab);
                  }}
                />
              ))}
            </Fragment>
          ))}
        </nav>
      ) : (
        <nav
          aria-label="Settings"
          className="flex w-44 shrink-0 flex-col gap-2 overflow-y-auto px-3 py-3"
        >
          {searchField}
          {isSearching ? (
            results
          ) : (
            <ul className="flex flex-col gap-0.5">
              {navGroups.map((group, index) => (
                <Fragment key={group[0]?.tab}>
                  {index > 0 && (
                    <li
                      className="mx-2 my-1.5 h-px bg-border"
                      role="separator"
                    />
                  )}
                  {group.map((item) => (
                    <li key={item.tab}>
                      <SectionButton
                        item={item}
                        isActive={item.tab === section}
                        onClick={() => {
                          onSection(item.tab);
                        }}
                      />
                    </li>
                  ))}
                </Fragment>
              ))}
            </ul>
          )}
        </nav>
      )}
      </motion.div>
      {isNarrow && isSearchOpen && (
        <>
          {/* Everything beside the panel, so none of it lies under the panel. */}
          <button
            aria-label="Close search"
            className="absolute inset-y-0 right-0 left-64 z-20 cursor-default"
            onClick={() => {
              setSearchOpen(false);
            }}
            tabIndex={-1}
            type="button"
          />
          <div className="absolute inset-y-0 left-0 z-30 flex w-64 flex-col gap-2 overflow-y-auto border-r border-border bg-background px-3 py-3 shadow-xl-soft">
            {searchField}
            {isSearching ? (
              results
            ) : (
              <p className="px-2 py-1 text-sm text-muted-foreground">
                Type a setting's name to find it.
              </p>
            )}
          </div>
        </>
      )}
      {/* The page is worked from its content, which the keys scroll. */}
      <main
        className="min-w-0 flex-1 overflow-y-auto scroll-fade-y outline-none"
        data-keyboard-home
        key={section}
        ref={contentRef}
        tabIndex={-1}
      >
        <div
          className={cn(
            "mx-auto flex max-w-4xl flex-col gap-4",
            isNarrow ? "p-4" : "p-6",
          )}
        >
          <SettingsSectionBody tab={section} />
        </div>
      </main>
    </div>
  );
}

/** A part of Settings in its sidebar: its icon and its name. */
function SectionButton({
  isActive,
  item,
  onClick,
}: {
  isActive: boolean;
  item: NavItem;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "flex h-8 w-full items-center gap-2 overflow-hidden rounded-lg px-2 text-left text-sm focus-visible:-outline-offset-2 [&>svg]:size-4 [&>svg]:shrink-0",
        isActive
          ? "bg-foreground/8 font-medium"
          : "hover:bg-black/10 dark:hover:bg-white/10",
        item.isDeveloperMode && "text-dev-700 dark:text-dev-300",
      )}
      data-active={isActive}
      onClick={onClick}
      type="button"
    >
      <item.icon />
      <span className="min-w-0 truncate">{item.title}</span>
    </button>
  );
}

/** A part of Settings on the folded sidebar: its icon, naming itself on hover. */
function RailButton({
  icon: Icon,
  isActive,
  isDeveloperMode = false,
  label,
  onClick,
}: {
  icon: ElementType;
  isActive: boolean;
  isDeveloperMode?: boolean | undefined;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-lg focus-visible:-outline-offset-2",
            isActive
              ? "bg-foreground/8 text-foreground"
              : "text-muted-foreground hover:bg-black/10 hover:text-foreground dark:hover:bg-white/10",
            isDeveloperMode && "text-dev-700 dark:text-dev-300",
          )}
          data-active={isActive}
          onClick={onClick}
          type="button"
        >
          <Icon className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
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
    <ul className="flex flex-col gap-0.5">
      {matches.map(({ entry, pageRanges, titleRanges }) => {
        const Icon =
          navItems.find((item) => item.tab === entry.tab)?.icon ??
          NAV_ICONS[entry.tab];
        return (
          <li key={entry.id}>
            <button
              className={cn(
                "flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm focus-visible:-outline-offset-2 [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0",
                entry.id === activeId && "bg-foreground/8 font-medium",
                entry.id === highlightedId && "bg-black/10 dark:bg-white/10",
              )}
              id={resultElementId(entry.id)}
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
              type="button"
            >
              <Icon />
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
                      text={settingsTabTitle(entry.tab)}
                    />
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
      {isLooking ? (
        <li className="px-2 py-1.5 text-xs text-muted-foreground">
          Searching…
        </li>
      ) : null}
    </ul>
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
  mark: string | undefined,
  /** How many jumps there have been, so the same row asked for again lights again. */
  n: number,
) {
  useEffect(() => {
    if (mark === undefined || n === 0) {
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
  }, [contentRef, mark, n]);
}

function SettingsSectionBody({ tab }: { tab: SettingsTab }) {
  switch (tab) {
    case "About": {
      return <AboutSection />;
    }
    case "Account": {
      return <AccountSection />;
    }
    case "Dictation": {
      return <DictationSection />;
    }
    case "Support": {
      return <SupportSection />;
    }
    case "Activity": {
      return <ActivitySection />;
    }
    case "Apps": {
      return <AppsSection />;
    }
    case "Developer": {
      return <DeveloperSection />;
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
const NAV_ICONS: Record<SettingsTab, ElementType> = {
  About: InfoIcon,
  Apps: ShapesIcon,
  Dictation: MicrophoneIcon,
  Support: QuestionIcon,
  Developer: WrenchIcon,
  General: FadersHorizontalIcon,
  Memory: FingerprintIcon,
  Permissions: LockKeyIcon,
  Providers: CpuIcon,
  Skills: CubeIcon,
  Storage: HardDrivesIcon,
  Account: UserCircleIcon,
  Activity: ClockCounterClockwiseIcon,
};

/** The sidebar's pages in its groups, which a rule sets apart. */
function useNavGroups(): NavItem[][] {
  return useSettingsTabGroups().map((group) =>
    group.map((tab) => ({
      icon: NAV_ICONS[tab],
      isDeveloperMode: SETTINGS_PAGES[tab].developerOnly === true,
      tab,
      title: settingsTabTitle(tab),
    })),
  );
}
