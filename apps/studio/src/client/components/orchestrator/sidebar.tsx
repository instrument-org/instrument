import {
  linkedFilesAtom,
  type OrchestratorRecent,
  originOf,
  siteFaviconsAtom,
} from "@/client/atoms/orchestrator";
import { FileSystemFolderGlyph } from "@/client/components/extend/file-system";
import { Favicon } from "@/client/components/favicon";
import { FileIcon } from "@/client/components/file-icon";
import { FileOpenContext } from "@/client/components/file-open-context";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/client/components/ui/sidebar";
import { InstrumentGlyph } from "@/client/components/wordmark";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { CompassIcon } from "@phosphor-icons/react/Compass";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { HouseIcon } from "@phosphor-icons/react/House";
import { LaptopIcon } from "@phosphor-icons/react/Laptop";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { type ComponentType, type ReactNode, useContext } from "react";

import { useOrchestrator } from "./context";

/** How many of the files the conversation linked the sidebar lists. */
const FILES_SHOWN = 8;

/**
 * The places in the product, the way the wireframes list them. Home,
 * Discover, and Apps are fixtures for now: a screen each, empty but for a
 * line saying what will live there, so the sidebar can be felt whole.
 */
interface Place {
  icon: RowIcon;
  /** Whether the location is this place; the same screen can be two places. */
  isAt: (location: {
    pathname: string;
    search: Record<string, unknown>;
  }) => boolean;
  label: string;
  open: (navigate: ReturnType<typeof useNavigate>) => void;
}

/** What a row draws in its icon slot. */
type RowIcon = ComponentType<{ className?: string }>;

const atPath = (to: string) => (location: { pathname: string }) =>
  location.pathname === to || location.pathname.startsWith(`${to}/`);

const PLACES: Place[] = [
  {
    icon: HouseIcon,
    isAt: atPath("/orchestrator/home"),
    label: "Home",
    open: (navigate) => void navigate({ to: "/orchestrator/home" }),
  },
  {
    icon: CompassIcon,
    isAt: atPath("/orchestrator/discover"),
    label: "Discover",
    open: (navigate) => void navigate({ to: "/orchestrator/discover" }),
  },
  {
    icon: GlobeIcon,
    isAt: atPath("/orchestrator/browser"),
    label: "Browser",
    open: (navigate) =>
      void navigate({ search: {}, to: "/orchestrator/browser" }),
  },
  {
    icon: LaptopIcon,
    isAt: atPath("/orchestrator/computer"),
    label: "This Mac",
    open: (navigate) =>
      void navigate({
        search: { path: "", root: "~" },
        to: "/orchestrator/computer",
      }),
  },
  {
    icon: AppWindowIcon,
    isAt: atPath("/orchestrator/apps"),
    label: "Apps",
    open: (navigate) => void navigate({ to: "/orchestrator/apps" }),
  },
  {
    // The mark, not a checklist: the tasks are the agent's, not to-dos.
    icon: InstrumentGlyph,
    isAt: atPath("/orchestrator/tasks"),
    label: "Tasks",
    open: (navigate) => void navigate({ to: "/orchestrator/tasks" }),
  },
];

/**
 * Services pinned as web apps. Fixtures for now: what a pin is and how it
 * arrives are still being decided, and what matters first is what the sidebar
 * feels like with them in it.
 */
const PINNED: { name: string; url: string }[] = [
  { name: "Gmail", url: "https://mail.google.com/" },
  { name: "Notion", url: "https://www.notion.so/" },
  { name: "Linear", url: "https://linear.app/" },
];

/**
 * The window's left side: the places at the top, then what is pinned, then
 * the files the conversation has handed over. Tasks is a place, not a list:
 * the screen behind it holds the tasks.
 */
