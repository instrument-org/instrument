import { useState } from "react";

import { type GroupLayout } from "./tab-model";

/** A side as last drawn: the key it was drawn under, where it stood, and its tabs. */
interface DrawnSide {
  at: 0 | 1;
  key: number;
  tabs: readonly string[];
}

/** A side that has gone, drawn as it closes: its key and where it stood. */
interface LeavingSide {
  at: 0 | 1;
  key: number;
}

/**
 * The keys a group's sides are drawn under, following each side through a
 * change: a side takes the key of the side drawn before that shared the most
 * tabs with it, then any key left over in order, and a key no side had only
 * when there are more sides than before. So the side that stays as another
 * opens or closes is never drawn afresh, whichever end it ends up at.
 */
export function sideKeysOf(
  before: readonly DrawnSide[],
  sides: readonly (readonly string[])[],
): number[] {
  const taken = new Set<number>();
  const matched = sides.map((tabs) => {
    let best: DrawnSide | undefined;
    let most = 0;
    for (const each of before) {
      if (taken.has(each.key)) {
        continue;
      }
      const shared = tabs.filter((tab) => each.tabs.includes(tab)).length;
      if (shared > most) {
        best = each;
        most = shared;
      }
    }
    if (best) {
      taken.add(best.key);
    }
    return best?.key;
  });
  const spare = before.flatMap((each) =>
    taken.has(each.key) ? [] : [each.key],
  );
  let next = Math.max(-1, ...before.map((each) => each.key)) + 1;
  return matched.map((key) => key ?? spare.shift() ?? next++);
}

/**
 * Which of a group's sides are opening and closing, so a side made beside
 * the other grows in from its end and a side that goes shrinks away there,
 * the other side widening or narrowing with it. A group coming up is drawn as
 * it stands, with nothing moving. `settle` ends a side's motion.
 */
export function useSideMotion(group: string, layout: GroupLayout) {
  const tabsOf = layout.sides.map((side) => side.tabs.map((tab) => tab.id));
  const shape = JSON.stringify(tabsOf);
  const [seen, setSeen] = useState(() => ({
    entering: new Set<number>(),
    group,
    leaving: [] as LeavingSide[],
    round: 0,
    shape,
    sides: drawn(sideKeysOf([], tabsOf), tabsOf),
  }));
  let now = seen;
  if (seen.group !== group || seen.shape !== shape) {
    const isFresh = seen.group !== group;
    const before = isFresh ? [] : seen.sides;
    const keys = sideKeysOf(before, tabsOf);
    const entering = new Set(
      isFresh ? [] : [...seen.entering].filter((key) => keys.includes(key)),
    );
    let { round } = seen;
    if (before.length > 0) {
      for (const key of keys) {
        if (!before.some((each) => each.key === key)) {
          entering.add(key);
          round += 1;
        }
      }
    }
    const leaving = [
      ...(isFresh ? [] : seen.leaving).filter(
        (each) => !keys.includes(each.key),
      ),
      ...before.flatMap((each) =>
        keys.includes(each.key) ? [] : [{ at: each.at, key: each.key }],
      ),
    ];
    now = {
      entering,
      group,
      leaving,
      round,
      shape,
      sides: drawn(keys, tabsOf),
    };
    setSeen(now);
  }
  const settle = (key: number) => {
    setSeen((last) => {
      if (
        !last.entering.has(key) &&
        !last.leaving.some((each) => each.key === key)
      ) {
        return last;
      }
      const entering = new Set(last.entering);
      entering.delete(key);
      return {
        ...last,
        entering,
        leaving: last.leaving.filter((each) => each.key !== key),
      };
    });
  };
  return {
    entering: now.entering,
    keys: now.sides.map((side) => side.key),
    leaving: now.leaving,
    /** Counts the sides that have opened, so each opening is told from the last. */
    round: now.round,
    settle,
  };
}

function drawn(
  keys: readonly number[],
  tabsOf: readonly (readonly string[])[],
): DrawnSide[] {
  return keys.map((key, index) => ({
    at: index === 1 ? 1 : 0,
    key,
    tabs: tabsOf[index] ?? [],
  }));
}
