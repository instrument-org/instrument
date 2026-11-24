import {
  joinTabGroups,
  splitTabGroups,
} from "@/client/components/window/tab-members";
import {
  applyTabCommand,
  TAB_OPS,
  type TabOp,
} from "@/client/components/window/tab-ops";
import { type TabOpeners } from "@/client/components/window/tab-openers";
import {
  fileOfTabGroup,
  type KeptFile,
  type TabsAsk,
  type TabsChanged,
  WINDOW_TABS_KEY,
} from "@/shared/kept-state";
import { z } from "zod";

/**
 * The one owner of every tab. A window asks a change by name
 * (`tab-ops.ts`) and this applies it to the tabs as they are kept when the
 * ask arrives, one ask after another whichever window sent it, through the
 * tab model the windows draw by. Two windows that each change a group
 * before hearing of the other both land, the second over the first's
 * result, where a window writing a group's whole record over the other's
 * lost one of them.
 *
 * Nothing is held here but the kept files: the tabs are joined from their
 * members for each ask and split back into the ones it changed, so the files
 * keep the shape they have and whatever else writes them is seen by the next
 * ask.
 */

const PREFIX = `${WINDOW_TABS_KEY}/`;

/** An ask as it arrives from a window, as much of it as is checked before it is applied. */
export const TabsAskSchema = z.object({
  command: z.object({ args: z.array(z.unknown()), op: z.string() }),
  id: z.string(),
  onScreen: z.string().optional(),
  openers: z.unknown().optional(),
});

function isTabOp(op: string): op is TabOp {
  return Object.hasOwn(TAB_OPS, op);
}

/** The tab group members among a kept file's keys, by member, for the members that file keeps. */
export function tabMembersIn(
  file: KeptFile,
  keys: Record<string, unknown>,
): [member: string, value: unknown][] {
  return Object.entries(keys).flatMap(([key, value]) => {
    const member = key.startsWith(PREFIX) ? key.slice(PREFIX.length) : "";
    return member !== "" && fileOfTabGroup(member) === file
      ? [[member, value] satisfies [string, unknown]]
      : [];
  });
}

/**
 * What one ask changes: each member that is different after it, by the file
 * and key it is kept under, a member that is gone as `undefined`. Nothing
 * for an ask that names no change, changes nothing, or cannot be applied to
 * the tabs as they are.
 */
export function changesOfAsk(
  members: ReadonlyMap<string, unknown>,
  ask: TabsAsk,
): TabsChanged["changes"] {
  const { op } = ask.command;
  if (!isTabOp(op)) {
    return [];
  }
  const before = joinTabGroups(new Map(members));
  const { state: after } = applyTabCommand(
    {
      ...before,
      // A window's own record of which tab opened which, sent as it has it.
      ...(ask.openers === undefined
        ? {}
        : { openers: ask.openers as TabOpeners }),
    },
    { onScreen: ask.onScreen },
    { args: ask.command.args, op },
  );
  const { openers: _asker, ...kept } = after;
  // Compared as the tab model writes each, before and after: a member read
  // from its file has its keys in another order, and one the model cannot
  // read is left as it is.
  const was = splitTabGroups(before);
  const next = splitTabGroups(kept);
  const changes: TabsChanged["changes"] = [];
  for (const member of was.keys()) {
    if (!next.has(member)) {
      changes.push([fileOfTabGroup(member), PREFIX + member, undefined]);
    }
  }
  for (const [member, value] of next) {
    if (JSON.stringify(was.get(member)) !== JSON.stringify(value)) {
      changes.push([fileOfTabGroup(member), PREFIX + member, value]);
    }
  }
  return changes;
}
