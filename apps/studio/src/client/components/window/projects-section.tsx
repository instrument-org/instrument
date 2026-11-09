import { cn } from "@/client/lib/utils";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { useAtom } from "jotai";
import { type ReactNode, useState } from "react";

import { byNewestChat, type Project } from "./chats";
import { projectsOpenAtom } from "./chat-list-view";
import { projectColor } from "./project-colors";
import { ProjectMark } from "./project-mark";
import { ProjectActionsButton, ProjectContextMenu } from "./project-menu";
import { projectTint } from "./project-tint";

/** How many projects show before the rest fold under a More row. */
const SHOWN_PROJECTS = 4;

/**
 * The projects at the top of the inbox, one row each in its tint: its mark
 * on a white tile, its name in its ink, and how many chats are filed under
 * it. The project with the newest chat comes first, and past four the rest
 * fold under a row that says how many more there are, which opens them all
 * with Show less at their foot; five show whole, since a More row for one
 * would take the room the fifth would. The heading's caret folds the whole
 * section, kept for every window on this computer, and its + makes a project.
 */
export function ProjectsSection({
  chats,
  onChoose,
  onDetails,
  onNew,
  projects,
}: {
  chats: { archived: boolean; lastUserMessageAt: number; project?: string }[];
  onChoose: (project: Project) => void;
  onDetails: (project: Project) => void;
  onNew: () => void;
  projects: Project[];
}) {
  const [isOpen, setOpen] = useAtom(projectsOpenAtom);
  const [isAllShown, setAllShown] = useState(false);
  const ordered = byNewestChat(
    projects.filter((project) => !project.retired),
    chats,
  );
  const isFolding = ordered.length > SHOWN_PROJECTS + 1;
  const shown = isFolding ? ordered.slice(0, SHOWN_PROJECTS) : ordered;
  const folded = isFolding ? ordered.slice(SHOWN_PROJECTS) : [];
  const counts = new Map<string, number>();
  for (const chat of chats) {
    // Counted as the project's view lists them, which leaves out the ones put away.
    if (chat.project !== undefined && !chat.archived) {
      counts.set(chat.project, (counts.get(chat.project) ?? 0) + 1);
    }
  }
  const row = (project: Project) => (
    <ProjectContextMenu
      key={project.id}
      onDetails={onDetails}
      project={project}
    >
      <div
        className="group/project flex h-9 items-center rounded-lg bg-(--project-tint-surface)/45 project-tint hover:bg-(--project-tint-surface)/70 has-focus-visible:bg-(--project-tint-surface)/70 dark:bg-(--project-tint-surface)/20 dark:hover:bg-(--project-tint-surface)/35"
        style={projectTint(projectColor(project))}
      >
        <button
          className="flex h-full min-w-0 flex-1 items-center gap-2.5 pl-1.5 text-left text-sm font-medium text-(--project-tint-ink) outline-hidden"
          onClick={() => {
            onChoose(project);
          }}
          type="button"
        >
          <span className="grid size-6 shrink-0 place-items-center rounded-md bg-background shadow-xs dark:bg-background/80">
            <ProjectMark
              className="size-4 text-[13px]"
              plain
              project={project}
            />
          </span>
          <span className="truncate">{project.name}</span>
        </button>
        {/* The count gives way to the dots under the pointer. */}
        <span className="relative flex h-5 min-w-8 items-center justify-end pr-2.5">
          <span className="text-xs text-(--project-tint-ink)/70 tabular-nums group-hover/project:invisible group-has-data-[state=open]/project:invisible">
            {counts.get(project.id) ?? ""}
          </span>
          <ProjectActionsButton
            className="absolute right-1.5 group-hover/project:opacity-100"
            onDetails={onDetails}
            project={project}
          />
        </span>
      </div>
    </ProjectContextMenu>
  );
  return (
    <section aria-label="Projects" className="px-2 pt-1 pb-2">
      <div className="flex h-8 items-center justify-between pr-0.5 pl-2">
        <button
          aria-expanded={isOpen}
          className="flex h-6 items-center gap-1 rounded-md pr-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          onClick={() => {
            setOpen(!isOpen);
          }}
          type="button"
        >
          Projects
          <CaretDownIcon
            className={cn(
              "size-3 transition-transform motion-reduce:transition-none",
              !isOpen && "-rotate-90",
            )}
            weight="bold"
          />
        </button>
        <button
          aria-label="New project"
          className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          onClick={onNew}
          title="New project"
          type="button"
        >
          <PlusIcon className="size-3.5" weight="bold" />
        </button>
      </div>
      <Unfold isOpen={isOpen}>
        <div className="flex flex-col gap-1">
          {shown.map(row)}
          {folded.length > 0 && (
            // Its own gap inside, so a closed fold adds none to the list.
            <Unfold className="-mt-1" isOpen={isAllShown}>
              <div className="flex flex-col gap-1 pt-1">{folded.map(row)}</div>
            </Unfold>
          )}
          {isFolding && (
            <button
              className="flex h-9 items-center gap-2.5 rounded-lg bg-foreground/4 pl-1.5 text-left text-sm text-muted-foreground hover:bg-foreground/6 hover:text-foreground"
              onClick={() => {
                setAllShown(!isAllShown);
              }}
              type="button"
            >
              <span className="grid size-6 place-items-center">
                <DotsThreeIcon className="size-4" weight="bold" />
              </span>
              {isAllShown
                ? "Show less"
                : `${ordered.length - SHOWN_PROJECTS} more projects`}
            </button>
          )}
        </div>
      </Unfold>
    </section>
  );
}

/**
 * Rows that open and close by growing to their height and shrinking back,
 * kept drawn while closed so the closing can play; closed, they are out of
 * reach of the pointer, the keyboard and a screen reader.
 */
function Unfold({
  children,
  className,
  isOpen,
}: {
  children: ReactNode;
  className?: string;
  isOpen: boolean;
}) {
  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
        isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr] opacity-0",
        className,
      )}
    >
      <div className="min-h-0 overflow-hidden" inert={!isOpen}>
        {children}
      </div>
    </div>
  );
}
