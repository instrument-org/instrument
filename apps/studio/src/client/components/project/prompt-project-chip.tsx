import { rpcClient } from "@/client/rpc/client";
import { type ProjectId } from "@instrument-org/workspace/client";
import { CardsThreeIcon, XIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";

/**
 * The project this prompt will start its task in, once one has been picked.
 *
 * There is no empty state: a prompt with no project shows nothing at all, and
 * the plus menu is where one is chosen. Renders nothing until the list resolves
 * the ID to a name.
 */
export function PromptProjectChip({
  disabled,
  onOpenPicker,
  onRemove,
  projectId,
}: {
  disabled?: boolean;
  onOpenPicker: () => void;
  onRemove: () => void;
  projectId: ProjectId;
}) {
  const { data: projects } = useQuery(
    rpcClient.workspace.project.live.list.experimental_liveOptions(),
  );
  const project = projects?.find((candidate) => candidate.id === projectId);

  if (!project) {
    return null;
  }

  return (
    <div className="group/chip flex h-8 min-w-0 items-center gap-1.5 rounded-lg bg-muted px-2 text-sm text-foreground/60 select-none hover:text-foreground">
      <button
        className="flex min-w-0 items-center gap-1.5"
        disabled={disabled}
        onClick={onOpenPicker}
        type="button"
      >
        <CardsThreeIcon className="size-5 shrink-0" />
        <span className="max-w-32 truncate">{project.name}</span>
      </button>
      <span className="grid grid-cols-[0fr] transition-[grid-template-columns] duration-150 ease-out group-hover/chip:grid-cols-[1fr]">
        <span className="flex items-center overflow-hidden">
          <button
            aria-label="Remove from project"
            className="-mr-0.5 flex translate-x-1 items-center rounded-sm p-0.5 opacity-0 transition-[opacity,transform,background-color] duration-150 ease-out group-hover/chip:translate-x-0 group-hover/chip:opacity-60 hover:bg-foreground/10 hover:!opacity-100"
            disabled={disabled}
            onClick={onRemove}
            type="button"
          >
            <XIcon className="size-3.5" />
          </button>
        </span>
      </span>
    </div>
  );
}
