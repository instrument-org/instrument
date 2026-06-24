import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/client/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/client/components/ui/sidebar";
import { openCreateProject } from "@/client/lib/open-create-project";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { BagIcon, CaretRightIcon, PlusIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { type MakeRouteMatchUnion } from "@tanstack/react-router";
import { useState } from "react";

import { InternalLink } from "./internal-link";

export function NavProjects({ matches }: { matches: MakeRouteMatchUnion[] }) {
  const [isOpen, setIsOpen] = useState(true);
  const openCreate = openCreateProject;

  const { data: projects } = useQuery(
    rpcClient.workspace.project.live.list.experimental_liveOptions(),
  );

  const activeProjectId = matches.find(
    (match) => match.routeId === "/_app/projects/$id/",
  )?.params.id;

  return (
    <SidebarGroup className="px-3 group-data-[collapsible=icon]:hidden">
      {projects && projects.length > 0 ? (
        <Collapsible onOpenChange={setIsOpen} open={isOpen}>
          <div className="group/projects relative">
            <SidebarGroupLabel
              asChild
              className="font-semibold text-sidebar-foreground/20 hover:text-sidebar-foreground/60"
            >
              <CollapsibleTrigger>
                <CaretRightIcon
                  className={cn(
                    "mr-1 size-3 transition-transform",
                    isOpen && "rotate-90",
                  )}
                />
                Projects
              </CollapsibleTrigger>
            </SidebarGroupLabel>
            <SidebarGroupAction
              aria-label="Add a project"
              className="text-sidebar-foreground/40 opacity-0 group-hover/projects:opacity-100"
              onClick={openCreate}
            >
              <PlusIcon />
            </SidebarGroupAction>
          </div>
          <CollapsibleContent animated>
            <SidebarMenu className="gap-0.5">
              {projects.map((project) => (
                <SidebarMenuItem key={project.id}>
                  <SidebarMenuButton
                    asChild
                    className="h-9 gap-2 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-foreground"
                    isActive={project.id === activeProjectId}
                  >
                    <InternalLink
                      openInCurrentTab
                      params={{ id: project.id }}
                      to="/projects/$id"
                    >
                      <BagIcon className="size-4 shrink-0" />
                      <span className="truncate">{project.name}</span>
                    </InternalLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </CollapsibleContent>
        </Collapsible>
      ) : (
        <SidebarMenu>
          <SidebarMenuItem className="group/add">
            <SidebarMenuButton
              className="h-9 gap-2 text-sidebar-foreground/40 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              onClick={openCreate}
            >
              <BagIcon className="size-4 shrink-0" />
              <span className="flex-1 text-left">Add a project</span>
              <PlusIcon className="size-4 shrink-0 group-hover/add:text-sidebar-foreground" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      )}
    </SidebarGroup>
  );
}
