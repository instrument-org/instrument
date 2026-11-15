import { zoomAtom } from "@/client/atoms/zoom";
import { AddressMark } from "@/client/components/window/app-chip";
import { cn } from "@/client/lib/utils";
import { type ChatId } from "@instrument-org/workspace/client";
import { SquareHalfIcon } from "@phosphor-icons/react/SquareHalf";
import { clamp } from "radashi";
import { useAtomValue } from "jotai";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { useAppsBySlug } from "../apps-by-slug";
import { GroupRow } from "../group-sidebar";
import { TabMark } from "../row-half";
import { useTabTitle } from "../tab-title";
import { type TabGroup } from "../tab-groups";
import { useWindowTabs } from "../window-tabs";
import { heldTabsOf } from "./held-tabs";
import {
  type Point,
  pullOf,
  type Rect,
  type SplitTarget,
  splitTargetRect,
} from "./landing";
import { type Drag, dragAtom, dragPoint, useDragFrame } from "./session";
import { DROP_AREA_TONE, HELD_LOOK } from "./tone";
import { outcomeOf } from "./letting-go";
import { isPulledFree } from "./use-sidebar-drag";

/** How far left of the pointer a chip's mark stands, and above it the chip's top, at most. */
const CHIP_GRAB_PX = { x: 22, y: 16 };

/** Where the line under the system's own picture of a drag stands from the pointer: below and right of it, as a grab. */
const NATIVE_LINE_GRAB_PX = { x: -14, y: -34 };

/** How wide a whole group's row is held, where no list says. */
const ROW_WIDTH_PX = 240;

/** How far a split target leans toward the pointer at its strongest pull, at most. */
const LEAN_PX = 18;

/** How much a split target grows at its strongest pull. */
const GROW = 0.08;

/** How far what is held is drawn toward a split target at its strongest pull, at most. */
const DRAW_PX = 40;

/** How long what is held takes to move between keeping to the sidebar and riding free, in ms. */
const PULL_FREE_MS = 180;

/** The split target pulling hardest on a point, and how hard. */
function strongestPull(targets: readonly SplitTarget[], point: Point) {
  let best: { pull: number; target: SplitTarget } | undefined;
  for (const target of targets) {
    const pull = pullOf(target, point);
    if (pull > 0 && (!best || pull > best.pull)) {
      best = { pull, target };
    }
  }
  return best;
}

