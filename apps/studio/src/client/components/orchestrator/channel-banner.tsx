import { ChannelFace } from "@/client/components/orchestrator/channel-rail";
import { cn } from "@/client/lib/utils";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { useRef, useState } from "react";

/** A task of this channel, as the line under the banner says it. */
export interface BannerTask {
  isDone?: boolean;
  step: string;
  taskId: string;
  title: string;
}

/**
 * What this channel is working on, folded to one line.
 *
 * Folded is where it lives: one line whether the channel has one task or a
 * dozen, so a conversation that spawns many of them cannot grow the sidebar.
 * No mark beside the step, because the step's own shimmer is what says
 * something is happening.
 */
export function BannerWork({ tasks }: { tasks: BannerTask[] }) {
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

/**
 * The channel's name across the top of its conversation, on its own color.
 *
 * The mark is here as well as on the rail. Drawn twice on the same ground that
 * read as a mistake; on the channel's color it reads as the channel's header
 * rather than as the rail's tile repeated. Clicking the name renames it.
 */
export function ChannelBanner({
  canEdit,
  channel,
  onMenu,
  onRename,
}: {
  /**
   * False for the channel the conversation started in: it keeps the name it
   * has, since it is the app's own room rather than one the user made.
   */
  canEdit: boolean;
  channel: { color?: string; emoji?: string; name: string };
  /** The caret: the same menu the rail opens on right click. */
  onMenu: (at: { x: number; y: number }) => void;
  onRename: (name: string) => void;
}) {
  const [isRenaming, setRenaming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = () => {
    const name = inputRef.current?.value.trim();
    setRenaming(false);
    if (name && name !== channel.name) {
      onRename(name);
    }
  };

  return (
    <div
      className="flex h-10 shrink-0 items-center gap-2 px-3"
      // The channel's own color across the top of its conversation. The mark
      // is here as well as on the rail, which read as a mistake when both
      // sat on the same ground; on the channel's color it reads as the
      // channel's own header rather than as the rail's tile repeated.
      style={{
        background: channel.color ? `${channel.color}1f` : undefined,
      }}
    >
      <ChannelFace channel={channel} className="shrink-0 text-[15px]" />
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
            onContextMenu={(event) => {
              event.preventDefault();
              onMenu({ x: event.clientX, y: event.clientY });
            }}
            title={canEdit ? "Rename this channel" : channel.name}
            type="button"
          >
            {channel.name}
          </button>
          <button
            aria-label="Channel menu"
            className="grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              onMenu({ x: box.left, y: box.bottom + 4 });
            }}
            type="button"
          >
            <CaretDownIcon className="size-3" />
          </button>
        </div>
      )}
    </div>
  );
}
