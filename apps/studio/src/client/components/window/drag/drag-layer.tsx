import { zoomAtom } from "@/client/atoms/zoom";
import { AddressMark } from "@/client/components/window/app-chip";
import { cn } from "@/client/lib/utils";
import { type ChatId } from "@instrument-org/workspace/client";
import { FolderSimpleIcon } from "@phosphor-icons/react/FolderSimple";
import { clamp } from "radashi";
import { useAtomValue } from "jotai";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { useAppsBySlug } from "../apps-by-slug";
import { springFlashAtom } from "../pinned-drops";
import { GroupRow } from "../group-sidebar";
import { TabMark } from "../row-half";
import { useTabTitle } from "../tab-title";
import { type TabGroup } from "../tab-groups";
import { useWindowTabs } from "../window-tabs";
import { ownLinkInAir } from "./content-drag";
import { heldTabsOf } from "./held-tabs";
import { type Rect } from "./landing";
import { type Drag, dragAtom, dragPoint, useDragFrame } from "./session";
import { DROP_LOOK, HELD_LOOK } from "./tone";
import { outcomeOf } from "./letting-go";
import { isPulledFree } from "./use-sidebar-drag";

/** How far left of the pointer a chip's mark stands, and above it the chip's top, at most. */
const CHIP_GRAB_PX = { x: 22, y: 16 };

/** Where the line under the system's own picture of a drag stands from the pointer: below and right of it, as a grab. */
const NATIVE_LINE_GRAB_PX = { x: -14, y: -34 };

/** Where what is held rides over a strip or list that stands still: below and right of the pointer, as a grab. */
const BELOW_GRAB_PX = { x: -10, y: -18 };

/** Where the line stands under this app's own picture of a link (`LINK_PICTURE_AT`), as a grab: under the picture's 32px chip. */
const OWN_PICTURE_LINE_GRAB_PX = { x: -10, y: -54 };

/** How wide a whole group's row is held, where no list says. */
const ROW_WIDTH_PX = 240;

/** How long what is held takes to move between keeping to the sidebar and riding free, in ms. */
const PULL_FREE_MS = 180;

/**
 * What a drag draws over the window that nothing else draws, and only once
 * the pointer is where letting go would land: a side, the half a split
 * takes, or a new tab lit, with a line down the group's outer edge where
 * the pointer reached it; the line in a strip's gap, or in Pinned's, and
 * the tab or the row of Pinned what is held goes into, ringed; and at the
 * pointer, what is held raised with a line under it saying what letting go
 * does. Only a tab's own strip, which stands the tab at the pointer among
 * its tabs, goes without it; under the system's own picture of its drag
 * goes the line alone, and nothing while main shows the window's.
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
  const isFlashing = useAtomValue(springFlashAtom);
  const landing = drag?.landing;
  const lit =
    landing?.kind === "side" || landing?.kind === "newTab"
      ? landing.lit
      : undefined;
  // The place last lit, which the light fades out over.
  const [shown, setShown] = useState<Rect>();
  if (lit && JSON.stringify(lit) !== JSON.stringify(shown)) {
    setShown(lit);
  } else if (!drag && shown) {
    setShown(undefined);
  }
  // Nothing in the group is drawn again while something is held over it:
  // the page stays as it is, and only this layer shows where it would land.
  if (!drag) {
    return null;
  }
  const isLit = lit !== undefined;
  // A row's ring goes out for a moment just before its folder opens.
  const ringed =
    landing?.kind === "replace" || (landing?.kind === "into" && !isFlashing)
      ? landing.lit
      : undefined;
  const line =
    landing?.kind === "strip" || landing?.kind === "pin"
      ? landing.line
      : landing?.kind === "side"
        ? landing.edge
        : undefined;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[60] overflow-hidden"
      data-drag-layer=""
    >
      {shown && (
        <div
          className={cn(
            "absolute rounded-xl transition-opacity duration-150 ease-out motion-reduce:transition-none",
            DROP_LOOK.open,
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
      {line && (
        <DropLine
          key={landing?.kind === "side" ? "edge" : landing?.kind}
          line={line}
        />
      )}
      {ringed && (
        <div
          className={cn(
            "absolute animate-in duration-120 ease-out fade-in-0 motion-reduce:animate-none",
            landing?.kind === "into" ? "rounded-md" : "rounded-xl",
            DROP_LOOK.open,
          )}
          data-drop-ring={landing?.kind}
          style={{
            height: ringed.height / zoom,
            left: ringed.left / zoom,
            top: ringed.top / zoom,
            width: ringed.width / zoom,
          }}
        />
      )}
      <AtPointer chatTitles={chatTitles} drag={drag} entries={entries} />
    </div>
  );
}

/**
 * The one line a drop draws: in a strip's gap, between Pinned's rows, or
 * down a group's outer edge, as the bookmarks bar draws its own
 * (`BarDropLine`), gliding from gap to gap in 90ms rather than jumping.
 */
