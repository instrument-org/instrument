import { cn } from "@/client/lib/utils";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { useAtom } from "jotai";
import { useState } from "react";

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
  chats: { lastUserMessageAt: number; project?: string }[];
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
  const shown =
    isFolding && !isAllShown ? ordered.slice(0, SHOWN_PROJECTS) : ordered;
  const counts = new Map<string, number>();
  for (const chat of chats) {
    if (chat.project !== undefined) {
      counts.set(chat.project, (counts.get(chat.project) ?? 0) + 1);
    }
  }
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
      {isOpen && (
        <div className="flex flex-col gap-1">
          {shown.map((project) => (
            <ProjectContextMenu
              key={project.id}
              onDetails={onDetails}
              project={project}
            >
              <div
                className="group/project flex h-9 items-center rounded-lg bg-(--project-tint-surface)/45 project-tint hover:bg-(--project-tint-surface)/70 has-focus-visible:bg-(--project-tint-surface)/70"
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
                    <ProjectMark className="size-4" plain project={project} />
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
          ))}
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
      )}
    </section>
  );
}
