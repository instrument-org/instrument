import { openProjectDetails } from "@/client/atoms/project-details-modal";
import { Button } from "@/client/components/ui/button";
import { toast } from "@/client/lib/toast";
import { cn } from "@/client/lib/utils";
import { rpcClient, type RPCInput } from "@/client/rpc/client";
import {
  type ChangedProject,
  projectChangeLines,
  projectChangesHeading,
  projectLooks,
} from "@instrument-org/workspace/client";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/ArrowCounterClockwise";
import { CardsThreeIcon } from "@phosphor-icons/react/CardsThree";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ProjectMark, type ProjectMarkSpec } from "./window/project-mark";

/** How many projects show before the rest wait behind Show more. */
const SHOWN_PROJECTS = 5;

/** A changes card's part, by where it is in its chat. */
export type ChangesCard = NonNullable<
  RPCInput["workspace"]["projects"]["undoChanges"]["card"]
>;

/**
 * What a turn's `instrument projects` commands changed or made, as a card
 * under the reply in the chats card's frame: a heading drawn from the
 * changes ("Changed the icons and colors of 10 projects"), then each project
 * with its mark as it is now and a line for each kind of change: "Icon
 * updated", "Renamed from", "Deleted", "New project". Undo puts back
 * whatever still stands as the turn left it, deletes a project the turn
 * made, and the card then shows every change struck through.
 */
export function ProjectChangesCard({
  card,
  changes,
  undone: undoneBefore = false,
}: {
  /** Where the card is, for its Undo to mark it undone on every device. */
  card?: ChangesCard;
  changes: readonly ChangedProject[];
  /** Undone already, by this device or another. */
  undone?: boolean;
}) {
  const { data: projects = [] } = useQuery(
    rpcClient.workspace.projects.list.queryOptions(),
  );
  const [undoing, setUndoing] = useState(false);
  const [undoneHere, setUndone] = useState(false);
  const undone = undoneBefore || undoneHere;
  const [expanded, setExpanded] = useState(false);

  const undo = () => {
    setUndoing(true);
    return rpcClient.workspace.projects.undoChanges
      .call({
        ...(card && { card }),
        changes: changes.map(({ fields, name, project }) => ({
          fields: [...fields],
          name,
          ...(project ? { project } : {}),
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
          <CardsThreeIcon className="size-4 text-muted-foreground" />
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
            project={projects.find((each) =>
              change.project
                ? each.id === change.project.id
                : each.name === change.name,
            )}
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

/**
 * One project the turn touched: its mark and name, then a line for each
 * change. Undone, it is named and marked as it is again, before the turn,
 * with the changes struck through.
 */
function ProjectRow({
  change,
  project,
  undone,
}: {
  change: ChangedProject;
  /** The project as the list has it now; absent for one gone. */
  project: (ProjectMarkSpec & { id: string; retired?: boolean }) | undefined;
  undone: boolean;
}) {
  const { after: now, before } = projectLooks(change, { ...project });
  const name = (undone ? before.name : now.name) ?? change.name;
  const away = !undone && project?.retired === true;
  const quiet = away || undone;
  const nameClassName = cn(
    "min-w-0 truncate text-sm leading-5",
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
            {name}
          </button>
        ) : (
          <span className={nameClassName}>{name}</span>
        )}
      </span>
      <span className="mt-1 flex flex-col gap-0.5 pl-7">
        {projectChangeLines(change).map((line) => (
          <span className={lineClassName} key={line.kind}>
            {line.kind === "renamed" ? (
              <span>
                {undone ? "Renamed to" : "Renamed from"}{" "}
                <span className="text-muted-foreground/80">
                  “{undone ? line.after : line.before}”
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