/** The middle of a rect. */
function middleOf(rect: Rect): Point {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * What a drag draws over the window that nothing else draws: a lone side's
 * split targets, from its start, each leaning toward the pointer as it
 * nears and taking what is held short of touching it, giving way to the
 * side that slides in to show the split (`splitPreviewOf`); a side or a new
 * tab lit; and at the pointer, the whole drag, what is held raised with a
 * line under it saying what letting go does. Only a strip, which stands the
 * tab at the pointer among its tabs, goes without it; under the system's
 * own picture of its drag goes the line alone, and nothing while main shows
 * the window's.
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
  const landing = drag?.landing;
  const lit =
    landing?.kind === "side" || landing?.kind === "newTab"
      ? landing.lit
      : undefined;
  const splitSide =
    landing?.kind === "side" && landing.split ? landing.side : undefined;
  // The place last lit, which the light slides on from, and fades out over.
  const [shown, setShown] = useState<Rect>();
  if (lit && JSON.stringify(lit) !== JSON.stringify(shown)) {
    setShown(lit);
  } else if (!drag && shown) {
    setShown(undefined);
  }
  // A split shows as the side sliding in, ringed, where the group can draw
  // it; where it cannot (another window's tab), as its half lit.
  // Read from the page each frame, so it is marked on the layer
  // (`data-previewing`) rather than drawn again.
  const layer = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const placeRing = () => {
    const preview = document.querySelector("[data-side-preview]");
    layer.current?.toggleAttribute(
      "data-previewing",
      splitSide !== undefined && preview !== null,
    );
    const element = ring.current;
    if (!element || !preview) {
      return;
    }
    const rect = preview.getBoundingClientRect();
    element.style.left = `${rect.left / zoom}px`;
    element.style.top = `${rect.top / zoom}px`;
    element.style.width = `${rect.width / zoom}px`;
    element.style.height = `${rect.height / zoom}px`;
  };
  useLayoutEffect(placeRing);
  useDragFrame(placeRing);
  if (!drag) {
    return null;
  }
  const isLit = lit !== undefined;
  return (
    <div
      aria-hidden
      className="group/layer pointer-events-none fixed inset-0 z-[60] overflow-hidden"
      data-drag-layer=""
      ref={layer}
    >
      {drag.hints?.map((target) => (
        <SplitTargetCard
          // Once a split is taken, the side sliding in says what it makes.
          isLit={splitSide !== undefined}
          key={target.side}
          target={target}
        />
      ))}
      {shown && (
        <div
          className={cn(
            "absolute rounded-xl transition-[left,top,width,height,opacity] duration-150 ease-out motion-reduce:transition-none",
            DROP_AREA_TONE,
            (!isLit || splitSide !== undefined) &&
              "group-data-previewing/layer:opacity-0",
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
      <div
        className={cn(
          "absolute rounded-xl opacity-0 ring-2 ring-[rgb(128_128_128/0.85)] transition-opacity duration-150 ease-out ring-inset motion-reduce:transition-none",
          splitSide !== undefined && "group-data-previewing/layer:opacity-100",
        )}
        data-split-ring=""
        ref={ring}
      />
      <AtPointer chatTitles={chatTitles} drag={drag} entries={entries} />
    </div>
  );
}

/**
 * A split target at one end of a lone side's page: a raised card short of
 * the page's height, naming the split it makes. It slides in from its end
 * as the drag starts, leans toward the pointer and grows as the pointer
 * nears (`pullOf`), and fades out, with the other end's, once a split is
 * taken and the side it makes slides in.
 */
function SplitTargetCard({
  isLit,
  target,
}: {
  isLit: boolean;
  target: SplitTarget;
}) {
  const zoom = useAtomValue(zoomAtom);
  const lean = useRef<HTMLDivElement>(null);
  const rect = splitTargetRect(target);
  const isLeft = target.side === 0;
  const follow = () => {
    const element = lean.current;
    if (!element) {
      return;
    }
    const pull = isLit ? 1 : pullOf(target, dragPoint);
    const middle = middleOf(rect);
    const x = clamp((dragPoint.x - middle.x) * 0.15, -LEAN_PX, LEAN_PX) * pull;
    const y = clamp((dragPoint.y - middle.y) * 0.08, -LEAN_PX, LEAN_PX) * pull;
    element.style.transform = `translate(${x / zoom}px, ${y / zoom}px) scale(${1 + GROW * pull})`;
    element.toggleAttribute("data-near", pull > 0);
  };
  useLayoutEffect(follow);
  useDragFrame(follow);
  return (
    <div
      className={cn(
        "absolute animate-in duration-200 ease-out fade-in-0 motion-reduce:animate-none",
        isLeft ? "slide-in-from-left-6" : "slide-in-from-right-6",
      )}
      data-split-target={isLeft ? "left" : "right"}
      style={{
        height: rect.height / zoom,
        left: rect.left / zoom,
        top: rect.top / zoom,
        width: rect.width / zoom,
      }}
    >
      <div
        className={cn(
          "group/target grid size-full place-items-center rounded-2xl p-2 transition-[transform,opacity] duration-150 ease-out motion-reduce:transition-none",
          HELD_LOOK,
          isLit && "opacity-0",
        )}
        ref={lean}
      >
        <div className="flex size-full flex-col items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-foreground/15 text-[13px] font-medium text-muted-foreground group-data-near/target:border-foreground/35 group-data-near/target:text-foreground">
          <SquareHalfIcon
            className={cn("size-5", isLeft && "-scale-x-100")}
            weight="duotone"
          />
          <span className="px-2 text-center">
            {isLeft ? "Add left split" : "Add right split"}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * What goes with the pointer: a tab, files or a link as a raised chip;
 * a whole group as its row, keeping to the sidebar's list until it is
 * pulled free; and a whole group pulled free, where letting go makes a
 * window of its own, as a picture of that window. Under it, what letting
 * go does (`outcomeOf`), alone under the system's own picture of a drag.
 * Near a split target, it is drawn a little toward it.
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
  const isShown = !drag.isOff && landing?.kind !== "strip";
  const isNative = drag.input === "native";
  const isDocked = isGroup && landing?.kind === "sidebar";
  const isWindow = landing?.kind === "window";
  // Stood again every frame from the pointer, never by drawing again.
  const stand = () => {
    const element = ref.current;
    if (!element) {
      return;
    }
    // Between keeping to the list and riding free it glides rather than jumps.
    const now = isDocked ? "docked" : isWindow ? "window" : "free";
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
    const draw = isWindow || isPulledToSplit() ? undefined : drawnToward();
    const grab = isNative
      ? NATIVE_LINE_GRAB_PX
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
      left: (dragPoint.x - grab.x + (draw?.x ?? 0)) / zoom,
      pointer: (dragPoint.x + (draw?.x ?? 0)) / zoom,
      top: (dragPoint.y - grab.y + (draw?.y ?? 0)) / zoom,
    });
  };
  /** Whether a split has taken what is held, which then rides at the pointer over the side sliding in. */
  const isPulledToSplit = () =>
    landing?.kind === "side" && landing.split === true;
  /** How far toward the split target pulling on it what is held is drawn. */
  const drawnToward = () => {
    const pulling = strongestPull(drag.hints ?? [], dragPoint);
    if (!pulling) {
      return undefined;
    }
    const middle = middleOf(splitTargetRect(pulling.target));
    const toward = { x: middle.x - dragPoint.x, y: middle.y - dragPoint.y };
    const length = Math.hypot(toward.x, toward.y) || 1;
    const by = Math.min(length * 0.25, DRAW_PX) * pulling.pull;
    return { x: (toward.x / length) * by, y: (toward.y / length) * by };
  };
  useLayoutEffect(stand);
  useDragFrame(stand);
  if (!isShown) {
    return null;
  }
  const { line } = outcomeOf(
    held,
    landing,
    held.kind === "group"
      ? layoutOf(held.group).sides.reduce(
          (count, side) => count + side.tabs.length,
          0,
        )
      : 1,
  );
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
