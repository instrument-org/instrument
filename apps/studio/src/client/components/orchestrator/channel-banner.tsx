import { ChannelFace, type RailChannel } from "@/client/components/orchestrator/channel-rail";
import { cn } from "@/client/lib/utils";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { useEffect, useRef, useState } from "react";

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
 * The name is the thing you click to rename, the way a task's title is in the
 * classic window; the caret beside it opens the rest. Nothing about a channel
 * is edited from the rail, which stays a place to aim at.
 */
export function ChannelBanner({
  channel,
  onArchive,
  onRename,
  tasks,
}: {
  channel: RailChannel;
  /** Absent for the channel that cannot go: the conversation has to happen somewhere. */
  onArchive?: () => void;
  onRename: (name: string) => void;
  tasks: BannerTask[];
}) {
  const [isRenaming, setRenaming] = useState(false);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number }>();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming) {
      inputRef.current?.select();
    }
  }, [isRenaming]);

  useEffect(() => {
    if (!menuAt) {
      return;
    }
    const close = () => {
      setMenuAt(undefined);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuAt]);

  return (
    <>
      <div className="flex h-10 shrink-0 items-center gap-1 px-2">
        {isRenaming ? (
          <>
            <ChannelFace channel={channel} className="shrink-0 text-[15px]" />
            <input
              className="h-7 min-w-0 flex-1 rounded-md bg-card px-1.5 text-[13px] font-medium ring-1 ring-border outline-hidden focus:ring-ring"
              defaultValue={channel.name}
              maxLength={16}
              onBlur={() => {
                setRenaming(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setRenaming(false);
                  return;
                }
                if (event.key !== "Enter") {
                  return;
                }
                const name = event.currentTarget.value.trim();
                setRenaming(false);
                if (name && name !== channel.name) {
                  onRename(name);
                }
              }}
              ref={inputRef}
            />
          </>
        ) : (
          <>
            <button
              className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left hover:bg-accent/60"
              onClick={() => {
                setRenaming(true);
              }}
              title="Rename this channel"
              type="button"
            >
              <ChannelFace channel={channel} className="shrink-0 text-[15px]" />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                {channel.name}
              </span>
            </button>
            <button
              aria-label="Channel menu"
              className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                setMenuAt({ x: box.left, y: box.bottom + 4 });
              }}
              type="button"
            >
              <CaretDownIcon className="size-3.5" />
            </button>
          </>
        )}
      </div>
      <BannerWork tasks={tasks} />
      {menuAt && (
        <div
          className="fixed z-50 min-w-40 rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-md"
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          role="menu"
          style={{ left: menuAt.x, top: menuAt.y }}
        >
          <button
            className="flex w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent"
            onClick={() => {
              setMenuAt(undefined);
              setRenaming(true);
            }}
            role="menuitem"
            type="button"
          >
            Rename
          </button>
          <button
            className="flex w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent disabled:opacity-40"
            disabled={!onArchive}
            onClick={() => {
              setMenuAt(undefined);
              onArchive?.();
            }}
            role="menuitem"
            type="button"
          >
            Archive
          </button>
        </div>
      )}
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
