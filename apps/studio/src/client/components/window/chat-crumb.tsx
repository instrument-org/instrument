import { cn } from "@/client/lib/utils";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { type ReactNode } from "react";

import { ScreenMark } from "./app-chip";
import { type Project } from "./chats";
import { projectColor } from "./project-colors";
import { ProjectMark } from "./project-mark";
import { ProjectPicker } from "./project-picker";
import { projectTint } from "./project-tint";

/** One of the crumb's two presses, filled as the title's own two are. */
const SEGMENT =
  "flex h-8 items-center outline-none group-hover/crumb:bg-foreground/5 group-has-data-[state=open]/crumb:bg-foreground/5 hover:bg-foreground/8 focus-visible:outline-[3px] focus-visible:-outline-offset-3 focus-visible:outline-ring/50 focus-visible:[outline-style:solid]";

/**
 * What a chat is under, ahead of its title as a step of a path: its project,
 * or Chats for one in none. A press on the name shows those chats in the side
 * panel, or puts it away when it shows them already. The slash
 * after it turns into a caret under the pointer or the keyboard, in the same
 * space, and opens the list that files the chat elsewhere. On a narrow head
 * the mark stands alone.
 */
export function ChatCrumb({
  isPicking,
  onNewProject,
  onPickingChange,
  onSetProject,
  onShowChats,
  project,
  projects,
}: {
  isPicking: boolean;
  onNewProject: (name?: string) => void;
  onPickingChange: (isPicking: boolean) => void;
  onSetProject: (project: null | string) => void;
  /** Shows the chats the name stands for, the project's or every chat, in the side panel. */
  onShowChats: (project: string | undefined) => void;
  /** The project the chat is filed under. */
  project: Project | undefined;
  projects: Project[];
}) {
  const name = project?.name ?? "Chats";
  const mark: ReactNode = project ? (
    <ProjectMark project={project} />
  ) : (
    <ScreenMark className="size-4" name="chats" />
  );
  return (
    <div className="group/crumb mr-1.5 -ml-1.5 flex h-8 max-w-1/2 min-w-0 shrink-0 items-center">
      <button
        aria-label={project ? `Show chats in ${name}` : "Show all chats"}
        className={cn(
          SEGMENT,
          "min-w-0 gap-1.5 rounded-l-lg pr-1 pl-1.5 text-sm",
          project
            ? "project-tint text-(--project-tint-ink)"
            : "text-muted-foreground",
        )}
        onClick={() => {
          onShowChats(project?.id);
        }}
        style={project ? projectTint(projectColor(project)) : undefined}
        title={name}
        type="button"
      >
        {mark}
        <span className="max-w-40 min-w-0 truncate @max-sm/chathead:hidden">
          {name}
        </span>
      </button>
      <ProjectPicker
        chosen={project?.id}
        isOpen={isPicking}
        onNew={onNewProject}
        onOpenChange={onPickingChange}
        onPick={onSetProject}
        projects={projects}
      >
        <button
          aria-label="Change project"
          className={cn(
            SEGMENT,
            "group/pick w-5 shrink-0 justify-center rounded-r-lg data-[state=open]:bg-foreground/8",
          )}
          title="Change project"
          type="button"
        >
          <span
            aria-hidden
            className="text-sm text-foreground/30 group-hover/crumb:hidden group-has-focus-visible/crumb:hidden group-data-[state=open]/pick:hidden"
          >
            /
          </span>
          <CaretDownIcon className="hidden size-3 text-muted-foreground group-hover/crumb:block group-has-focus-visible/crumb:block group-data-[state=open]/pick:block" />
        </button>
      </ProjectPicker>
    </div>
  );
}
