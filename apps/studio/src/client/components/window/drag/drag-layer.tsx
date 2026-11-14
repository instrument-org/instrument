import { zoomAtom } from "@/client/atoms/zoom";
import { AddressMark } from "@/client/components/window/app-chip";
import { cn } from "@/client/lib/utils";
import { type ChatId } from "@instrument-org/workspace/client";
import { useAtomValue } from "jotai";
import { useLayoutEffect, useRef, useState } from "react";

import { useAppsBySlug } from "../apps-by-slug";
import { GroupRow, TabMark, useTabTitle } from "../group-sidebar";
import { type TabGroup } from "../tab-groups";
import { useWindowTabs } from "../window-tabs";
import { heldTabsOf } from "./held-tabs";
import { type Rect } from "./landing";
import { type Drag, dragAtom, dragPoint, useDragFrame } from "./session";

/** The tone of a place that takes what is held: a side's page, a row it joins, the row it would make. */
export const DROP_TONE =
  "bg-foreground/[0.06] ring-1 ring-foreground/15 ring-inset";

/** How far left of the pointer a chip's mark stands, and above it the chip's top, at most. */
const CHIP_GRAB_PX = { x: 22, y: 16 };

/** How wide a whole group's row is held, where no list says. */
const ROW_WIDTH_PX = 240;

/**
 * What a drag draws over the window that nothing else draws: the half or
 * the side a side's page would take, lit, sliding from one to the next; and,
 * where what is held lands nowhere in this window, a chip at the pointer
 * saying what it is, or a whole group's row. Nothing goes with the pointer
 * where a strip stands the tab among its tabs, a row lights or a room opens
 * in the sidebar, or the bookmarks make room, and nothing at all while the
 * system's drag shows its own picture or main shows the window's.
 */
export function DragLayer({
  chatTitles,
  entries,
}: {
  chatTitles: Map<ChatId, string>;
  /** Every group this window can name, another window's included. */
  entries: readonly TabGroup[];
}) {
  const drag = useAtomValue(dragAtom);
  const zoom = useAtomValue(zoomAtom);
  const lit =
    drag?.landing?.kind === "side" || drag?.landing?.kind === "newTab"
      ? drag.landing.lit
      : undefined;
  // The place last lit, which the light slides on from, and fades out over.
  const [shown, setShown] = useState<Rect>();
  if (lit && JSON.stringify(lit) !== JSON.stringify(shown)) {
    setShown(lit);
  } else if (!drag && shown) {
    setShown(undefined);
  }
  const isLit = lit !== undefined;
  if (!drag) {
    return null;
  }
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[60] overflow-hidden"
      data-drag-layer=""
    >
      {shown && (
        <div
          className={cn(
            "absolute grid place-items-center rounded-lg transition-[left,top,width,height,opacity] duration-150 ease-out motion-reduce:transition-none",
            DROP_TONE,
            !isLit && "opacity-0",
          )}
          data-drop-lit=""
          style={{
            height: shown.height / zoom,
            left: shown.left / zoom,
            top: shown.top / zoom,
            width: shown.width / zoom,
          }}
        />
      )}
      <AtPointer chatTitles={chatTitles} drag={drag} entries={entries} />
    </div>
  );
}

/** What goes with the pointer, where what is held lands nowhere in this window. */
function AtPointer({
  chatTitles,
  drag,
  entries,
}: {
  chatTitles: Map<ChatId, string>;
  drag: Drag;
  entries: readonly TabGroup[];
}) {
  const zoom = useAtomValue(zoomAtom);
  const ref = useRef<HTMLDivElement>(null);
  const { held, landing } = drag;
  const isGroup = held.kind === "group";
  const isShown =
    !drag.isOff &&
    drag.input !== "native" &&
    (landing === undefined || (isGroup && landing.kind === "sidebar"));
  // Stood again every frame from the pointer, never by drawing again: a
  // group's row by where it was pressed, over the list in line with it.
  const stand = () => {
    const element = ref.current;
    if (!element) {
      return;
    }
    if (isGroup) {
      const list = document
        .querySelector("[data-group-list]")
        ?.getBoundingClientRect();
      const overList = landing?.kind === "sidebar" && list !== undefined;
      element.style.left = `${(overList ? list.left + 8 : dragPoint.x - drag.grab.x) / zoom}px`;
      element.style.top = `${(dragPoint.y - drag.grab.y) / zoom}px`;
      element.style.width = `${list ? list.width / zoom - 16 : ROW_WIDTH_PX}px`;
      return;
    }
    element.style.left = `${(dragPoint.x - Math.min(drag.grab.x, CHIP_GRAB_PX.x)) / zoom}px`;
    element.style.top = `${(dragPoint.y - Math.min(drag.grab.y, CHIP_GRAB_PX.y)) / zoom}px`;
  };
  useLayoutEffect(stand);
  useDragFrame(stand);
  if (!isShown) {
    return null;
  }
  if (held.kind === "group") {
    const entry = entries.find((each) => each.group === held.group);
    return entry ? (
      <div
        className="absolute rotate-1 rounded-lg bg-card shadow-xl ring-1 ring-black/[0.06]"
        data-held-row=""
        ref={ref}
      >
        <GroupRow chatTitles={chatTitles} entry={entry} isLifted isUp={false} />
      </div>
    ) : null;
  }
  return (
    <div
      className="absolute flex h-8 max-w-64 items-center gap-2 rounded-lg bg-card pr-3 pl-2.5 text-[13px] font-medium text-foreground/85 shadow-lg ring-1 ring-black/[0.06]"
      data-held-chip=""
      ref={ref}
    >
      <HeldChip chatTitles={chatTitles} drag={drag} />
    </div>
  );
}

/** A held tab's, files' or bookmark's mark and name, files saying how many more go with the first. */
function HeldChip({
  chatTitles,
  drag,
}: {
  chatTitles: Map<ChatId, string>;
  drag: Drag;
}) {
  const { allTabs } = useWindowTabs();
  const titleOf = useTabTitle(chatTitles);
  const appsBySlug = useAppsBySlug();
  const { held } = drag;
  if (held.kind === "bookmark") {
    return (
      <>
        <span className="grid size-4 shrink-0 place-items-center">
          <AddressMark address={held.url} />
        </span>
        <span className="min-w-0 truncate">{held.title || held.url}</span>
      </>
    );
  }
  const tabs = heldTabsOf(held, allTabs);
  const [first] = tabs;
  if (!first) {
    return held.kind === "files" ? (
      <span className="min-w-0 truncate">
        {held.count === 1 ? "1 file" : `${String(held.count)} files`}
      </span>
    ) : null;
  }
  const more = tabs.length - 1;
  return (
    <>
      <span className="grid size-4 shrink-0 place-items-center">
        <TabMark appsBySlug={appsBySlug} chatTitles={chatTitles} tab={first} />
      </span>
      <span className="min-w-0 truncate">
        {titleOf(first)}
        {more > 0 ? ` and ${String(more)} more` : ""}
      </span>
    </>
  );
}
