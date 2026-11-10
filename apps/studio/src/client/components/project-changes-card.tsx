import { openProjectDetails } from "@/client/atoms/project-details-modal";
import { Button } from "@/client/components/ui/button";
import { toast } from "@/client/lib/toast";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  type ChangedProject,
  projectChangeLines,
  projectChangesHeading,
  projectLookBefore,
} from "@instrument-org/workspace/client";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/ArrowCounterClockwise";
import { ArrowRightIcon } from "@phosphor-icons/react/ArrowRight";
import { CardsThreeIcon } from "@phosphor-icons/react/CardsThree";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ProjectMark, type ProjectMarkSpec } from "./window/project-mark";

/** How many projects show before the rest wait behind Show more. */
const SHOWN_PROJECTS = 5;

/**
 * What a turn's `instrument projects` commands changed, as a card under the
 * reply in the chats card's frame: a heading drawn from the changes ("Changed
 * the icons and colors of 10 projects"), then each project with its old mark
 * beside its new one, a rename, or a delete. Undo puts back whatever still
 * stands as the turn left it, and the card then shows every change struck
 * through.
 */
export function ProjectChangesCard({
  changes,
}: {
  changes: readonly ChangedProject[];
}) {
  const { data: projects = [] } = useQuery(
    rpcClient.workspace.projects.list.queryOptions(),
  );
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const undo = () => {
    setUndoing(true);
    return rpcClient.workspace.projects.undoChanges
      .call({
        changes: changes.map(({ fields, name }) => ({
          fields: [...fields],
          name,
        })),
      })
      .then(({ skipped, undone: count }) => {
        if (count === 0) {
          toast.info("There was nothing left to undo.");
          return;
        }
        setUndone(true);
        toast.success(
          skipped === 0
            ? "Your projects are back the way they were."
            : "Your projects are back the way they were, except what you changed since.",
        );
      })
      .catch((error: unknown) => {
        toast.error("Couldn't undo that", { cause: error });
      })
      .finally(() => {
        setUndoing(false);
      });
  };

  const shown = expanded ? changes : changes.slice(0, SHOWN_PROJECTS);
  const hidden = changes.length - shown.length;

  return (
    <div
      className={cn(
        "mt-3 max-w-115 overflow-hidden rounded-2xl border border-border/80 bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04)]",
        undone && "bg-muted/40",
      )}
      data-slot="project-changes"
    >
      <div className="flex h-11 items-center gap-2 border-b border-border/70 px-4">
        <span className="flex h-5 w-4 shrink-0 items-center justify-center">
          <CardsThreeIcon
            className={cn(
              "size-4",
              undone ? "text-muted-foreground" : "text-brand-600",
            )}
          />
        </span>
        <span
          className={cn(
            "flex-1 truncate text-sm leading-5 font-medium",
            undone ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {projectChangesHeading(changes)}
        </span>
        {undone ? (
          <span className="-mr-1.5 flex h-7 items-center gap-1 px-2 text-xs text-muted-foreground">
            <CheckIcon className="size-3" />
            Undone
          </span>
        ) : (
          <Button
            className="-mr-1.5 h-7 gap-1 px-2 text-xs text-muted-foreground"
            disabled={undoing}
            onClick={() => {
              void undo();
            }}
            size="sm"
            variant="ghost"
          >
            <ArrowCounterClockwiseIcon className="size-3" />
            Undo
          </Button>
        )}
      </div>
      <ul className="divide-y divide-border/60 px-4">
        {shown.map((change) => (
          <ProjectRow
            change={change}
            key={change.name}
            project={projects.find((each) => each.name === change.name)}
            undone={undone}
          />
        ))}
      </ul>
      {hidden > 0 && (
        <button
          className="w-full border-t border-border/60 px-4 py-2.5 text-left text-xs text-muted-foreground hover:text-foreground"
          onClick={() => {
            setExpanded(true);
          }}
          type="button"
        >
          Show {hidden.toString()} more
        </button>
      )}
    </div>
  );
}

/** One project the turn touched: its mark and name, then a line for each change. */
function ProjectRow({
  change,
  project,
  undone,
}: {
  change: ChangedProject;
  /** The project as the list has it now; absent for one since renamed or gone. */
  project: (ProjectMarkSpec & { id: string; retired?: boolean }) | undefined;
  undone: boolean;
}) {
  const now: ProjectMarkSpec = { ...project, name: change.name };
  const before: ProjectMarkSpec = {
    ...projectLookBefore(now, change.fields),
    name: change.name,
  };
  const away = !undone && project?.retired === true;
  const quiet = away || undone;
  const nameClassName = cn(
    "min-w-0 truncate text-sm leading-5",
    undone && "line-through",
    quiet ? "text-muted-foreground" : "text-foreground",
  );
  const lineClassName = cn(
    "flex min-w-0 items-center gap-1.5 truncate text-xs leading-5",
    undone && "line-through",
    quiet ? "text-muted-foreground/80" : "text-muted-foreground",
  );
  return (
    <li className="py-3">
      <span className="flex min-w-0 items-center gap-2">
        <ProjectMark
          className={cn("size-5 rounded-md", quiet && "opacity-50")}
          project={undone ? before : now}
        />
        {project && !project.retired && !undone ? (
          <button
            className={cn(nameClassName, "text-left hover:underline")}
            onClick={() => {
              openProjectDetails(project.id);
            }}
            type="button"
          >
            {change.name}
          </button>
        ) : (
          <span className={nameClassName}>{change.name}</span>
        )}
      </span>
      <span className="mt-1 flex flex-col gap-0.5 pl-7">
        {projectChangeLines(change).map((line) => (
          <span className={lineClassName} key={line.kind}>
            {line.kind === "look" ? (
              <>
                <ProjectMark project={before} />
                <ArrowRightIcon className="size-2.75 text-muted-foreground/70" />
                <ProjectMark project={now} />
                <span>{line.words}</span>
              </>
            ) : line.kind === "renamed" ? (
              <span>
                Renamed from{" "}
                <span className="text-muted-foreground/80">
                  “{line.before}”
                </span>
              </span>
            ) : (
              <span>{line.words}</span>
            )}
          </span>
        ))}
      </span>
    </li>
  );
}
