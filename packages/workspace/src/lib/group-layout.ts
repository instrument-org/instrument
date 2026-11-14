import {
  type ChangedTab,
  type LayoutChange,
  type LayoutSideName,
  type LayoutSnapshot,
  type LayoutTab,
} from "../schemas/group-layout";

/**
 * Where the tabs outside a group stood, read with each layout: by tab id, the
 * title of the window's other tab group that had it. What tells a tab moved
 * out to another group from one closed, and one moved in from one opened.
 */
export interface LayoutElsewhere {
  after?: Readonly<Record<string, string>>;
  before?: Readonly<Record<string, string>>;
}

/** The chat's own tab, matched by being the chat rather than by id: a draft's tab and its chat's are one. */
const THIS_CHAT = "\u0000this-chat";

interface Placed {
  index: number;
  side: number;
  tab: LayoutTab;
}

/**
 * What changed in a chat's tab group from one layout to the next, by tab:
 * opened, closed, moved within a side or between sides, moved to or from
 * another group of the window, navigated, and the chat's own moves. A chat
 * that is in another group now says only that, since every tab around it
 * is different. Closed tabs come first, in their old order, then the rest
 * in the new layout's order.
 */
export function layoutChanges(
  before: LayoutSnapshot,
  after: LayoutSnapshot,
  elsewhere: LayoutElsewhere = {},
): LayoutChange[] {
  if (before.group.id !== after.group.id) {
    return [
      {
        change: "chatMoved",
        from: before.group.title,
        to: after.group.title,
      },
    ];
  }
  const was = placesOf(before);
  const now = placesOf(after);
  const became = matchSides(before, after, was, now);
  const chatSide = now.get(THIS_CHAT)?.side;
  const isBeside = (side: number) =>
    after.sides.length === 2 && chatSide !== undefined && side !== chatSide;

  const changes: LayoutChange[] = [];
  for (const [key, { tab }] of was) {
    if (now.has(key)) {
      continue;
    }
    const to = elsewhere.after?.[tab.id];
    changes.push(
      to === undefined
        ? { change: "closed", tab: named(tab) }
        : { change: "movedOut", tab: named(tab), to },
    );
  }

  const reordered = reorderedWithinSides(after, was, now, became);
  for (const [key, { index, side, tab }] of now) {
    const old = was.get(key);
    const beside = isBeside(side) ? { beside: true } : {};
    if (old === undefined) {
      const from = elsewhere.before?.[tab.id];
      changes.push(
        from === undefined
          ? {
              ...beside,
              change: "opened",
              side: sideName(after, side),
              tab: named(tab),
            }
          : {
              ...beside,
              change: "movedIn",
              from,
              side: sideName(after, side),
              tab: named(tab),
            },
      );
      continue;
    }
    if (became[old.side] !== side) {
      changes.push({
        ...beside,
        change: "moved",
        from: sideName(before, old.side),
        tab: named(tab),
        to: sideName(after, side),
      });
    } else if (reordered.has(key)) {
      const ahead = after.sides[side]?.tabs[index - 1];
      changes.push({
        ...(ahead === undefined ? {} : { after: titleOf(ahead) }),
        ...beside,
        change: "moved",
        from: sideName(before, old.side),
        tab: named(tab),
        to: sideName(after, side),
      });
    }
    if (
      !tab.isThisChat &&
      (old.tab.address !== tab.address || old.tab.kind !== tab.kind)
    ) {
      changes.push({
        change: "navigated",
        from: {
          address: old.tab.address,
          kind: old.tab.kind,
          title: old.tab.title,
        },
        tab: named(tab),
      });
    }
  }
  return changes;
}

/** Every tab of a layout by its key, with where it stands. */
function placesOf(layout: LayoutSnapshot): Map<string, Placed> {
  const places = new Map<string, Placed>();
  for (const [side, { tabs }] of layout.sides.entries()) {
    for (const [index, tab] of tabs.entries()) {
      places.set(keyOf(tab), { index, side, tab });
    }
  }
  return places;
}

function keyOf(tab: LayoutTab): string {
  return tab.isThisChat ? THIS_CHAT : tab.id;
}

/**
 * Which side of the later layout each side of the earlier one became, by
 * place in `sides`, or -1 for a side that is gone. Two sides stay where they
 * are. A side that splits in two goes on as the one keeping more of its tabs,
 * the left on a tie, and two sides that become one go on as the one that
 * gave it more of its tabs, the left on a tie, the other gone.
 */
