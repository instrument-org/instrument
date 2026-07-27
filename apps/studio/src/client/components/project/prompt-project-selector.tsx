import { openCreateProject } from "@/client/atoms/project-modal";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { immediateClickHandlers } from "@/client/lib/immediate-click";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type ProjectId } from "@instrument-org/workspace/client";
import { BagIcon, CheckIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
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
      {selected ? (
        <SelectedChip
          name={selected.name}
          onRemove={() => {
            onChange(null);
          }}
        />
      ) : (
        <DropdownMenuTrigger asChild>
          <Button
            className="size-8 p-0"
            disabled={disabled}
            size="sm"
            variant="ghost"
          >
            <BagIcon className="size-5" weight="regular" />
          </Button>
        </DropdownMenuTrigger>
      )}
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
        }}
      >
        {projects?.map((project) => {
          const isCurrent = project.id === value;
          return (
            <DropdownMenuItem
              key={project.id}
              onSelect={() => {
                onChange(isCurrent ? null : project.id);
              }}
            >
              <BagIcon className="size-4 text-muted-foreground" />
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

function SelectedChip({
  name,
  onRemove,
}: {
  name: string;
  onRemove: () => void;
}) {
  return (
    <div className="group/chip flex h-8 items-center gap-1.5 rounded-md bg-muted px-2 text-sm text-muted-foreground select-none hover:text-foreground">
      <DropdownMenuTrigger asChild>
        <button className="flex min-w-0 items-center gap-1.5" type="button">
          <BagIcon className="size-4 shrink-0" />
          <span className="max-w-32 truncate">{name}</span>
        </button>
      </DropdownMenuTrigger>
      <span className="grid grid-cols-[0fr] transition-[grid-template-columns] duration-150 ease-out group-hover/chip:grid-cols-[1fr]">
        <span className="flex items-center overflow-hidden">
          <button
            aria-label="Remove from project"
            className="-mr-0.5 flex translate-x-1 items-center rounded-sm opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover/chip:translate-x-0 group-hover/chip:opacity-60 hover:!opacity-100"
            {...immediateClickHandlers<HTMLButtonElement>({
              // Hover-revealed remove target: it appears under the pointer, so
              // a press must stay cancelable.
              activation: "release",
              onClick: onRemove,
            })}
            type="button"
          >
            <XIcon className="size-3.5" />
          </button>
        </span>
      </span>
    </div>
  );
}
