import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { cn } from "@/client/lib/utils";
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree";
import { InfoIcon } from "@phosphor-icons/react/Info";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { type ReactNode } from "react";

import { type Project } from "./chats";
import { PickList, PickListAction } from "./pick-list";
import { ProjectMark } from "./project-mark";

/**
 * The dots at the edge of a row that stands for a project, opening the project's
 * own menu. Invisible until the caller's hover class, focus, or the open menu
 * shows them, so a list of projects is not a list of dots.
 */
export function ProjectActionsButton({
  className,
  onDetails,
  project,
}: {
  className?: string;
  onDetails: (project: Project) => void;
  project: Project;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`Actions for ${project.name}`}
          className={cn(
            "grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground opacity-0 hover:bg-foreground/8 hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100",
            className,
          )}
          type="button"
        >
          <DotsThreeIcon className="size-4" weight="bold" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="right">
        <DropdownMenuItem
          onSelect={() => {
            onDetails(project);
          }}
        >
          <InfoIcon className="size-4" />
          View project details
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A project's own menu on right click, around whatever row stands for the project. */
export function ProjectContextMenu({
  children,
  onDetails,
  project,
}: {
  children: ReactNode;
  onDetails: (project: Project) => void;
  project: Project;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={() => {
            onDetails(project);
          }}
        >
          <InfoIcon className="size-4" />
          View project details
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** The list's id for no project, which no project has. */
const NO_PROJECT_ID = "";

/** What stands for being in no project, where a project's mark would be. */
export function NoProjectMark() {
  return (
    <span
      aria-hidden
      className="size-3 shrink-0 rounded-full border border-dashed border-foreground/40"
    />
  );
}

/**
 * No project, then every project, a check on the one that is on, and a new
 * one at the foot: the list behind a row's project control and a chat's head
 * alike, so filing is learned once. It opens on a find field whose words the
 * foot offers to make into a project.
 */
export function ProjectPickList({
  chosen,
  onNew,
  onPick,
  projects,
}: {
  /** The id of the project that is on; No project is without it. */
  chosen: string | undefined;
  /** Makes a project, named for what was typed in the find field when anything was. */
  onNew: (name: string) => void;
  onPick: (id: string | null) => void;
  projects: Project[];
}) {
  const live = projects.filter((project) => !project.retired);
  return (
    <PickList
      chosen={chosen ?? NO_PROJECT_ID}
      entries={[
        {
          icon: <NoProjectMark />,
          id: NO_PROJECT_ID,
          isNone: true,
          label: "No project",
        },
        ...live.map((project) => ({
          icon: <ProjectMark project={project} />,
          id: project.id,
          label: project.name,
        })),
      ]}
      findPlaceholder="Find or make a project"
      foot={(find) => (
        <PickListAction
          onSelect={() => {
            onNew(find);
          }}
        >
          <PlusIcon className="size-3.5 text-muted-foreground" />
          <span className="min-w-0 truncate">
            {find ? `New project “${find}”…` : "New project…"}
          </span>
        </PickListAction>
      )}
      onPick={(id) => {
        onPick(id === NO_PROJECT_ID ? null : id);
      }}
    />
  );
}