function matchSides(
  before: LayoutSnapshot,
  after: LayoutSnapshot,
  was: Map<string, Placed>,
  now: Map<string, Placed>,
): number[] {
  const shared = (from: number, to: number) =>
    [...was].filter(
      ([key, place]) => place.side === from && now.get(key)?.side === to,
    ).length;
  if (before.sides.length === after.sides.length) {
    return before.sides.map((_, side) => side);
  }
  if (before.sides.length === 1) {
    return [shared(0, 1) > shared(0, 0) ? 1 : 0];
  }
  return shared(1, 0) > shared(0, 0) ? [-1, 0] : [0, -1];
}

/**
 * The tabs that changed places among the ones that stayed on their side:
 * every one outside the longest run that kept its order, so a tab dragged
 * along a side is the one named, not every tab it passed.
 */
function reorderedWithinSides(
  after: LayoutSnapshot,
  was: Map<string, Placed>,
  now: Map<string, Placed>,
  became: number[],
): Set<string> {
  const reordered = new Set<string>();
  for (const side of after.sides.keys()) {
    const stayed = [...now]
      .filter(([key, place]) => {
        const old = was.get(key);
        return (
          place.side === side && old !== undefined && became[old.side] === side
        );
      })
      .map(([key]) => ({ key, old: was.get(key)?.index ?? 0 }));
    const kept = longestRising(stayed.map((entry) => entry.old));
    for (const [at, { key }] of stayed.entries()) {
      if (!kept.has(at)) {
        reordered.add(key);
      }
    }
  }
  return reordered;
}

/** The positions of one longest strictly rising run in `values`, the later on a tie. */
function longestRising(values: readonly number[]): Set<number> {
  const length: number[] = [];
  const previous: number[] = [];
  for (const [at, value] of values.entries()) {
    length[at] = 1;
    previous[at] = -1;
    for (let before = 0; before < at; before += 1) {
      const candidate = (length[before] ?? 0) + 1;
      if ((values[before] ?? 0) < value && candidate >= (length[at] ?? 0)) {
        length[at] = candidate;
        previous[at] = before;
      }
    }
  }
  let end = -1;
  for (const at of values.keys()) {
    if (end === -1 || (length[at] ?? 0) >= (length[end] ?? 0)) {
      end = at;
    }
  }
  const kept = new Set<number>();
  for (let at = end; at !== -1; at = previous[at] ?? -1) {
    kept.add(at);
  }
  return kept;
}

function sideName(layout: LayoutSnapshot, side: number): LayoutSideName {
  if (layout.sides.length < 2) {
    return undefined;
  }
  return side === 0 ? "left" : "right";
}

function named({
  address,
  id,
  isThisChat,
  kind,
  title,
}: LayoutTab): ChangedTab {
  return isThisChat
    ? { address, id, isThisChat, kind, title }
    : { address, id, kind, title };
}

function titleOf(tab: LayoutTab): string {
  return tab.isThisChat ? "this chat" : tab.title;
}

/** The changes the person made: every one but those an agent made. */
export function changesByPerson(
  changes: readonly LayoutChange[],
): LayoutChange[] {
  return changes.filter((one) => !("byAgent" in one && one.byAgent === true));
}

/**
 * The changes in one short line for the person, on the message they went
 * with: "Opened Zendesk pricing beside this chat, closed Intercom". Empty
 * when nothing changed.
 */
export function layoutChangesLine(changes: readonly LayoutChange[]): string {
  const opened = changes.filter((one) => one.change === "opened");
  const closed = changes.filter((one) => one.change === "closed");
  const phrases = [
    ...(opened.length === 0
      ? []
      : [
          `opened ${several(opened.map((one) => one.tab.title))}${opened.every((one) => one.beside) ? " beside this chat" : ""}`,
        ]),
    ...(closed.length === 0
      ? []
      : [`closed ${several(closed.map((one) => one.tab.title))}`]),
    ...changes.flatMap((one): string[] => {
      switch (one.change) {
        case "chatMoved": {
          return [`moved this chat to ${one.to}`];
        }
        case "closed":
        case "opened": {
          return [];
        }
        case "moved": {
          const what = one.tab.isThisChat ? "this chat" : one.tab.title;
          if (one.from === one.to) {
            return [`moved ${what}`];
          }
          if (one.beside) {
            return [`moved ${what} beside this chat`];
          }
          return [
            `moved ${what} ${one.to === undefined ? "into one side" : `to the ${one.to}`}`,
          ];
        }
        case "movedIn": {
          return [`moved ${one.tab.title} here from ${one.from}`];
        }
        case "movedOut": {
          return [`moved ${one.tab.title} to ${one.to}`];
        }
        case "navigated": {
          return [`went to ${one.tab.title}`];
        }
      }
    }),
  ];
  const line = phrases.join(", ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/** Up to two titles by name, more by how many. */
function several(titles: readonly string[]): string {
  if (titles.length > 2) {
    return `${titles.length} tabs`;
  }
  return titles.join(" and ");
}
