import { FileIcon } from "@/client/components/file-icon";
import { tabTitleMaskStyle } from "@/client/lib/tab-title-mask";
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
        {tabs.map((tab, index) => {
          const key = TaskPane.tabKey(tab);
          const next = tabs[index + 1];
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
              // A rule after the browser, which is fixed where the rest are
              // the task's own and come and go. Drawn once, between the two
              // kinds rather than between every pair, and dropped when the tab
              // on its right is selected: that tab's own background already
              // separates them, and a rule beside it reads as uneven, because
              // only one side of the gap is filled.
              showSeparator={
                tab.type === "browser" &&
                next !== undefined &&
                TaskPane.tabKey(next) !== selectedKey
              }
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
  showSeparator,
  tab,
}: {
  isSelected: boolean;
  onClose: () => void;
  onSelect: () => void;
  showSeparator: boolean;
  tab: TaskPane.Tab;
}) {
  const filename =
    tab.type === "file"
      ? tab.filePath.slice(tab.filePath.lastIndexOf("/") + 1)
      : "Browser";
  const isClosable = tab.type === "file";

  return (
    // A div rather than a button, because the close control sits inside it and
    // a button inside a button is not a thing the DOM has. `select-none` and
    // the default cursor are what keep it reading as a control rather than as
    // text that happens to respond to clicks.
    <div
      className={cn(
        "group/pane-tab relative flex h-7 max-w-48 min-w-0 shrink cursor-default items-center gap-1.5 rounded-md px-2 text-xs select-none",
        // A floor on the width of a closable tab, which is what gives the name
        // a box wider than itself to fade into. Without it the name's box ends
        // where the text does, and the fade lands in the middle of a short
        // filename instead of under the control it is making room for.
        isClosable && "min-w-28",
        isSelected
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50",
        // Sat in the gap rather than against an edge, so a tab taking a
        // background on hover never appears to grow the rule onto itself. The
        // margin leaves the same 8px either side of it.
        showSeparator &&
          "mr-3 after:pointer-events-none after:absolute after:top-1/4 after:-right-2 after:h-1/2 after:w-px after:bg-border after:content-[''] hover:after:hidden",
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

      {/* The close sits over the name's last few pixels rather than beside it,
          so a tab is the width of what it says and stays that width whether or
          not the cursor is on it. The name fades out underneath it, which is
          what makes the overlap read as deliberate. */}
      <span
        className="min-w-0 flex-1 truncate"
        style={isClosable ? tabTitleMaskStyle : undefined}
      >
        {filename}
      </span>

      {/* The browser tab is fixed: it is the pane's zero state, so there is
          nothing behind it to fall back to. Held open for the selected tab,
          since the one being read is the one most likely to be closed. */}
      {isClosable && (
        <button
          aria-label={`Close ${filename}`}
          className={cn(
            "absolute top-1/2 right-1 size-4 -translate-y-1/2 items-center justify-center rounded-sm hover:bg-foreground/10",
            isSelected ? "flex" : "hidden group-hover/pane-tab:flex",
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
