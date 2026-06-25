import type { Project, Task, TaskId } from "@instrument-org/workspace/client";
import type { ColumnDef } from "@tanstack/react-table";

import { InternalLink } from "@/client/components/internal-link";
import { TaskStatusIcon } from "@/client/components/session-status-icon";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import { ArrowsDownUpIcon, BagIcon, PushPinIcon } from "@phosphor-icons/react";
import { format, formatDistanceToNow } from "date-fns";

import { TaskActionsCell } from "./actions";
import { ModelPreview } from "./model-preview";
import { SessionStatusPreview } from "./session-status-preview";

export function createColumns({
  onDelete,
  onOpenInNewTab,
  onSettings,
  onStop,
  pinnedTaskIds,
  projects,
}: {
  onDelete: (id: TaskId) => void;
  onOpenInNewTab: (id: TaskId) => void;
  onSettings: (id: TaskId) => void;
  onStop: (id: TaskId) => void;
  pinnedTaskIds: Set<TaskId>;
  projects: Map<string, Project>;
}): ColumnDef<Task>[] {
  return [
    {
      accessorKey: "select",
      cell: ({ row }) => (
        // Make checkboxes more clickable with a before pseudo-element
        <label
          className="relative flex items-center justify-center before:absolute before:inset-0 before:-m-2 before:content-['']"
          onClick={(e) => {
            e.preventDefault();
            row.toggleSelected(!row.getIsSelected());
          }}
        >
          <Checkbox
            aria-label="Select row"
            checked={row.getIsSelected()}
            className="pointer-events-none"
            onCheckedChange={(value) => {
              row.toggleSelected(!!value);
            }}
          />
        </label>
      ),
      enableHiding: false,
      enableSorting: false,
      header: ({ table }) => (
        // Make checkboxes more clickable with a before pseudo-element
        <label
          className="relative flex items-center justify-center before:absolute before:inset-0 before:-m-2 before:content-['']"
          onClick={(e) => {
            e.preventDefault();
            table.toggleAllPageRowsSelected(!table.getIsAllPageRowsSelected());
          }}
        >
          <Checkbox
            aria-label="Select all"
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && "indeterminate")
            }
            className="pointer-events-none"
            onCheckedChange={(value) => {
              table.toggleAllPageRowsSelected(!!value);
            }}
          />
        </label>
      ),
      id: "select",
      size: 40,
    },
    {
      accessorKey: "title",
      cell: ({ row }) => {
        const task = row.original;
        const isPinned = pinnedTaskIds.has(task.id);
        return (
          <Button
            asChild
            className="w-full min-w-0 justify-start font-normal"
            variant="ghost"
          >
            <InternalLink
              className="flex min-w-0 items-center gap-x-2"
              openInCurrentTab
              params={{ id: task.id }}
              to="/tasks/$id"
            >
              {isPinned && (
                <PushPinIcon className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{task.title}</span>
              <TaskStatusIcon
                className="ml-auto size-4 shrink-0"
                id={task.id}
              />
            </InternalLink>
          </Button>
        );
      },
      header: ({ column }) => {
        return (
          <Button
            className="-ml-3"
            onClick={() => {
              column.toggleSorting(column.getIsSorted() === "asc");
            }}
            variant="ghost"
          >
            Task
            <ArrowsDownUpIcon className="ml-2 size-4" />
          </Button>
        );
      },
      maxSize: 400,
      minSize: 200,
    },
    {
      accessorKey: "projectId",
      cell: ({ row }) => {
        const task = row.original;
        const project = task.projectId ? projects.get(task.projectId) : null;
        if (!project) {
          return <span className="text-sm text-muted-foreground">—</span>;
        }
        return (
          <Button asChild className="font-normal" size="sm" variant="ghost">
            <InternalLink
              openInCurrentTab
              params={{ id: project.id }}
              to="/projects/$id"
            >
              <BagIcon className="size-4 shrink-0" />
              {project.name}
            </InternalLink>
          </Button>
        );
      },
      header: "Project",
      size: 160,
    },
    {
      accessorKey: "model",
      cell: ({ row }) => {
        const task = row.original;
        return <ModelPreview id={task.id} />;
      },
      header: "Model",
      minSize: 150,
    },
    {
      accessorKey: "chatPreview",
      cell: ({ row }) => {
        const task = row.original;
        return <SessionStatusPreview id={task.id} />;
      },
      header: "Chat preview",
      maxSize: 150,
      minSize: 100,
    },
    {
      accessorKey: "updatedAt",
      cell: ({ row }) => {
        const task = row.original;
        return (
          <span className="text-sm text-muted-foreground">
            {formatDistanceToNow(task.updatedAt, {
              addSuffix: true,
            })
              .replace("less than ", "")
              .replace("about ", "")}
          </span>
        );
      },
      header: ({ column }) => {
        return (
          <Button
            className="-ml-3"
            onClick={() => {
              column.toggleSorting(column.getIsSorted() === "asc");
            }}
            variant="ghost"
          >
            Updated
            <ArrowsDownUpIcon className="ml-2 size-4" />
          </Button>
        );
      },
      size: 130,
    },
    {
      accessorKey: "createdAt",
      cell: ({ row }) => {
        const task = row.original;
        return (
          <span className="text-sm text-muted-foreground">
            {format(task.createdAt, "MMM d, yyyy")}
          </span>
        );
      },
      header: ({ column }) => {
        return (
          <Button
            className="-ml-3"
            onClick={() => {
              column.toggleSorting(column.getIsSorted() === "asc");
            }}
            variant="ghost"
          >
            Created
            <ArrowsDownUpIcon className="ml-2 size-4" />
          </Button>
        );
      },
      size: 130,
    },
    {
      cell: ({ row }) => {
        const task = row.original;
        return (
          <TaskActionsCell
            id={task.id}
            onDelete={onDelete}
            onOpenInNewTab={onOpenInNewTab}
            onSettings={onSettings}
            onStop={onStop}
            projectId={task.projectId}
          />
        );
      },
      enableHiding: false,
      id: "actions",
      size: 100,
    },
  ];
}
