import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { openCreateProject } from "@/client/lib/open-create-project";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type ProjectId } from "@instrument-org/workspace/client";
import {
  BriefcaseIcon,
  CheckIcon,
  PlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";

export function PromptProjectSelector({
  disabled,
  onChange,
  value,
}: {
  disabled?: boolean;
  onChange: (projectId: null | ProjectId) => void;
  value: null | ProjectId;
}) {
  const { data: projects } = useQuery(
    rpcClient.workspace.project.live.list.experimental_liveOptions(),
  );

  const selected = projects?.find((project) => project.id === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {selected ? (
          <div
            className="group/chip flex h-8 items-center gap-1.5 rounded-md bg-muted px-2 text-sm text-muted-foreground hover:text-foreground"
            role="button"
          >
            <BriefcaseIcon className="size-4 shrink-0" />
            <span className="max-w-32 truncate">{selected.name}</span>
            <button
              aria-label="Remove from project"
              className="-mr-0.5 rounded-sm opacity-60 hover:opacity-100"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onChange(null);
              }}
              type="button"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        ) : (
          <Button
            className="size-8 p-0"
            disabled={disabled}
            size="sm"
            variant="ghost"
          >
            <BriefcaseIcon className="size-5" weight="regular" />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {projects?.map((project) => {
          const isCurrent = project.id === value;
          return (
            <DropdownMenuItem
              key={project.id}
              onSelect={() => {
                onChange(isCurrent ? null : project.id);
              }}
            >
              <BriefcaseIcon className="size-4 text-muted-foreground" />
              <span
                className={cn("flex-1 truncate", isCurrent && "font-medium")}
              >
                {project.name}
              </span>
              {isCurrent && <CheckIcon className="size-4" />}
            </DropdownMenuItem>
          );
        })}
        {projects && projects.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem
          onSelect={() => {
            openCreateProject();
          }}
        >
          <PlusIcon className="size-4 text-muted-foreground" />
          New project
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
