import {
  type OrchestratorRecent,
  orchestratorRecentsAtom,
} from "@/client/atoms/orchestrator";
import { FileSystemFolderGlyph } from "@/client/components/extend/file-system";
import { FileIcon } from "@/client/components/file-icon";
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
import { rpcClient } from "@/client/rpc/client";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { CompassIcon } from "@phosphor-icons/react/Compass";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { HouseIcon } from "@phosphor-icons/react/House";
import { LaptopIcon } from "@phosphor-icons/react/Laptop";
import { PushPinIcon } from "@phosphor-icons/react/PushPin";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import ms from "ms";
import { type ComponentType, type ReactNode } from "react";

import { useOrchestrator } from "./context";

/** How often the tasks' status is re-read, for the badge on Tasks. */
const REFRESH_MS = ms("2 seconds");

/** How many recent screens the sidebar lists. */
const RECENTS_SHOWN = 8;

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
 * where the user has been. Tasks is a place, not a list: the screen behind it
 * holds the tasks.
 */
export function OrchestratorSidebar({ className }: { className?: string }) {
  const { browser, taskId } = useOrchestrator();
  const navigate = useNavigate();
  const router = useRouter();
  const location = useRouterState({ select: (state) => state.location });
  const recents = useAtomValue(orchestratorRecentsAtom);
  const children = useQuery(
    rpcClient.workspace.orchestrator.children.queryOptions({
      input: { id: taskId },
      refetchInterval: REFRESH_MS,
    }),
  );
  const childIds = children.data?.map((child) => child.id) ?? [];
  const status = useQuery(
    rpcClient.workspace.task.agentStatus.byIds.queryOptions({
      input: { ids: childIds },
      refetchInterval: REFRESH_MS,
    }),
  );
  const here = {
    pathname: location.pathname,
    search: location.search as Record<string, unknown>,
  };
  const isAtPlace = PLACES.some((place) => place.isAt(here));
  const workingCount =
    status.data?.filter((entry) =>
      entry.sessionActors.some((actor) => actor.tags.includes("agent.alive")),
    ).length ?? 0;

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
                trailing={
                  place.label === "Tasks" && workingCount > 0 ? (
                    <span className="brand-shiny-text ml-auto text-xs">
                      {workingCount} working
                    </span>
                  ) : undefined
                }
              />
            ))}
          </SidebarMenu>
        </SidebarGroup>

        <Section label="Pinned">
          {PINNED.map((pin) => (
            <Item
              icon={<PushPinIcon className="size-4 shrink-0" />}
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

        {recents.length > 0 ? (
          <Section label="Recent">
            {recents.slice(0, RECENTS_SHOWN).map((recent) => (
              <Item
                icon={<RecentIcon recent={recent} />}
                // A recent that is also a place lights the place, not itself.
                isActive={!isAtPlace && location.href === recent.href}
                key={recent.href}
                label={recent.title}
                onClick={() => {
                  router.history.push(recent.href);
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
      return <GlobeIcon className="size-4 shrink-0" />;
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
