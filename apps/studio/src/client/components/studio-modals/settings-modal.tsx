import {
  settingsModalAtom,
  type SettingsTab,
} from "@/client/atoms/settings-modal";
import { DebugSection } from "@/client/components/settings/debug-section";
import { FeaturesSection } from "@/client/components/settings/features-section";
import { GeneralSection } from "@/client/components/settings/general-section";
import { MemorySection } from "@/client/components/settings/memory-section";
import { ProvidersSection } from "@/client/components/settings/providers-section";
import { SkillsSection } from "@/client/components/settings/skills-section";
import { StorageSection } from "@/client/components/settings/storage-section";
import { FuzzyHighlight } from "@/client/components/fuzzy-highlight";
import {
  type SettingsEntry,
  type SettingsMatch,
} from "@/client/components/settings/settings-index";
import { useSettingsSearch } from "@/client/components/settings/use-settings-search";
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
  SidebarGroup,
  SidebarGroupLabel,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/client/components/ui/sidebar";
import { useBlockTabNavigation } from "@/client/hooks/use-block-tab-navigation";
import { useModalBack } from "@/client/hooks/use-modal-back";
import { useDeferredModalState } from "@/client/hooks/use-deferred-modal-state";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { flashJumpTarget } from "@/client/lib/flash-jump-target";
import { rpcClient } from "@/client/rpc/client";
import { CodeIcon } from "@phosphor-icons/react/Code";
import { CpuIcon } from "@phosphor-icons/react/Cpu";
import { CubeIcon } from "@phosphor-icons/react/Cube";
import { FadersHorizontalIcon } from "@phosphor-icons/react/FadersHorizontal";
import { FingerprintIcon } from "@phosphor-icons/react/Fingerprint";
import { FlagIcon } from "@phosphor-icons/react/Flag";
import { HardDrivesIcon } from "@phosphor-icons/react/HardDrives";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { XIcon } from "@phosphor-icons/react/X";
import { APP_NAME } from "@instrument-org/shared";
import { useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { group } from "radashi";
import { type RefObject, useEffect, useRef, useState } from "react";

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
 * add-provider dialog. Traps tab navigation while open.
 */
export function SettingsModal() {
  const [state, setState] = useAtom(settingsModalAtom);
  const isOpen = state !== null;
  // Deferred so `DialogContent` stays mounted (and its close animation can
  // play) for a moment after `state` clears to null, instead of unmounting
  // the instant the dialog starts closing.
  const { content, onExitComplete, openKey } = useDeferredModalState(state);

  useBlockTabNavigation(isOpen);
  useModalBack(() => {
    setState(null);
  }, isOpen);

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          setState(null);
        }
      }}
      open={isOpen}
    >
      {content !== null && (
        <SettingsModalContent
          activeTab={content.tab ?? "General"}
          // One-shot: honored only for the initial Providers section. Switching
          // sections drops it (onSelectTab sets `{ tab }` alone), so revisiting
          // Providers doesn't reopen add-provider.
          autoAddProvider={content.showNewProviderDialog ?? false}
          key={openKey}
          onExitComplete={onExitComplete}
          onSelectTab={(tab, open) => {
            setState({ tab, ...open });
          }}
        />
      )}
    </Dialog>
  );
}

