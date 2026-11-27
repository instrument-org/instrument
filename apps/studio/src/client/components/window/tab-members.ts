import { type WindowTab } from "@/client/atoms/window";
import { NO_GROUP_MEMBER } from "@/shared/kept-state";
import { z } from "zod";

import { type GroupOwn, groupLayoutOf, type WindowTabs } from "./tab-model";

/**
 * The tabs as they are kept: a group at a time, each a member of the kept
 * file under its own id, in the shape the agent reads a group in. Its
 * sides, each its tabs in strip order and the one up, which side has the
 * keyboard, and its own pin, project, share, lead tab, group word, side
 * panel and when it last came up. A tab keeps neither its
 * group nor its side, which the member says. Whoever keeps the tabs splits
 * them into members to write and joins the members to read, the main
 * process and a window alike.
 */

/** A kept group's shape; its tabs' own fields are the tab model's. */
const TabGroupMemberSchema = z.object({
  chatSide: z
    .union([z.literal(0), z.literal(1)])
    .optional()
    .catch(undefined),
  focused: z.number().int().min(0),
  lead: z.string().optional(),
  /** A group's name as a build that took names only from links kept it. */
  linkGroup: z.string().optional(),
  name: z.string().optional(),
  pinned: z.boolean().optional(),
  project: z.string().optional(),
  share: z.number().optional(),
  shownAt: z.number().optional(),
  sidePanel: z.boolean().optional().catch(undefined),
  sides: z
    .array(
      z.object({
        tabs: z.array(z.looseObject({ id: z.string(), kind: z.string() })),
        up: z.string().optional(),
      }),
    )
    .min(1),
});

/**
 * The share an earlier build kept on a group whose split an agent's page
 * made, on the left, read as a chat's side rather than as the person's share.
 */
const EARLIER_CHAT_SHARE = 0.38;

/** A tab as a member keeps it, without its group or side. */
type KeptTab = Omit<WindowTab, "group" | "side">;

/** A group as it is kept (`WINDOW_TABS_KEY`). */
interface TabGroupMember extends GroupOwn {
  focused: 0 | 1;
  sides: { tabs: KeptTab[]; up?: string }[];
}

function keptTab({ group: _group, side: _side, ...tab }: WindowTab): KeptTab {
  return tab;
}

/**
 * The tabs by group, each kept by itself as its layout reads
 * (`groupLayoutOf`): a group's tabs belong to it whichever window shows it
 * (`fileOfTabGroup`).
 */
export function splitTabGroups(state: WindowTabs) {
  const members = new Map<string, TabGroupMember>();
  const ungrouped = state.tabs.filter((tab) => tab.group === undefined);
  if (ungrouped.length > 0) {
    members.set(NO_GROUP_MEMBER, {
      focused: 0,
      sides: [{ tabs: ungrouped.map(keptTab) }],
    });
  }
  const groups = new Set([
    ...state.tabs.flatMap((tab) =>
      tab.group === undefined ? [] : [tab.group],
    ),
    ...Object.keys(state.groups ?? {}),
  ]);
  for (const group of groups) {
    const { focused, sides } = groupLayoutOf(state, group);
    members.set(group, {
      ...state.groups?.[group],
      focused,
      sides: sides.map(({ tabs, up }) => ({
        tabs: tabs.map(keptTab),
        ...(up === undefined ? {} : { up }),
      })),
    });
  }
  return members;
}

export function joinTabGroups(members: Map<string, unknown>): WindowTabs {
  const activeByGroup: Record<string, string> = {};
  const besideByGroup: Record<string, string> = {};
  const groups: Record<string, GroupOwn> = {};
  const tabs: WindowTab[] = [];
  for (const [key, value] of members) {
    const member = TabGroupMemberSchema.safeParse(value).data;
    if (member === undefined) {
      continue;
    }
    const group = key === NO_GROUP_MEMBER ? undefined : key;
    member.sides.forEach((side, at) => {
      for (const tab of side.tabs) {
        // Written by this module alone.
        tabs.push({
          ...(tab as KeptTab),
          ...(group === undefined ? {} : { group }),
          // A side past the second, which a later layout may keep, stands
          // on the right, so none of its tabs is dropped.
          ...(at >= 1 ? { side: 1 } : {}),
        } as WindowTab);
      }
    });
    if (group === undefined) {
      continue;
    }
    const focused = member.sides[member.focused] ?? member.sides[0];
    const other = member.sides.find((side) => side !== focused);
    if (focused?.up !== undefined) {
      activeByGroup[group] = focused.up;
    }
    if (other?.up !== undefined) {
      besideByGroup[group] = other.up;
    }
    const isEarlier = member.share === EARLIER_CHAT_SHARE;
    const chatSide =
      member.chatSide ?? (isEarlier && member.sides.length > 1 ? 0 : undefined);
    const own: GroupOwn = {
      ...(chatSide === undefined ? {} : { chatSide }),
      ...(member.lead === undefined ? {} : { lead: member.lead }),
      ...((member.name ?? member.linkGroup) === undefined
        ? {}
        : { name: member.name ?? member.linkGroup }),
      ...(member.pinned === true ? { pinned: true } : {}),
      ...(member.project === undefined ? {} : { project: member.project }),
      ...(member.share === undefined || isEarlier
        ? {}
        : { share: member.share }),
      ...(member.shownAt === undefined ? {} : { shownAt: member.shownAt }),
      ...(member.sidePanel === undefined
        ? {}
        : { sidePanel: member.sidePanel }),
    };
    if (Object.keys(own).length > 0) {
      groups[group] = own;
    }
  }
  return { activeByGroup, besideByGroup, groups, tabs };
}