function DropLine({ line }: { line: Rect }) {
  const zoom = useAtomValue(zoomAtom);
  return (
    <span
      className="absolute animate-in rounded-full bg-primary transition-[left,top] duration-90 ease-out fade-in-0 motion-reduce:transition-none"
      data-drop-line=""
      style={{
        height: line.height / zoom,
        left: line.left / zoom,
        top: line.top / zoom,
        width: line.width / zoom,
      }}
    />
  );
}

/**
 * What goes with the pointer: a tab, files or a link as a raised chip;
 * a whole group as its row, keeping to the sidebar's list until it is
 * pulled free; and a whole group pulled free, where letting go makes a
 * window of its own, as a picture of that window. Under it, what letting
 * go does (`outcomeOf`), alone under the system's own picture of a drag.
 */
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
  const { layoutOf } = useWindowTabs();
  const ref = useRef<HTMLDivElement>(null);
  const mode = useRef<string>(undefined);
  const { held, landing } = drag;
  // A whole group over the bookmarks rides as a chip of the tab it keeps,
  // so the bar shows where it would stand.
  const isGroup = held.kind === "group" && landing?.kind !== "bookmarks";
  // What is held stays at the pointer the whole drag, whatever it is over,
  // so it is never lost: everywhere but a strip, which stands it among its
  // tabs at the pointer itself, a whole group as all its tabs. Off the
  // window main shows its picture. The system's drag shows its own, so
  // under it goes only the line.
  const isShown =
    !drag.isOff && !(landing?.kind === "strip" && landing.line === undefined);
  const isNative = drag.input === "native";
  const isDocked = isGroup && landing?.kind === "sidebar";
  const isWindow = landing?.kind === "window";
  // Over a strip or the list that stands still, it rides below the pointer,
  // so the tabs or rows under the pointer and the line between them stay in
  // sight.
  const isBelow =
    !isGroup &&
    (landing?.kind === "strip" ||
      landing?.kind === "replace" ||
      landing?.kind === "sidebar" ||
      landing?.kind === "pin" ||
      landing?.kind === "into");
  // Stood again every frame from the pointer, never by drawing again.
  const stand = () => {
    const element = ref.current;
    if (!element) {
      return;
    }
    // Between keeping to the list and riding free it glides rather than jumps.
    const now = isDocked
      ? "docked"
      : isWindow
        ? "window"
        : isBelow && !isNative
          ? "below"
          : "free";
    if (mode.current !== undefined && mode.current !== now) {
      element.style.transition = `left ${PULL_FREE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1), top ${PULL_FREE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
      window.setTimeout(() => {
        element.style.transition = "";
      }, PULL_FREE_MS);
    }
    mode.current = now;
    const list = isGroup
      ? document.querySelector("[data-group-list]")?.getBoundingClientRect()
      : undefined;
    if (isDocked && list) {
      // Kept to the list, it gives a little as the pointer pulls away.
      const past = Math.max(dragPoint.x - list.right, 0);
      element.style.left = `${(list.left + 8 + past * 0.3) / zoom}px`;
      element.style.top = `${(dragPoint.y - drag.grab.y) / zoom}px`;
      element.style.width = `${list.width / zoom - 16}px`;
      return;
    }
    const grab = isNative
      ? ownLinkInAir()
        ? OWN_PICTURE_LINE_GRAB_PX
        : NATIVE_LINE_GRAB_PX
      : isBelow
        ? BELOW_GRAB_PX
        : isGroup
          ? { x: Math.min(drag.grab.x, 48), y: Math.min(drag.grab.y, 20) }
          : {
              x: Math.min(drag.grab.x, CHIP_GRAB_PX.x),
              y: Math.min(drag.grab.y, CHIP_GRAB_PX.y),
            };
    element.style.width =
      isGroup && !isWindow
        ? `${list ? list.width / zoom - 16 : ROW_WIDTH_PX}px`
        : "";
    keepInWindow(element, {
      left: (dragPoint.x - grab.x) / zoom,
      pointer: dragPoint.x / zoom,
      top: (dragPoint.y - grab.y) / zoom,
    });
  };
  useLayoutEffect(stand);
  useDragFrame(stand);
  if (!isShown) {
    return null;
  }
  const { line } = outcomeOf(held, landing, {
    groupTitle: (group) =>
      entries.find((each) => each.group === group)?.title || undefined,
    tabCount:
      held.kind === "group"
        ? layoutOf(held.group).sides.reduce(
            (count, side) => count + side.tabs.length,
            0,
          )
        : 1,
  });
  if (isNative) {
    return line === undefined ? null : (
      <Riding line={line} riderRef={ref}>
        {null}
      </Riding>
    );
  }
  if (held.kind === "group" && isGroup) {
    const entry = entries.find((each) => each.group === held.group);
    if (!entry) {
      return null;
    }
    if (isWindow) {
      return (
        <Riding line={line} riderRef={ref}>
          <WindowPicture
            chatTitles={chatTitles}
            group={held.group}
            half={held.half}
          />
        </Riding>
      );
    }
    return (
      <Riding
        line={isDocked ? undefined : line}
        riderRef={ref}
        // A row keeping to the list tilts a little, as one lifted out of it.
        tilt={isDocked || !isPulledFree(held)}
      >
        <div className={cn("rounded-lg", HELD_LOOK)} data-held-row="">
          <GroupRow
            chatTitles={chatTitles}
            entry={entry}
            isLifted
            isUp={false}
          />
        </div>
      </Riding>
    );
  }
  return (
    <Riding line={line} riderRef={ref}>
      <div
        className={cn(
          "flex h-8 max-w-64 items-center gap-2 rounded-xl pr-3 pl-2.5 text-[13px] font-medium",
          HELD_LOOK,
        )}
        data-held-chip=""
      >
        <HeldChip chatTitles={chatTitles} drag={drag} />
      </div>
    </Riding>
  );
}

/** How far from the window's edges what rides on the pointer keeps, in px. */
const EDGE_GAP_PX = 8;

/**
 * Stands what rides on the pointer at `left` and `top` (the layer's px),
 * inside the window: past the right edge it goes to the pointer's left
 * instead, its line under it lined up on its right (`data-flipped`), and at
 * the other edges it stops short of them.
 */
function keepInWindow(
  element: HTMLElement,
  { left, pointer, top }: { left: number; pointer: number; top: number },
) {
  const layer = element.parentElement;
  if (!layer) {
    return;
  }
  const { offsetHeight: height, offsetWidth: width } = element;
  const right = layer.clientWidth - EDGE_GAP_PX;
  const isFlipped = left + width > right;
  const x = isFlipped ? pointer - width - EDGE_GAP_PX : left;
  element.toggleAttribute("data-flipped", isFlipped);
  element.style.left = `${String(clamp(x, EDGE_GAP_PX, Math.max(right - width, EDGE_GAP_PX)))}px`;
  element.style.top = `${String(clamp(top, EDGE_GAP_PX, Math.max(layer.clientHeight - EDGE_GAP_PX - height, EDGE_GAP_PX)))}px`;
}

/** What rides on the pointer, with what letting go does said under it. */
function Riding({
  children,
  line,
  riderRef,
  tilt = false,
}: {
  children: ReactNode;
  line: string | undefined;
  riderRef: React.Ref<HTMLDivElement>;
  tilt?: boolean;
}) {
  return (
    <div
      className="absolute flex w-max flex-col items-start gap-1 data-flipped:items-end"
      data-held=""
      ref={riderRef}
    >
      <div
        className={cn(
          "w-full transition-transform duration-150 ease-out motion-reduce:transition-none",
          tilt && "rotate-1",
        )}
      >
        {children}
      </div>
      {line !== undefined && (
        <span
          className="animate-in rounded-md bg-foreground/85 px-1.5 py-0.5 text-[11.5px] font-medium whitespace-nowrap text-background duration-100 fade-in-0"
          data-held-line=""
          key={line}
        >
          {line}
        </span>
      )}
    </div>
  );
}

/**
 * A whole group pulled free of the sidebar where letting go makes a window
 * of its own, drawn as that window: a small sidebar beside the group's tab
 * up, its page under it.
 */
function WindowPicture({
  chatTitles,
  group,
  half,
}: {
  chatTitles: Map<ChatId, string>;
  group: string;
  /** The half of its row it was pressed by, whose tab up the picture shows. */
  half: 0 | 1 | undefined;
}) {
  const { layoutOf } = useWindowTabs();
  const appsBySlug = useAppsBySlug();
  const titleOf = useTabTitle(chatTitles);
  const layout = layoutOf(group);
  const side = layout.sides[half ?? layout.focused];
  const up = side?.tabs.find((tab) => tab.id === side.up);
  return (
    <div
      className="flex h-28 w-44 animate-in gap-1 overflow-hidden rounded-[10px] bg-ground p-1 shadow-[0_16px_40px_rgb(0_0_0/0.28)] ring-1 ring-black/15 duration-150 fade-in-0 zoom-in-90 dark:ring-white/10"
      data-held-window=""
    >
      <div className="flex w-9 shrink-0 flex-col gap-1 px-0.5 pt-3">
        <span className="h-2.5 rounded-[3px] bg-card shadow-xs ring-1 ring-black/[0.04]" />
        <span className="h-1.5 w-4/5 rounded-full bg-foreground/10" />
        <span className="h-1.5 w-3/5 rounded-full bg-foreground/10" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-md bg-card ring-1 ring-black/[0.05]">
        <div className="flex h-5 shrink-0 items-center gap-1 border-b border-foreground/[0.06] px-1.5 text-[9.5px] font-medium text-foreground/80">
          {up && (
            <>
              <span className="grid size-3 shrink-0 place-items-center [&_svg]:size-3 [&>*]:size-3">
                <TabMark
                  appsBySlug={appsBySlug}
                  chatTitles={chatTitles}
                  tab={up}
                />
              </span>
              <span className="min-w-0 truncate">{titleOf(up)}</span>
            </>
          )}
        </div>
        <div className="flex flex-col gap-1 p-2">
          <span className="h-1.5 w-11/12 rounded-full bg-foreground/[0.08]" />
          <span className="h-1.5 w-4/5 rounded-full bg-foreground/[0.08]" />
          <span className="h-1.5 w-2/3 rounded-full bg-foreground/[0.08]" />
        </div>
      </div>
    </div>
  );
}

/** A held tab's (a whole group's tab up), files' or link's mark and name, files saying how many more go with the first. */
function HeldChip({
  chatTitles,
  drag,
}: {
  chatTitles: Map<ChatId, string>;
  drag: Drag;
}) {
  const { allTabs, layoutOf } = useWindowTabs();
  const titleOf = useTabTitle(chatTitles);
  const appsBySlug = useAppsBySlug();
  const { held } = drag;
  /** The tab up on a group's half, or its side with the keyboard. */
  const upTabOf = (group: string, half: 0 | 1 | undefined) => {
    const layout = layoutOf(group);
    const side = layout.sides[half ?? layout.focused];
    const up = side?.tabs.find((tab) => tab.id === side.up);
    return up ? [up] : [];
  };
  if (held.kind === "folder") {
    return (
      <>
        <FolderSimpleIcon className="size-3.5 shrink-0 text-foreground/60" />
        <span className="min-w-0 truncate">{held.title}</span>
      </>
    );
  }
  if (held.kind === "link") {
    return (
      <>
        <span className="grid size-4 shrink-0 place-items-center">
          <AddressMark address={held.url} />
        </span>
        <span className="min-w-0 truncate">{held.title || held.url}</span>
      </>
    );
  }
  const tabs =
    held.kind === "group"
      ? upTabOf(held.group, held.half)
      : heldTabsOf(held, allTabs);
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
