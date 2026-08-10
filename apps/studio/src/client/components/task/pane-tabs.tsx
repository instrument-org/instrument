import { FileIcon } from "@/client/components/file-icon";
import { cn } from "@/client/lib/utils";
import { TaskPane } from "@instrument-org/workspace/client";
import { GlobeIcon, XIcon } from "@phosphor-icons/react";

import { PaneToggle } from "./pane-toggle";

/**
 * The pane's tab strip, and the close control at its right end.
 *
 * Tabs are positional and uncapped. A cap would have to evict something the
 * user was reading, and the answer to an over-eager agent is telling it what is
 * already open rather than throwing tabs away behind it.
 */
export function PaneTabs({
  onClose,
  onSelect,
  selectedKey,
  tabs,
  taskId,
}: {
  onClose: (key: string) => void;
  onSelect: (key: string) => void;
  selectedKey: string | undefined;
  tabs: TaskPane.Tab[];
  taskId: Parameters<typeof PaneToggle>[0]["taskId"];
}) {
  return (
    // `h-10 px-2` matches `FileViewerHeader` and `ViewerToolbar`, the rows that
    // stack under this one, so the three read as one band. No rule under it:
    // the row below draws its own, and two hairlines a row apart break the band
    // into pieces rather than separating anything.
    <div className="flex h-10 shrink-0 items-center gap-1 px-2">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const key = TaskPane.tabKey(tab);
          return (
            <PaneTab
              isSelected={key === selectedKey}
              key={key}
              onClose={() => {
                onClose(key);
              }}
              onSelect={() => {
                onSelect(key);
              }}
              tab={tab}
            />
          );
        })}
      </div>

      <PaneToggle taskId={taskId} />
    </div>
  );
}

function PaneTab({
  isSelected,
  onClose,
  onSelect,
  tab,
}: {
  isSelected: boolean;
  onClose: () => void;
  onSelect: () => void;
  tab: TaskPane.Tab;
}) {
  const filename =
    tab.type === "file"
      ? tab.filePath.slice(tab.filePath.lastIndexOf("/") + 1)
      : "Browser";

  return (
    // A div rather than a button, because the close control sits inside it and
    // a button inside a button is not a thing the DOM has.
    <div
      className={cn(
        "group/pane-tab flex h-7 min-w-0 shrink items-center gap-1.5 rounded-md pr-1 pl-2 text-xs",
        isSelected
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50",
      )}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      role="tab"
      tabIndex={0}
    >
      {tab.type === "file" ? (
        <FileIcon className="size-4 shrink-0" filename={filename} />
      ) : (
        <GlobeIcon className="size-4 shrink-0" />
      )}

      <span className="min-w-0 truncate">{filename}</span>

      {/* The browser tab is fixed: it is the pane's zero state, so there is
          nothing behind it to fall back to. Held open for a selected file tab,
          since the one being read is the one most likely to be closed and
          hunting for a control that only exists under the cursor is worse than
          a button that is always there. */}
      {tab.type === "file" && (
        <button
          aria-label={`Close ${filename}`}
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded-sm hover:bg-foreground/10",
            isSelected
              ? "opacity-100"
              : "opacity-0 group-hover/pane-tab:opacity-100",
          )}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          type="button"
        >
          <XIcon className="size-3" />
        </button>
      )}
    </div>
  );
}
