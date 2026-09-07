import {
  ChannelChip,
  type ChannelMark,
  type RailChannel,
} from "@/client/components/orchestrator/channel-rail";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { cn } from "@/client/lib/utils";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { useRef, useState } from "react";

import { ChannelMarkPicker } from "./channel-mark-picker";

/** A task of this channel, as the line under the banner says it. */
export interface BannerTask {
  isDone?: boolean;
  step: string;
  taskId: string;
  title: string;
}

/**
 * The channel's name at the top of its conversation, and under it what the
 * channel is working on.
 *
 * The mark opens the picker, the name becomes the field that renames it, and
 * the caret beside the name reaches both. Nothing about a channel is edited
 * from the rail, which stays a place to aim at.
 */
export function ChannelBanner({
  canEdit,
  channel,
  onArchive,
  onColor,
  onEmoji,
  onRename,
  tasks,
}: {
  /**
   * False for the channel the conversation started in: it keeps the mark and
   * the name it has, since it is the app's own room rather than one the user
   * made.
   */
  canEdit: boolean;
  channel: ChannelMark & RailChannel;
  /** Absent for the channel that cannot go: the conversation has to happen somewhere. */
  onArchive?: () => void;
  onColor: (color: string) => void;
  onEmoji: (emoji: string) => void;
  onRename: (name: string) => void;
  tasks: BannerTask[];
}) {
  const [isRenaming, setRenaming] = useState(false);
  const [isPicking, setPicking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = () => {
    const name = inputRef.current?.value.trim();
    setRenaming(false);
    if (name && name !== channel.name) {
      onRename(name);
    }
  };

  const mark = (
    <ChannelChip channel={channel} className="size-7 bg-card text-[15px]" />
  );

  return (
    <>
      <div className="flex h-10 shrink-0 items-center gap-1 px-2">
        {canEdit ? (
          <ChannelMarkPicker
            onColor={onColor}
            onEmoji={onEmoji}
            onOpenChange={setPicking}
            open={isPicking}
            {...(channel.color === undefined ? {} : { color: channel.color })}
          >
            <button
              aria-label="Change this channel's mark"
              className="shrink-0 rounded-lg hover:opacity-80"
              type="button"
            >
              {mark}
            </button>
          </ChannelMarkPicker>
        ) : (
          mark
        )}
        {isRenaming ? (
          <input
            className="h-7 min-w-0 flex-1 rounded-md bg-card px-1.5 text-[13px] font-medium ring-1 ring-border outline-hidden focus:ring-ring"
            defaultValue={channel.name}
            maxLength={16}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setRenaming(false);
                return;
              }
              if (event.key === "Enter") {
                // `commit` reads the field rather than a state the change
                // handler kept, so Enter saves what is on screen.
                event.preventDefault();
                commit();
              }
            }}
            ref={(element) => {
              inputRef.current = element;
              element?.select();
            }}
          />
        ) : (
          // Sized to the name rather than to the row, so the caret hugs it.
          <div className="flex min-w-0 items-center">
            <button
              className={cn(
                "min-w-0 truncate rounded-md px-1 py-0.5 text-left text-[13px] font-medium",
                canEdit && "hover:bg-accent/60",
              )}
              disabled={!canEdit}
              onClick={() => {
                setRenaming(true);
              }}
              title={canEdit ? "Rename this channel" : channel.name}
              type="button"
            >
              {channel.name}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label="Channel menu"
                  className="grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  type="button"
                >
                  <CaretDownIcon className="size-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-44">
                <DropdownMenuItem
                  disabled={!canEdit}
                  onSelect={() => {
                    setRenaming(true);
                  }}
                >
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!canEdit}
                  onSelect={(event) => {
                    // The picker is a popover of its own; letting the menu
                    // close first would take the trigger with it.
                    event.preventDefault();
                    setPicking(true);
                  }}
                >
                  Change mark and color
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={!onArchive}
                  onSelect={() => {
                    onArchive?.();
                  }}
                  variant="destructive"
                >
                  Archive
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
      <BannerWork tasks={tasks} />
    </>
  );
}

/**
 * What this channel is working on, folded to one line.
 *
 * Folded is where it lives: one line whether the channel has one task or a
 * dozen, so a conversation that spawns many of them cannot grow the sidebar.
 * No mark beside the step, because the step's own shimmer is what says
 * something is happening.
 */
function BannerWork({ tasks }: { tasks: BannerTask[] }) {
  const [isOpen, setOpen] = useState(false);
  if (tasks.length === 0) {
    return null;
  }
  const newest = tasks[0];
  return (
    <div className="mx-2 mb-1 shrink-0 rounded-lg bg-card/70 px-2 py-1 ring-1 ring-border">
      <button
        className="flex w-full items-center gap-1.5 text-left text-[11px]"
        onClick={() => {
          setOpen((open) => !open);
        }}
        type="button"
      >
        {isOpen ? (
          <CaretDownIcon className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <CaretRightIcon className="size-3 shrink-0 text-muted-foreground" />
        )}
        {isOpen ? (
          <span className="text-muted-foreground">
            {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate">
            {tasks.length > 1 ? `${tasks.length} tasks · ` : ""}
            <span className={cn(!newest?.isDone && "brand-shiny-text")}>
              {newest?.step}
            </span>
          </span>
        )}
      </button>
      {isOpen &&
        tasks.map((task) => (
          <div className="border-t border-border/60 py-1" key={task.taskId}>
            <p className="truncate text-[12px] font-medium">{task.title}</p>
            <p
              className={cn(
                "truncate text-[11px]",
                task.isDone ? "text-muted-foreground" : "brand-shiny-text",
              )}
            >
              {task.step}
            </p>
          </div>
        ))}
    </div>
  );
}
