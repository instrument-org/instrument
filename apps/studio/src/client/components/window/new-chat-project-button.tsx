import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/client/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { cn } from "@/client/lib/utils";
import { CardsThreeIcon } from "@phosphor-icons/react/CardsThree";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { XIcon } from "@phosphor-icons/react/X";
import { useState } from "react";

import { type Project } from "./chats";
import { projectColor } from "./project-colors";
import { ProjectMark } from "./project-mark";
import { projectTint } from "./project-tint";

/**
 * The Project button beside a new chat's plus: a list of the workspace's
 * projects to type into, Return taking the first match. Once one is picked
 * the button wears that project's mark, name and tint, with an × that takes
 * it off.
 */
export function NewChatProjectButton({
  onPick,
  onReturnFocus,
  picked,
  projects,
}: {
  /** Files the new chat under a project, or under none. */
  onPick: (project: Project | undefined) => void;
  /** Puts the caret back in the prompt once the list has done its job. */
  onReturnFocus: () => void;
  picked: Project | undefined;
  projects: Project[];
}) {
  const [isOpen, setOpen] = useState(false);
  const [find, setFind] = useState("");
  const chose = (project: Project | undefined) => {
    setOpen(false);
    onPick(project);
    onReturnFocus();
  };
  return (
    <span
      className={cn(
        "flex h-7 shrink-0 items-center rounded-full text-xs",
        picked
          ? "bg-(--project-tint-surface) font-medium text-(--project-tint-ink) project-tint"
          : "text-muted-foreground ring-1 ring-foreground/10",
      )}
      data-slot="new-chat-project"
      style={picked ? projectTint(projectColor(picked)) : undefined}
    >
      <Popover
        onOpenChange={(next) => {
          setOpen(next);
          setFind("");
        }}
        open={isOpen}
      >
        <PopoverTrigger asChild>
          <button
            aria-label={picked ? `Project: ${picked.name}` : "Project"}
            className={cn(
              "flex h-full max-w-48 min-w-0 items-center gap-1.5 rounded-full pl-2.5",
              picked ? "pr-1" : "pr-2.5 hover:text-foreground",
            )}
            type="button"
          >
            {picked ? (
              <ProjectMark plain project={picked} />
            ) : (
              <CardsThreeIcon className="size-3.5 shrink-0" />
            )}
            <span className="min-w-0 truncate">
              {picked ? picked.name : "Project"}
            </span>
            {!picked && <CaretDownIcon className="size-2.5 shrink-0" />}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="flex w-64 flex-col rounded-[20px] p-0"
          // The caret goes back to the prompt, which `chose` does for a pick
          // and Escape leaves to this.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onReturnFocus();
          }}
          side="bottom"
        >
          <Command label="Projects">
            <div className="shrink-0 border-b p-1">
              <CommandInput
                autoFocus
                className="h-8 py-0"
                containerClassName="h-8 px-2.5"
                onValueChange={setFind}
                placeholder="Find a project"
                value={find}
              />
            </div>
            <CommandList className="p-1">
              <CommandEmpty className="px-2 py-1.5 text-xs text-muted-foreground">
                Nothing matches.
              </CommandEmpty>
              {projects.map((project) => (
                <CommandItem
                  className="rounded-2xl"
                  key={project.id}
                  onSelect={() => {
                    chose(project);
                  }}
                  value={project.name}
                >
                  <ProjectMark project={project} />
                  <span className="min-w-0 flex-1 truncate">
                    {project.name}
                  </span>
                  {picked?.id === project.id && (
                    <CheckIcon className="size-4" />
                  )}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {picked && (
        <button
          aria-label={`Take out of ${picked.name}`}
          className="mr-1 grid size-5 shrink-0 place-items-center rounded-full hover:bg-(--project-tint-edge)"
          onClick={() => {
            chose(undefined);
          }}
          type="button"
        >
          <XIcon className="size-3" />
        </button>
      )}
    </span>
  );
}
