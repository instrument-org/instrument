import {
  linkedFilesAtom,
  type OrchestratorRecent,
} from "@/client/atoms/orchestrator";
import { FileSystemFolderGlyph } from "@/client/components/extend/file-system";
import { Favicon } from "@/client/components/favicon";
import { FileIcon } from "@/client/components/file-icon";
import { FileOpenContext } from "@/client/components/file-open-context";
import { AppIcon } from "@/client/components/orchestrator/app-icon";
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
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { type ReactNode, useContext, useState } from "react";

/** How many of the files the conversation linked the sidebar lists. */
const FILES_SHOWN = 8;

/**
 * The top of the sidebar: the user's own things, above the conversation. For
 * now the apps that are connected and the files the conversation has handed
 * over; the places the product used to list here live on the new tab page.
 */
export function OrchestratorBookmarks({ className }: { className?: string }) {
  const navigate = useNavigate();
  const location = useRouterState({ select: (state) => state.location });
  const linkedFiles = useAtomValue(linkedFilesAtom);
  const apps = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const connectedApps = (apps.data?.apps ?? []).filter(
    (app) => app.standing === "connected",
  );
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
        {/* Each connected app is a place: its page, with the way to ask about it and the site itself behind. */}
        {connectedApps.length > 0 ? (
          <Section label="Apps">
            {connectedApps.map((app) => (
              <Item
                icon={<AppIcon site={app.site} size="sm" />}
                isActive={
                  location.pathname === `/orchestrator/apps/${app.slug}`
                }
                key={app.slug}
                label={app.name}
                onClick={() => {
                  void navigate({
                    params: { slug: app.slug },
                    to: "/orchestrator/apps/$slug",
                  });
                }}
              />
            ))}
          </Section>
        ) : null}

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
  // An announced icon that does not load (a site with none, a stale address)
  // gives way to the proxy's, then the globe, rather than a broken image.
  const [failed, setFailed] = useState<string | undefined>();
  if (favicon && failed !== favicon) {
    return (
      <img
        alt=""
        className="size-4 shrink-0 rounded-xs"
        draggable={false}
        onError={() => {
          setFailed(favicon);
        }}
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
}: {
  icon: ReactNode;
  isActive: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={isActive} onClick={onClick}>
        <span className="flex size-4 shrink-0 items-center justify-center">
          {icon}
        </span>
        <span className="truncate">{label}</span>
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
