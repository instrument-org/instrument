import { projectsSectionOpenAtom } from "@/client/atoms/projects-section";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/client/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/client/components/ui/sidebar";
import {
  openCreateProject,
  openDeleteProject,
  openEditProject,
} from "@/client/lib/open-create-project";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  BagIcon,
  CaretRightIcon,
  DotsThreeOutlineVerticalIcon,
  PencilSimpleLineIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { type MakeRouteMatchUnion } from "@tanstack/react-router";
import { useAtom } from "jotai";

import { InternalLink } from "./internal-link";

export function NavProjects({ matches }: { matches: MakeRouteMatchUnion[] }) {
  const [isOpen, setIsOpen] = useAtom(projectsSectionOpenAtom);

  const { data: projects } = useQuery(
    rpcClient.workspace.project.live.list.experimental_liveOptions(),
  );

  const activeProjectId = matches.find(
    (match) => match.routeId === "/_app/projects/$id/",
  )?.params.id;

  return (
    <SidebarGroup className="px-3 py-2 group-data-[collapsible=icon]:hidden">
      {projects && projects.length > 0 ? (
        <Collapsible onOpenChange={setIsOpen} open={isOpen}>
          <div className="group/projects flex h-8 items-center">
            <SidebarGroupLabel
              asChild
              className="h-8 flex-1 gap-1 font-semibold text-sidebar-foreground/20 hover:text-sidebar-foreground/60"
            >
              <CollapsibleTrigger>
                <span>Projects</span>
                <CaretRightIcon
                  className={cn(
                    "size-3 shrink-0 transition-transform",
                    isOpen && "rotate-90",
                  )}
                />
              </CollapsibleTrigger>
            </SidebarGroupLabel>
            <button
              aria-label="Add a project"
              className="flex size-5 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/40 opacity-0 group-hover/projects:opacity-100 hover:text-sidebar-foreground"
              onClick={() => {
                openCreateProject();
              }}
              type="button"
            >
              <PlusIcon className="size-4" />
            </button>
          </div>
          <CollapsibleContent animated>
            <SidebarMenu className="gap-0.5">
              {projects.map((project) => (
                <SidebarMenuItem className="group/project" key={project.id}>
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
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <SidebarMenuAction showOnHover>
                        <DotsThreeOutlineVerticalIcon weight="fill" />
                        <span className="sr-only">Project actions</span>
                      </SidebarMenuAction>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" side="bottom">
                      <DropdownMenuItem
                        onSelect={() => {
                          openEditProject(project.id);
                        }}
                      >
                        <PencilSimpleLineIcon className="text-muted-foreground" />
                        <span>Edit project</span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => {
                          openDeleteProject(project.id);
                        }}
                        variant="destructive"
                      >
                        <TrashIcon className="size-4" />
                        <span>Delete project</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
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
              onClick={() => {
                openCreateProject();
              }}
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