export function OrchestratorSidebar({ className }: { className?: string }) {
  const { browser } = useOrchestrator();
  const navigate = useNavigate();
  const location = useRouterState({ select: (state) => state.location });
  const linkedFiles = useAtomValue(linkedFilesAtom);
  const siteFavicons = useAtomValue(siteFaviconsAtom);
  const openFile = useContext(FileOpenContext);
  const here = {
    pathname: location.pathname,
    search: location.search as Record<string, unknown>,
  };
  const openFilePath =
    location.pathname === "/orchestrator/computer"
      ? (here.search as { file?: string }).file
      : undefined;

  return (
    <Sidebar className={className} collapsible="none" side="left">
      <SidebarContent className="gap-0 scroll-fade-y">
        <SidebarGroup className="px-3 pt-1 pb-2">
          <SidebarMenu>
            {PLACES.map((place) => (
              <Item
                icon={<place.icon className="size-4 shrink-0" />}
                isActive={place.isAt(here)}
                key={place.label}
                label={place.label}
                onClick={() => {
                  place.open(navigate);
                }}
              />
            ))}
          </SidebarMenu>
        </SidebarGroup>

        <Section label="Pinned">
          {PINNED.map((pin) => (
            <Item
              icon={
                <SiteIcon
                  favicon={siteFavicons[originOf(pin.url) ?? ""]}
                  url={pin.url}
                />
              }
              isActive={false}
              key={pin.name}
              label={pin.name}
              onClick={() => {
                // One tab per pin: the tab already on that site comes forward.
                browser?.openOrFocus(pin.url);
                void navigate({ to: "/orchestrator/browser" });
              }}
            />
          ))}
        </Section>

        {/* What the conversation has handed over, newest first: the files
            worth coming back to, rather than every screen the window passed
            through. */}
        {linkedFiles.length > 0 ? (
          <Section label="Files">
            {linkedFiles.slice(0, FILES_SHOWN).map((file) => (
              <Item
                icon={
                  <FileIcon className="size-4 shrink-0" filename={file.name} />
                }
                isActive={openFilePath === file.path}
                key={file.path}
                label={file.name}
                onClick={() => {
                  openFile?.(file.path);
                }}
              />
            ))}
          </Section>
        ) : null}
      </SidebarContent>
    </Sidebar>
  );
}

/** What stands for a recent screen: the Finder's own folder and file icons, the globe, the mark. */
export function RecentIcon({ recent }: { recent: OrchestratorRecent }) {
  switch (recent.kind) {
    case "browser": {
      return <SiteIcon favicon={recent.favicon} />;
    }
    case "file": {
      return <FileIcon className="size-4 shrink-0" filename={recent.title} />;
    }
    case "folder": {
      return <FileSystemFolderGlyph className="h-3.5 w-auto shrink-0" />;
    }
    case "task": {
      return <InstrumentGlyph className="size-4 shrink-0" />;
    }
  }
}

/**
 * A site's icon: the one its page announced when a tab has one, else the
 * one the favicon proxy serves for the address, else the globe.
 */
export function SiteIcon({
  favicon,
  url,
}: {
  favicon?: string | undefined;
  url?: string | undefined;
}) {
  if (favicon) {
    return (
      <img
        alt=""
        className="size-4 shrink-0 rounded-xs"
        draggable={false}
        src={favicon}
      />
    );
  }
  if (url) {
    return <Favicon className="size-4 shrink-0 rounded-xs" url={url} />;
  }
  return <GlobeIcon className="size-4 shrink-0" />;
}

function Item({
  icon,
  isActive,
  label,
  onClick,
  trailing,
}: {
  icon: ReactNode;
  isActive: boolean;
  label: string;
  onClick: () => void;
  trailing?: ReactNode;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={isActive} onClick={onClick}>
        <span className="flex size-4 shrink-0 items-center justify-center">
          {icon}
        </span>
        <span className="truncate">{label}</span>
        {trailing}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function Section({ children, label }: { children: ReactNode; label: string }) {
  return (
    <SidebarGroup className="px-3 py-2">
      <SidebarGroupLabel className="h-8 font-semibold text-sidebar-foreground/40">
        {label}
      </SidebarGroupLabel>
      <SidebarMenu>{children}</SidebarMenu>
    </SidebarGroup>
  );
}
