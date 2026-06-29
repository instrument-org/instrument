import { projectsSectionOpenAtom } from "@/client/atoms/projects-section";
import { ProjectDevDiskMenuItems } from "@/client/components/dev-disk-menu-items";
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
import { useInlineRename } from "@/client/hooks/use-inline-rename";
import {
  openCreateProject,
  openDeleteProject,
} from "@/client/lib/project-overlays";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type Project } from "@instrument-org/workspace/client";
import {
  BagIcon,
  CaretRightIcon,
  DotsThreeOutlineVerticalIcon,
  PencilSimpleLineIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type MakeRouteMatchUnion } from "@tanstack/react-router";
import { useAtom } from "jotai";
import { useState } from "react";

import { InlineRenameInput } from "./inline-rename-input";
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
              className="h-8 flex-1 gap-1 font-semibold text-sidebar-foreground/40 hover:text-sidebar-foreground/60"
            >
              <CollapsibleTrigger>
                <span>Projects</span>
                <CaretRightIcon
                  className={cn(
                    "!size-3 shrink-0 transition-transform",
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
              <PlusIcon className="!size-3" />
            </button>
          </div>
          <CollapsibleContent>
            <SidebarMenu className="gap-0.5">
              {projects.map((project) => (
                <NavProjectItem
                  activeProjectId={activeProjectId}
                  key={project.id}
                  project={project}
                />
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
              <span className="flex-1 font-medium">Add a project</span>
              <PlusIcon className="size-3! shrink-0 group-hover/add:text-sidebar-foreground" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      )}
    </SidebarGroup>
  );
}

function NavProjectItem({
  activeProjectId,
  project,
}: {
  activeProjectId: string | undefined;
  project: Project;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const { mutateAsync: renameProject } = useMutation(
    rpcClient.workspace.project.update.mutationOptions(),
  );

  const rename = useInlineRename({
    onSave: async (next) => {
      await renameProject({ id: project.id, name: next });
    },
    value: project.name,
  });

  if (rename.isEditing) {
    return (
      <SidebarMenuItem className="group/project">
        <InlineRenameInput inputProps={rename.inputProps} />
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem className="group/project">
      <DropdownMenu onOpenChange={setIsMenuOpen} open={isMenuOpen}>
        <SidebarMenuButton
          asChild
          className="h-9 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground data-[active=true]:text-sidebar-foreground"
          isActive={project.id === activeProjectId}
          onContextMenu={(e) => {
            e.preventDefault();
            setIsMenuOpen(true);
          }}
        >
          <InternalLink
            onDoubleClick={(e) => {
              if (project.id !== activeProjectId) {
                return;
              }
              if (!(e.target as Element).closest("[data-project-title]")) {
                return;
              }
              rename.start();
            }}
            openInCurrentTab
            params={{ id: project.id }}
            to="/projects/$id"
          >
            <BagIcon className="size-4 shrink-0 text-gray-400 [[data-active=true]_&]:text-sidebar-foreground" />
            <span className="truncate" data-project-title>
              {project.name}
            </span>
          </InternalLink>
        </SidebarMenuButton>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover>
            <DotsThreeOutlineVerticalIcon weight="fill" />
            <span className="sr-only">Project actions</span>
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="bottom">
          <DropdownMenuItem onClick={rename.start}>
            <PencilSimpleLineIcon className="text-muted-foreground" />
            <span>Rename</span>
          </DropdownMenuItem>
          <ProjectDevDiskMenuItems projectId={project.id} />
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
  );
}