function SettingsModalContent({
  activeTab,
  autoAddProvider,
  onExitComplete,
  onSelectTab,
}: {
  activeTab: SettingsTab;
  autoAddProvider: boolean;
  onExitComplete: () => void;
  onSelectTab: (tab: SettingsTab, open?: SettingsEntry["open"]) => void;
}) {
  const navItems = useNavItems();
  const [query, setQuery] = useState("");
  const isSearching = query.trim().length > 0;
  const search = useSettingsSearch({
    query,
    tabs: navItems.map((item) => item.tab),
  });
  // The result last opened, which stays lit in the list, and a count so
  // opening the same one again lights its row again.
  const [jump, setJump] = useState<{ id: string; n: number } | null>(null);
  const contentRef = useRef<HTMLElement>(null);
  useFlashSetting(contentRef, jump);

  const openResult = (entry: SettingsEntry) => {
    onSelectTab(entry.tab, entry.open);
    setJump((last) => ({ id: entry.id, n: (last?.n ?? 0) + 1 }));
  };

  return (
    <DialogContent
      aria-describedby={undefined}
      className="h-full gap-0 overflow-hidden p-0 outline-none focus:outline-none focus-visible:outline-none"
      maxHeight="50rem"
      maxWidth="70rem"
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
          <SidebarProvider className="h-full min-h-0" defaultOpen>
            <Sidebar
              className="h-full max-w-[40%] shrink-0 bg-transparent"
              collapsible="none"
            >
              <div className="relative shrink-0 p-2">
                <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-4.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <SidebarInput
                  aria-label="Search settings"
                  className="pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
                  onChange={(event) => {
                    setQuery(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && query) {
                      // Clears the search rather than closing Settings.
                      event.preventDefault();
                      event.stopPropagation();
                      setQuery("");
                    } else if (event.key === "Enter") {
                      const first = search.matches[0];
                      if (first) {
                        openResult(first.entry);
                      }
                    }
                  }}
                  placeholder="Search"
                  type="search"
                  value={query}
                />
                {query ? (
                  <button
                    aria-label="Clear search"
                    className="absolute top-1/2 right-3.5 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
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
                    failed={search.failed}
                    isLooking={search.isLooking}
                    matches={search.matches}
                    navItems={navItems}
                    onOpen={openResult}
                    query={query.trim()}
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
            <SidebarInset className="min-w-0 overflow-y-auto" ref={contentRef}>
              <div className="flex flex-1 flex-col gap-4 p-6">
                <SettingsSectionBody
                  autoAddProvider={autoAddProvider}
                  tab={activeTab}
                />
              </div>
            </SidebarInset>
          </SidebarProvider>
        </div>
      </div>
    </DialogContent>
  );
}

/**
 * The sidebar while there is a search: what matched, under the page each one
 * is on, in the order of each page's best match. Opening one keeps the list
 * up, so the next can be tried without searching again.
 */
function SearchResults({
  activeId,
  failed,
  isLooking,
  matches,
  navItems,
  onOpen,
  query,
}: {
  activeId: string | undefined;
  failed: boolean;
  isLooking: boolean;
  matches: SettingsMatch[];
  navItems: NavItem[];
  onOpen: (entry: SettingsEntry) => void;
  query: string;
}) {
  if (matches.length === 0) {
    return (
      <p className="px-4 py-2 text-sm text-muted-foreground">
        {isLooking
          ? "Looking…"
          : failed
            ? `Nothing matches “${query}”, and ${APP_NAME} couldn’t look any further right now.`
            : `Nothing matches “${query}”.`}
      </p>
    );
  }
  const groups = Object.entries(group(matches, (match) => match.entry.tab));
  return groups.map(([tab, tabMatches = []]) => {
    const item = navItems.find((nav) => nav.tab === tab);
    return (
      <SidebarGroup key={tab}>
        <SidebarGroupLabel>{item?.title ?? tab}</SidebarGroupLabel>
        <SidebarMenu>
          {tabMatches.map(({ entry, titleRanges }) => (
            <SidebarMenuItem className="group" key={entry.id}>
              <SidebarMenuButton
                className="group-hover:bg-black/10 focus-visible:-outline-offset-2 dark:group-hover:bg-white/10"
                isActive={entry.id === activeId}
                onClick={() => {
                  onOpen(entry);
                }}
              >
                <span className="truncate">
                  <FuzzyHighlight ranges={titleRanges} text={entry.title} />
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroup>
    );
  });
}

/**
 * Brings the row a result names into view and lights it, once the page it is
 * on has drawn it: a page reading its data draws the row a moment after it
 * opens, so the row is looked for each frame for a short while.
 */
function useFlashSetting(
  contentRef: RefObject<HTMLElement | null>,
  jump: { id: string; n: number } | null,
) {
  useEffect(() => {
    if (!jump) {
      return;
    }
    const deadline = performance.now() + FLASH_WAIT_MS;
    let frame = 0;
    const find = () => {
      const row = contentRef.current?.querySelector(
        `[data-setting="${CSS.escape(jump.id)}"]`,
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

function SettingsSectionBody({
  autoAddProvider,
  tab,
}: {
  autoAddProvider: boolean;
  tab: SettingsTab;
}) {
  switch (tab) {
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
    case "Providers": {
      return <ProvidersSection autoOpenAddProvider={autoAddProvider} />;
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

function useNavItems(): NavItem[] {
  const isDeveloperMode = useDeveloperMode();
  const { data: invalidFolders } = useQuery(
    rpcClient.workspace.storage.invalidFolders.list.queryOptions(),
  );
  const hasUnrecognizedFolders = (invalidFolders?.length ?? 0) > 0;

  return [
    {
      icon: FadersHorizontalIcon,
      tab: "General",
      title: "General",
    },
    {
      icon: FingerprintIcon,
      tab: "Memory",
      title: "Memory",
    },
    {
      icon: CpuIcon,
      tab: "Providers",
      title: "Providers",
    },
    {
      icon: CubeIcon,
      tab: "Skills",
      title: "Skills",
    },
    ...(hasUnrecognizedFolders
      ? [
          {
            icon: HardDrivesIcon,
            tab: "Storage" as const,
            title: "Storage",
          },
        ]
      : []),
    ...(isDeveloperMode
      ? [
          {
            icon: FlagIcon,
            isDeveloperMode: true,
            tab: "Features" as const,
            title: "Features",
          },
          {
            icon: CodeIcon,
            isDeveloperMode: true,
            tab: "Debug" as const,
            title: "Debug",
          },
        ]
      : []),
  ];
}
