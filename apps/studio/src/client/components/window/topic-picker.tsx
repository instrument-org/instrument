import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { type ComponentProps, type ReactNode, useState } from "react";

import { type Topic } from "./chats";
import { stopHere } from "./row-shell";
import { TopicPickList } from "./topic-menu";

/** The dashed slot a topic goes in while there is none, as a picker's trigger. */
export function AddTopicChip(props: ComponentProps<"button">) {
  return (
    <button
      className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-dashed border-border px-2 text-[11px] text-muted-foreground hover:border-foreground/30 hover:text-foreground data-[state=open]:text-foreground"
      type="button"
      {...props}
    >
      <PlusIcon className="size-3" />
      Topic
    </button>
  );
}

/**
 * The one way a chat, a draft or a row is filed: a find field that also
 * makes a topic of what was typed, every topic with a check on each that is
 * on, and New topic at the foot, opening under whatever the caller hands in
 * as its trigger. A pick keeps the list open where several topics can be on
 * and closes it where only one can.
 */
export function TopicPicker({
  align = "start",
  children,
  chosen,
  isOpen,
  onNew,
  onOpenChange,
  onToggle,
  single = false,
  topics,
}: {
  align?: "center" | "end" | "start";
  /** The trigger, which the list opens under. */
  children: ReactNode;
  chosen: ReadonlySet<string>;
  /** The open state, for a caller that keeps it; the picker keeps its own otherwise. */
  isOpen?: boolean;
  /** Makes a topic, named for what was typed when anything was. */
  onNew: (name: string) => void;
  onOpenChange?: (open: boolean) => void;
  onToggle: (id: string) => void;
  /** Whether only one topic can be on, as on a draft. */
  single?: boolean;
  topics: Topic[];
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
        <TopicPickList
          chosen={chosen}
          files
          onNew={(name) => {
            setOpen(false);
            onNew(name);
          }}
          onToggle={(id) => {
            onToggle(id);
            if (single) {
              setOpen(false);
            }
          }}
          topics={topics}
        />
      </PopoverContent>
    </Popover>
  );
}
