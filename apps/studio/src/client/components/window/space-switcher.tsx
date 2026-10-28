import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { cn } from "@/client/lib/utils";
import { ChatsCircleIcon } from "@phosphor-icons/react/ChatsCircle";
import {
  type RefObject,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { type Topic } from "./chats";
import { topicColor } from "./topic-colors";
import { TopicGlyph } from "./topic-icons";
import { topicTint } from "./topic-tint";

/** One space of the column: every chat, or one topic's. */
export interface Space {
  /** The topic, or none for every chat. */
  topic?: Topic;
}

/** The most the column gives when swiped past the first space or the last, in px. */
const EDGE_GIVE = 8;

/** How long the wheel has to be still before the fingers count as lifted, in ms. */
const LIFT_AFTER = 140;

/** How long the column takes to ease to where a swipe let it go, in ms. */
export const SETTLE_MS = 280;

/** How far the momentum still coming is taken to carry a swipe, as a multiple of the frame it was read on. */
const MOMENTUM_CARRY = 9;

/** How wide one mark's slot is, gap included, and one dot's, for telling whether the marks fit. */
const MARK_SLOT = 30;
const DOT_SLOT = 14;

/**
 * The spaces along the column's foot, the way Arc and Dia put them: every
 * chat first, then each topic by its mark, quiet and grey but for the one
 * the column stands in, which wears its own color. A click goes there, and a
 * row too long for the marks to fit turns into dots.
 */
export function SpaceSwitcher({
  current,
  onPick,
  spaces,
}: {
  current: number;
  onPick: (index: number) => void;
  spaces: Space[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry?.contentRect.width ?? 0);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, []);
  // Room kept at the sides so the row never runs to the column's edges.
  const isDots = width > 0 && spaces.length * MARK_SLOT > width - 48;
  const isCramped = width > 0 && spaces.length * DOT_SLOT > width - 32;
  return (
    <div
      aria-label="Spaces"
      className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-4 pt-2 pb-2.5"
      ref={ref}
      role="tablist"
    >
      <div
        className={cn(
          "pointer-events-auto flex items-center",
          isDots ? "gap-0" : "gap-0.5",
          // Past what even dots fit, the row scrolls rather than spilling.
          isCramped && "max-w-full overflow-x-auto",
        )}
      >
        {spaces.map((space, index) => (
          <SpaceMark
            isDot={isDots}
            isOn={index === current}
            key={space.topic?.id ?? "all"}
            onPick={() => {
              onPick(index);
            }}
            space={space}
          />
        ))}
      </div>
    </div>
  );
}

function SpaceMark({
  isDot,
  isOn,
  onPick,
  space,
}: {
  isDot: boolean;
  isOn: boolean;
  onPick: () => void;
  space: Space;
}) {
  const { topic } = space;
  const name = topic?.name ?? "All chats";
  // The one the column stands in wears its topic's tint; the rest are left
  // without it, so a topic's icon falls back to the grey around it.
  const tint = isOn && topic ? topicTint(topicColor(topic)) : undefined;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={name}
          aria-selected={isOn}
          className={cn(
            "group/space grid shrink-0 place-items-center rounded-md outline-hidden",
            isDot ? "h-6 w-3.5" : "size-7",
            !isDot && "focus-visible:bg-foreground/6",
            isOn
              ? "text-foreground/80"
              : "text-foreground/25 hover:text-foreground/55",
            tint && "topic-tint",
          )}
          onClick={onPick}
          role="tab"
          style={tint}
          type="button"
        >
          {isDot ? (
            <span
              className={cn(
                "size-1.5 rounded-full",
                isOn
                  ? topic
                    ? "bg-(--topic-tint-ink)"
                    : "bg-foreground/70"
                  : "bg-current",
              )}
            />
          ) : topic ? (
            <span
              className={cn(
                "grid place-items-center text-[15px] transition",
                // An emoji has its own colors, so the ones not chosen are
                // drawn grey with the icons around them.
                !isOn && "opacity-70 grayscale group-hover/space:opacity-100",
              )}
            >
              <TopicGlyph className="size-4" topic={topic} />
            </span>
          ) : (
            // Filled whether chosen or not, as the topics' icons are.
            <ChatsCircleIcon className="size-4" weight="fill" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{name}</TooltipContent>
    </Tooltip>
  );
}

/** Where a swipe stands: how far off its rest the column is, in px, and how far along to the next space, 0 to 1. */
export interface SpaceSwipe {
  /** Whether the column is easing to where the swipe let it go, rather than following the fingers. */
  isSettling: boolean;
  offset: number;
  toward: number;
}

/**
 * Moves between spaces on a sideways two-finger swipe over `ref`, the way
 * Arc does: the column follows the fingers a whole width either way, with
 * the next space coming in beside it, and nothing is decided while they are
 * on the trackpad, so a space can be peeked at and let go of. Once they lift
 * it goes on to that space if it is past halfway, or was flung there, and
 * back otherwise. A swipe with nowhere to go gives a few px and springs
 * back. Up and down are left to the list.
 *
 * On a Mac the app hears when the fingers come down and lift
 * (`onTrackpadTouch`), so a swipe is held for as long as they are down,
 * however still, and the momentum after a lift is ignored. Elsewhere the
 * lift is read off the wheel: momentum dies away a little every frame, and
 * fingers held still send nothing at all, which counts as a lift too.
 */
export function useSpaceSwipe({
  canStep,
  isOn,
  onStep,
  ref,
}: {
  /** Whether there is a space that way: 1 to the right, -1 to the left. */
  canStep: (direction: -1 | 1) => boolean;
  /** Whether there are spaces to move between; with one, a sideways swipe is left alone entirely. */
  isOn: boolean;
  onStep: (direction: -1 | 1) => void;
  ref: RefObject<HTMLElement | null>;
}): SpaceSwipe {
  const [swipe, setSwipe] = useState<SpaceSwipe>(AT_REST);
  const step = useEffectEvent(onStep);
  const can = useEffectEvent(canStep);
  useEffect(() => {
    const node = ref.current;
    if (!node || !isOn) {
      return;
    }
    // Following the fingers, or let go of and swallowing the momentum after.
    let phase: "following" | "idle" | "let go" = "idle";
    let axis: "x" | "y" | undefined;
    let traveled = 0;
    let lastDelta = 0;
    let dying = 0;
    let idle: number | undefined;
    let settling: { direction: -1 | 0 | 1; timer: number } | undefined;
    // Whether the trackpad says when fingers come down and lift, which it
    // shows by saying so once, and whether they are down now.
    let hasTouches = false;
    let isDown = false;
    const width = () => Math.max(node.clientWidth, 1);

    // Lands where a let-go swipe was heading at once, for a new swipe that
    // starts before the last has finished easing there.
    const land = () => {
      if (!settling) {
        return;
      }
      window.clearTimeout(settling.timer);
      if (settling.direction !== 0) {
        step(settling.direction);
      }
      settling = undefined;
      setSwipe(AT_REST);
    };
    const settleTo = (direction: -1 | 0 | 1) => {
      phase = "let go";
      setSwipe({
        isSettling: true,
        offset: -direction * width(),
        toward: direction === 0 ? 0 : 1,
      });
      settling = {
        direction,
        timer: window.setTimeout(land, SETTLE_MS),
      };
    };
    // Where the fingers let go: on to the next space past halfway, counting
    // how far the momentum would have carried it, and back otherwise.
    // `carry` is signed, the way the wheel ran as the fingers let go.
    const letGo = (carry: number) => {
      const direction = traveled > 0 ? 1 : -1;
      const reach = Math.abs(traveled) + carry * Math.sign(traveled);
      settleTo(
        traveled !== 0 && can(direction) && reach > width() / 2 ? direction : 0,
      );
    };
    const follow = () => {
      const direction = traveled > 0 ? 1 : -1;
      if (!can(direction)) {
        // Past the first space or the last, the column gives a few px and
        // gets stiffer the harder it is pushed.
        setSwipe({
          isSettling: false,
          offset:
            -direction * EDGE_GIVE * (1 - Math.exp(-Math.abs(traveled) / 60)),
          toward: 0,
        });
        return;
      }
      traveled = Math.max(-width(), Math.min(width(), traveled));
      setSwipe({
        isSettling: false,
        offset: -traveled,
        toward: Math.abs(traveled) / width(),
      });
    };

    const onWheel = (event: WheelEvent) => {
      // A pinch arrives as a wheel with Control held.
      if (event.ctrlKey) {
        return;
      }
      window.clearTimeout(idle);
      // A quiet wheel is fingers lifted with no momentum, or the end of the
      // momentum, so whatever comes next is a new swipe.
      idle = window.setTimeout(() => {
        // Fingers the trackpad says are still down are holding the swipe.
        if (hasTouches && isDown) {
          return;
        }
        if (phase === "following") {
          letGo(0);
        }
        phase = "idle";
        axis = undefined;
      }, LIFT_AFTER);
      if (axis === undefined) {
        const x = Math.abs(event.deltaX);
        const y = Math.abs(event.deltaY);
        if (x < 1 && y < 1) {
          return;
        }
        axis = x > y * 1.5 ? "x" : "y";
      }
      if (axis !== "x") {
        return;
      }
      event.preventDefault();
      const delta = event.deltaX;
      const size = Math.abs(delta);
      const isSameWay = Math.sign(delta) === Math.sign(lastDelta);
      const isDying = isSameWay && size < Math.abs(lastDelta) * 0.92;
      if (phase === "let go") {
        // Where the trackpad says when fingers come down, everything until
        // they do is the momentum of the swipe let go of.
        if (hasTouches) {
          lastDelta = delta;
          return;
        }
        // Momentum only runs on the way it was going and dies away, so a
        // wheel the other way, or one picking up again, is a new swipe.
        const isNew =
          (!isSameWay && size >= 1) ||
          (isSameWay && size > Math.abs(lastDelta) * 1.6 + 4);
        lastDelta = delta;
        if (!isNew) {
          return;
        }
        land();
        phase = "idle";
      }
      if (phase === "idle") {
        land();
        phase = "following";
        traveled = 0;
        dying = 0;
      }
      dying = isDying ? dying + 1 : 0;
      lastDelta = delta;
      traveled += delta;
      // At an edge the first slowing lets go, so the give springs straight
      // back; between spaces it takes a few frames of steady slowing, which
      // fingers easing off rarely make and momentum always does.
      const isEdge = !can(traveled > 0 ? 1 : -1);
      if (!hasTouches && dying >= (isEdge ? 1 : 3)) {
        letGo(delta * MOMENTUM_CARRY);
        return;
      }
      follow();
    };
    const stopTouches = window.api?.onTrackpadTouch?.((touch) => {
      hasTouches = true;
      isDown = touch === "down";
      if (isDown) {
        // Fingers down stop the momentum, so the wheel that follows is a
        // new swipe.
        if (phase === "let go") {
          phase = "idle";
        }
        return;
      }
      if (phase === "following") {
        letGo(lastDelta * MOMENTUM_CARRY);
        return;
      }
      // Up with no swipe under way: a scroll up or down, or fingers that
      // never moved.
      axis = undefined;
    });
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      stopTouches?.();
      window.clearTimeout(idle);
      if (settling) {
        window.clearTimeout(settling.timer);
      }
      node.removeEventListener("wheel", onWheel);
    };
  }, [isOn, ref]);
  return isOn ? swipe : AT_REST;
}

const AT_REST: SpaceSwipe = { isSettling: false, offset: 0, toward: 0 };
