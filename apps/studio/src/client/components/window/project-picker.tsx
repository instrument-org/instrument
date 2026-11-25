import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { type ReactNode, useState } from "react";

import { type Project } from "./chats";
import { stopHere } from "./row-shell";
import { ProjectPickList } from "./project-menu";

/**
 * The one way a chat is filed: a find field that also makes a project of what
 * was typed, No project and every project with a check on the one it is
 * under, and New project at the foot, opening under whatever the caller hands
 * in as its trigger. A pick closes it, since a chat is under one project or
 * none.
 */
export function ProjectPicker({
  align = "start",
  children,
  chosen,
  isOpen,
  onNew,
  onOpenChange,
  onPick,
  projects,
}: {
  align?: "center" | "end" | "start";
  /** The trigger, which the list opens under. */
  children: ReactNode;
  /** The id of the project it is under, when it is under one. */
  chosen: string | undefined;
  /** The open state, for a caller that keeps it; the picker keeps its own otherwise. */
  isOpen?: boolean;
  /** Makes a project, named for what was typed when anything was. */
  onNew: (name: string) => void;
  onOpenChange?: (open: boolean) => void;
  /** Files it under a project, or under none with `null`. The one it is under already only closes the list. */
  onPick: (id: string | null) => void;
  projects: Project[];
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = isOpen ?? ownOpen;
  const setOpen = (next: boolean) => {
    setOwnOpen(next);
    onOpenChange?.(next);
  };
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align={align}
        className="flex w-60 flex-col p-1"
        // Focus does not come back to the trigger as the list closes: a
        // trigger shown only on hover would stay for it after the pointer
        // had gone.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
        }}
        // A right click inside the list is the list's, never a menu of
        // whatever row or head the list opened from.
        onContextMenu={stopHere}
        role="menu"
        side="bottom"
        sideOffset={4}
      >
        <ProjectPickList
          chosen={chosen}
          onNew={(name) => {
            setOpen(false);
            onNew(name);
          }}
          onPick={(id) => {
            if (id !== (chosen ?? null)) {
              onPick(id);
            }
            setOpen(false);
          }}
          projects={projects}
        />
      </PopoverContent>
    </Popover>
  );
}
