import type { Task, TaskId } from "@instrument-org/workspace/client";
import type { ColumnDef } from "@tanstack/react-table";

import { InternalLink } from "@/client/components/internal-link";
import { TaskStatusIcon } from "@/client/components/session-status-icon";
import { TaskIcon } from "@/client/components/task-icon";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import { ArrowsDownUpIcon, StarIcon } from "@phosphor-icons/react";
import { format, formatDistanceToNow } from "date-fns";

import { ProjectActionsCell } from "./actions";
import { ModelPreview } from "./model-preview";
import { SessionStatusPreview } from "./session-status-preview";

export function createColumns({
  favoriteProjectSubdomains,
  onDelete,
  onOpenInNewTab,
  onSettings,
  onStop,
}: {
  favoriteProjectSubdomains: Set<string>;
  onDelete: (id: TaskId) => void;
  onOpenInNewTab: (id: TaskId) => void;
  onSettings: (id: TaskId) => void;
  onStop: (id: TaskId) => void;
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
        const project = row.original;
        const isFavorite = favoriteProjectSubdomains.has(project.id);
        return (
          <div className="flex min-w-0 items-center gap-x-2">
            {isFavorite && (
              <StarIcon
                className="size-4 shrink-0 fill-warning-500 text-warning-500"
                weight="fill"
              />
            )}
            <InternalLink
              className="flex min-w-0 flex-1 items-center gap-x-2"
              openInCurrentTab
              params={{ id: project.id }}
              to="/tasks/$id"
            >
              <TaskIcon name={project.iconName} size="sm" />
              <span className="truncate font-medium">{project.title}</span>
              <TaskStatusIcon
                className="ml-auto size-4 shrink-0"
                id={project.id}
              />
            </InternalLink>
          </div>
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
      accessorKey: "model",
      cell: ({ row }) => {
        const project = row.original;
        return <ModelPreview id={project.id} />;
      },
      header: "Model",
      minSize: 150,
    },
    {
      accessorKey: "chatPreview",
      cell: ({ row }) => {
        const project = row.original;
        return <SessionStatusPreview id={project.id} />;
      },
      header: "Chat preview",
      maxSize: 150,
      minSize: 100,
    },
    {
      accessorKey: "updatedAt",
      cell: ({ row }) => {
        const project = row.original;
        return (
          <span className="text-sm text-muted-foreground">
            {formatDistanceToNow(project.updatedAt, {
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
        const project = row.original;
        return (
          <span className="text-sm text-muted-foreground">
            {format(project.createdAt, "MMM d, yyyy")}
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
        const project = row.original;
        return (
          <ProjectActionsCell
            id={project.id}
            onDelete={onDelete}
            onOpenInNewTab={onOpenInNewTab}
            onSettings={onSettings}
            onStop={onStop}
          />
        );
      },
      enableHiding: false,
      id: "actions",
      size: 100,
    },
  ];
}
