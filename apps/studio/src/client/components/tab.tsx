import { TaskStatusIcon } from "@/client/components/session-status-icon";
import { TaskIcon } from "@/client/components/task-icon";
import { UnreadDot } from "@/client/components/unread-dot";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type Tab as TabData } from "@/shared/tabs";
import { XIcon } from "@phosphor-icons/react";
import { skipToken, useQuery } from "@tanstack/react-query";
import { motion, Reorder, useReducedMotion } from "motion/react";

const SkeletonTitle = () => {
  return (
    <div className="min-w-0 flex-1">
      <div className="h-3.5 w-16 animate-pulse rounded-sm bg-muted" />
    </div>
  );
};

const tabTitleMaskStyle = {
  maskImage:
    "linear-gradient(to right, #000 0%, #000 calc(100% - 1.5rem), transparent 100%)",
  WebkitMaskImage:
    "linear-gradient(to right, #000 0%, #000 calc(100% - 1.5rem), transparent 100%)",
} as const;

export const Tab = ({
  isSelected,
  item,
  onClick,
  onRemove,
  showSeparator,
}: {
  isSelected: boolean;
  item: TabData;
  onClick: () => void;
  onRemove: () => void;
  showSeparator: boolean;
}) => {
  const iconSlot = item.iconName ? (
    <TaskIcon isSelected={isSelected} name={item.iconName} size="sm" />
  ) : null;

  const prefersReducedMotion = useReducedMotion();

  // Reduced motion collapses the width instantly (a snap, not a slide) and only
  // crossfades; otherwise tabs grow in and collapse out symmetrically. max-w-60
  // == 15rem, so the enter target matches the resting cap.
  const motionStates = prefersReducedMotion
    ? {
        animate: { opacity: 1 },
        exit: { opacity: 0, transition: { duration: 0.1 } },
        initial: { opacity: 0 },
      }
    : {
        animate: { maxWidth: "15rem", opacity: 1 },
        exit: {
          maxWidth: 0,
          opacity: 0,
          transition: { duration: 0.18, ease: "easeOut" as const },
        },
        initial: { maxWidth: 0, opacity: 0 },
      };

  const { data: task } = useQuery(
    rpcClient.workspace.task.live.byId.experimental_liveOptions({
      input: item.taskId ? { id: item.taskId } : skipToken,
    }),
  );
  const isUnread = Boolean(task?.unreadIndicator);

  return (
    <Reorder.Item
      animate={motionStates.animate}
      className={cn(
        "group relative flex min-h-0 min-w-0 select-none [-webkit-app-region:no-drag]",
        "w-full max-w-60 flex-1 overflow-hidden",
        "h-full items-center transition-[background-color,border-radius,box-shadow] duration-150",
        isSelected
          ? "gap-2 rounded-xl bg-background py-2 pr-1.5 pl-3 shadow-soft"
          : cn(
              "py-2 pr-1.5 pl-3 hover:rounded-xl hover:bg-muted/60",
              showSeparator &&
                "after:pointer-events-none after:absolute after:top-1/4 after:right-0 after:h-1/2 after:w-px after:bg-gray-300 after:content-[''] hover:after:hidden dark:after:bg-border/50",
            ),
      )}
      exit={motionStates.exit}
      id={item.id}
      initial={motionStates.initial}
      // popLayout removes a closing tab from flow immediately; `layout` is what
      // lets the remaining tabs slide/resize to fill the gap via transforms
      // instead of reflowing every frame.
      layout={prefersReducedMotion ? undefined : "position"}
      onPointerDown={(event: React.PointerEvent<HTMLLIElement>) => {
        if (event.button === 1) {
          onRemove();
        } else if (event.button === 0) {
          onClick();
        }
      }}
      title={item.title || ""}
      transition={{ duration: 0.18, ease: "easeOut", type: "tween" }}
      value={item}
    >
      <motion.div
        className={cn(
          "flex min-w-0 flex-1 items-center",
          (iconSlot ?? isUnread) && "gap-2",
        )}
      >
        {isUnread ? <UnreadDot className="shrink-0" /> : null}
        {iconSlot ? <div className="shrink-0">{iconSlot}</div> : null}
        {item.title ? (
          <motion.span
            className={cn(
              "min-w-0 flex-1 overflow-hidden text-sm font-medium text-clip whitespace-nowrap transition-colors",
              isSelected
                ? "text-foreground"
                : "text-muted-foreground group-hover:text-foreground",
            )}
            style={tabTitleMaskStyle}
          >
            {item.title}
          </motion.span>
        ) : (
          <SkeletonTitle />
        )}
      </motion.div>
      <div className="flex shrink-0 items-center gap-1 pl-1">
        {item.taskId && !isUnread && !isSelected ? (
          <div className="flex items-center group-hover:hidden">
            <TaskStatusIcon className="size-3 shrink-0" id={item.taskId} />
          </div>
        ) : null}
        <button
          className={cn(
            "rounded-md p-1 opacity-70 ring-offset-background transition-opacity hover:bg-muted/80 hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none",
            isSelected ? "flex" : "hidden group-hover:flex",
          )}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          // The item selects on pointerdown; stop it here so clicking a
          // background tab's close button doesn't first select that tab (which
          // would then close and move selection to its neighbor, not stay put).
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          type="button"
        >
          <XIcon
            className={cn(
              "size-3 transition-colors",
              isSelected ? "text-foreground" : "text-muted-foreground",
            )}
          />
        </button>
      </div>
    </Reorder.Item>
  );
};
