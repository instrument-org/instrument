import { AppIcon } from "@/client/components/app-icon";
import { AppStatusIcon } from "@/client/components/app-status-icon";
import { cn } from "@/client/lib/utils";
import { type Tab as TabData } from "@/shared/tabs";
import { X } from "lucide-react";
import { motion, Reorder } from "motion/react";

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
    <AppIcon isSelected={isSelected} name={item.iconName} size="sm" />
  ) : null;

  return (
    <Reorder.Item
      animate={{
        opacity: 1,
        transition: { duration: 0.1, ease: "easeInOut" },
      }}
      className={cn(
        "group relative flex min-h-0 min-w-0 select-none [-webkit-app-region:no-drag]",
        item.pinned ? "shrink-0" : "w-full max-w-60 flex-1 overflow-hidden",
        item.pinned
          ? cn(
              "h-full items-center justify-center px-2.5 py-2 transition-colors duration-150",
              isSelected
                ? "rounded-xl bg-background shadow-sm"
                : "rounded-xl hover:bg-muted/60",
            )
          : cn(
              "h-full items-center transition-[background-color,border-radius,box-shadow] duration-150",
              isSelected
                ? "gap-2 rounded-xl bg-background py-2 pr-1.5 pl-3 shadow-sm"
                : cn(
                    "py-2 pr-2 pl-3 hover:rounded-xl hover:bg-muted/60 hover:pr-1.5",
                    showSeparator &&
                      "after:pointer-events-none after:absolute after:top-1/4 after:right-0 after:h-1/2 after:w-px after:bg-border/50 after:content-['']",
                  ),
            ),
      )}
      dragListener={!item.pinned}
      exit={{
        maxWidth: 0,
        opacity: 0,
        transition: { duration: 0.15, ease: "linear" },
      }}
      id={item.id}
      initial={{ opacity: 1 }}
      onPointerDown={(event: React.PointerEvent<HTMLLIElement>) => {
        if (event.button === 1) {
          onRemove();
        } else {
          onClick();
        }
      }}
      title={item.title || ""}
      transition={{ duration: 0.15, ease: "easeOut", type: "tween" }}
      value={item}
    >
      <motion.div
        className={cn(
          "flex min-w-0 flex-1 items-center",
          iconSlot && "gap-2",
          item.pinned && "justify-center",
        )}
      >
        {iconSlot ? <div className="shrink-0">{iconSlot}</div> : null}
        {!item.pinned && (
          <>
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
          </>
        )}
      </motion.div>
      {!item.pinned && (
        <div className="flex shrink-0 items-center gap-1 pl-1">
          {item.projectSubdomain && !isSelected ? (
            <div className="group-hover:hidden">
              <AppStatusIcon
                className="size-4 shrink-0"
                subdomain={item.projectSubdomain}
              />
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
            type="button"
          >
            <X
              className={cn(
                "size-3.5 transition-colors",
                isSelected ? "text-foreground" : "text-muted-foreground",
              )}
            />
          </button>
        </div>
      )}
    </Reorder.Item>
  );
};
