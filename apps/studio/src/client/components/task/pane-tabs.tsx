import { FileIcon } from "@/client/components/file-icon";
import { overlaidTabTitleMaskStyle } from "@/client/lib/tab-title-mask";
import { cn } from "@/client/lib/utils";
import { TaskPane } from "@instrument-org/workspace/client";
import { GlobeIcon, XIcon } from "@phosphor-icons/react";
import { Reorder } from "motion/react";

import { PaneToggle } from "./pane-toggle";

/**
 * The pane's tab strip, and the close control at its right end.
 *
 * Tabs are positional and uncapped. A cap would have to evict something the
 * user was reading, and the answer to an over-eager agent is telling it what is
 * already open rather than throwing tabs away behind it.
 *
 * The browser sits outside the group that can be dragged rather than
 * being pinned inside it: it is the pane's zero state, always drawn and never stored, so
 * there is nothing about it for a drag to move.
 */
export function PaneTabs({
  fileTabs,
  onClose,
  onReorder,
  onSelect,
  selectedKey,
  taskId,
}: {
  fileTabs: TaskPane.Tab[];
  onClose: (key: string) => void;
  onReorder: (keys: string[]) => void;
  onSelect: (key: string) => void;
  selectedKey: string | undefined;
  taskId: Parameters<typeof PaneToggle>[0]["taskId"];
}) {
  const fileKeys = fileTabs.map((tab) => TaskPane.tabKey(tab));

  return (
    // `h-10 px-2` matches `FileViewerHeader` and `ViewerToolbar`, the rows that
    // stack under this one, so the three read as one band. No rule under it:
    // the row below draws its own, and two hairlines a row apart break the band
    // into pieces rather than separating anything.
    <div className="flex h-10 shrink-0 items-center gap-1 px-2">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        <PaneTab
          isSelected={selectedKey === "browser"}
          onSelect={() => {
            onSelect("browser");
          }}
          // A rule between the fixed tab and the task's own, drawn once rather
          // than between every pair. Unconditional: hiding it beside a selected
          // tab, as the window's tab bar does, shifts every tab to its right
          // each time the selection moves, which is worse than the slight
          // unevenness it fixes.
          showSeparator={fileTabs.length > 0}
          tab={{ type: "browser" }}
        />

        <Reorder.Group
          as="div"
          axis="x"
          className="flex min-w-0 items-center gap-1"
          onReorder={onReorder}
          values={fileKeys}
        >
          {fileTabs.map((tab) => {
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
                showSeparator={false}
                tab={tab}
                value={key}
              />
            );
          })}
        </Reorder.Group>
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
  value,
}: {
  isSelected: boolean;
  onClose?: () => void;
  onSelect: () => void;
  showSeparator: boolean;
  tab: TaskPane.Tab;
  // Present for a tab inside the group that can be dragged, which is every
  // tab the task owns. Absent for the browser, which is drawn outside it.
  value?: string;
}) {
  const filename =
    tab.type === "file"
      ? tab.filePath.slice(tab.filePath.lastIndexOf("/") + 1)
      : "Browser";
  const isClosable = tab.type === "file" && onClose !== undefined;

  const className = cn(
    "group/pane-tab relative flex h-7 max-w-48 min-w-0 shrink cursor-default items-center gap-1.5 rounded-md px-2 text-xs select-none",
    // A floor on the width of a closable tab, which is what gives the name a
    // box wider than itself to fade into. Without it the name's box ends where
    // the text does, and the fade lands in the middle of a short filename
    // instead of under the control it is making room for.
    isClosable && "min-w-28",
    isSelected
      ? "bg-accent text-accent-foreground"
      : "text-muted-foreground hover:bg-accent/50",
    // Sat in the gap rather than against an edge, so a tab taking a background
    // on hover never appears to grow the rule onto itself. The margin leaves
    // the same 8px either side of it.
    showSeparator &&
      "mr-3 after:pointer-events-none after:absolute after:top-1/4 after:-right-2 after:h-1/2 after:w-px after:bg-border after:content-['']",
  );

  // Selecting on pointer-down rather than on click, and reading the middle
  // button there, is what the window's tab bar does; a tab that waits for the
  // full click feels heavier than the ones above it.
  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button === 1 && onClose) {
      onClose();
    } else if (event.button === 0) {
      onSelect();
    }
  };

  const contents = (
    <>
      {tab.type === "file" ? (
        <FileIcon className="size-4 shrink-0" filename={filename} />
      ) : (
        <GlobeIcon className="size-4 shrink-0" />
      )}

      {/* The close sits over the name's last few pixels rather than beside it,
          so a tab is the width of what it says and stays that width whether or
          not the cursor is on it. The name is fully transparent everywhere the
          control is drawn, which is what keeps it from showing through. */}
      <span
        className="min-w-0 flex-1 truncate"
        style={isClosable ? overlaidTabTitleMaskStyle : undefined}
      >
        {filename}
      </span>

      {/* Held open for the selected tab, since the one being read is the one
          most likely to be closed. The browser has no close at all: it is the
          pane's zero state, so there is nothing behind it to fall back to. */}
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
          // The tab selects on pointer-down; stop it here so closing a
          // background tab does not first select it.
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          type="button"
        >
          <XIcon className="size-3" />
        </button>
      )}
    </>
  );

  const handlers = {
    className,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect();
      }
    },
    onPointerDown,
    role: "tab",
    tabIndex: 0,
  };

  // A div rather than a button, because the close control sits inside it and a
  // button inside a button is not a thing the DOM has.
  return value === undefined ? (
    <div {...handlers}>{contents}</div>
  ) : (
    <Reorder.Item {...handlers} as="div" value={value}>
      {contents}
    </Reorder.Item>
  );
}
