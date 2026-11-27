import { type WindowTab } from "@/client/atoms/window";
import { emptyTabsModel, forgetClosed } from "@/client/lib/tabs-model";
import { TabIdSchema, type TabsModel } from "@/shared/tabs";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import fc from "fast-check";

import {
  keptOf,
  reopeningOf,
  withGroupClosed,
  withSideClosed,
  withTabClosed,
} from "./closed-tabs";
import { agentIdOf, historyOf } from "./tab-history";
import {
  backToOpenerOf,
  everyTabId,
  groupLayoutOf,
  isBlankNewTab,
  isChatTab,
  sideOf,
  tabsIn,
  upTabsIn,
  type WindowTabs,
  reopenedTab,
} from "./tab-model";
import { joinTabGroups, splitTabGroups } from "./tab-members";
import { openerKeyOf, prunedOpeners } from "./tab-openers";
import { applyTabCommand, type TabOp, type TabOpArgs } from "./tab-ops";

/**
 * Random sequences of what a person and an agent do to tabs, run through the
 * operations every window change goes through (`TAB_OPS`), with what must be
 * true after each step.
 */

const CHAT = ChatIdSchema.parse("2026-10-01-roofer");
const CHAT_HREF = `/chats/${CHAT}`;

/** The rules a sequence is checked against, by name. */
export const RULES = {
  agentId: "A tab keeps the id agents name it by through every change",
  agentIdUnique: "No two tabs go by one id agents name them by",
  backThenForward: "Back then Forward leaves a tab where it was",
  behindMovesNothing: "Opening behind leaves what is up alone",
  bystanders: "An action in one group leaves the other groups alone",
  closeKeepsRest: "Closing a tab leaves the others in order",
  closeKeepsUp: "Closing a tab that is not up changes nothing up",
  dragCancel: "Canceling a drag puts back what was up",
  frontComesUp: "What opens in front is up with the keyboard",
  history: "A tab's history says where the tab is",
  joinKeeps: "Joining two sides keeps every tab and what is up",
  kept: "Relaunching brings back the same layout",
  moveKeepsRest: "Moving a tab leaves the others in order",
  moveLands: "A moved tab lands on the side asked for",
  sameSides: "Opening a tab in a strip never makes or removes a side",
  openerBack: "Back from a link opened in front returns to its page",
  pointers: "Each side's remembered tab is on that side",
  reopenGroup: "Closing a group and reopening it restores its layout",
  reopenSide: "Closing a side and reopening it restores the layout",
  reopenTab: "Closing a tab and reopening it puts it back in its place",
  throws: "No action throws",
  unique: "No tab is in two places",
} as const;
export type Rule = keyof typeof RULES;

export interface Violation {
  detail: string;
  rule: Rule;
}

/** A group as it is seen: its sides' tabs by tag, the one up on each, and the side with the keyboard. */
export interface Seen {
  focused: number;
  sides: { tabs: string[]; up: string | undefined }[];
}

export interface Step {
  after: Record<string, Seen>;
  before: Record<string, Seen>;
  label: string;
  violations: Violation[];
}

const num = fc.nat({ max: 11 });
const bool = fc.boolean();
const kind = fc.constantFrom("page", "screen", "blank", "chat");

export const actionArb = fc.oneof(
  fc.record({ t: fc.constant("newTab" as const), g: num, kind, behind: bool }),
  fc.record({ t: fc.constant("link" as const), g: num, n: num, behind: bool }),
  fc.record({
    t: fc.constant("chatLink" as const),
    n: num,
    gesture: fc.constantFrom("click", "background", "newTab"),
  }),
  fc.record({ t: fc.constant("agentOpen" as const), n: num, shown: bool }),
  fc.record({ t: fc.constant("handOver" as const), n: num }),
  fc.record({ t: fc.constant("pick" as const), n: num }),
  fc.record({ t: fc.constant("raise" as const), n: num }),
  fc.record({ t: fc.constant("focusSide" as const), g: num, s: num }),
  fc.record({
    t: fc.constant("move" as const),
    n: num,
    g: num,
    s: num,
    at: num,
    split: bool,
  }),
  fc.record({ t: fc.constant("moveToGroup" as const), n: num, g: num }),
  fc.record({ t: fc.constant("reorder" as const), g: num, s: num, by: num }),
  fc.record({ t: fc.constant("join" as const), g: num }),
  fc.record({ t: fc.constant("close" as const), n: num }),
  fc.record({ t: fc.constant("closeReopen" as const), n: num }),
  fc.record({ t: fc.constant("closeSide" as const), g: num, s: num }),
  fc.record({ t: fc.constant("sideReopen" as const), g: num, s: num }),
  fc.record({ t: fc.constant("closeGroup" as const), g: num }),
  fc.record({ t: fc.constant("groupReopen" as const), g: num }),
  fc.record({ t: fc.constant("reopen" as const) }),
  fc.record({ t: fc.constant("go" as const), n: num, page: bool }),
  fc.record({ t: fc.constant("backForward" as const), n: num }),
  fc.record({ t: fc.constant("back" as const), n: num }),
  fc.record({ t: fc.constant("toFile" as const), n: num }),
  fc.record({ t: fc.constant("download" as const), n: num }),
  fc.record({ t: fc.constant("relaunch" as const) }),
  fc.record({ t: fc.constant("dragAway" as const), n: num, pick: num }),
);
export type Action = typeof actionArb extends fc.Arbitrary<infer T> ? T : never;

export class Window {
  closed: TabsModel = emptyTabsModel();
  groups: string[] = ["A", "B"];
  readonly steps: Step[] = [];
  state: WindowTabs = {
    activeByGroup: { A: "chat", B: "two" },
    tabs: [
      { group: "A", href: CHAT_HREF, id: "chat", kind: "screen" },
      this.page("one", "A"),
      this.page("two", "B"),
    ],
  };
  private made = 0;
  /** What a tab that came back under a new id was called. */
  private tags = new Map<string, string>();
  private violations: Violation[] = [];

  private page(id: string, group: string): WindowTab {
    return { group, id, kind: "page", openedAt: 0, url: `https://${id}.test/` };
  }

  private id(prefix: string) {
    this.made += 1;
    return `${prefix}${String(this.made)}`;
  }

  private tag(tab: WindowTab) {
    return (
      this.tags.get(tab.id) ??
      this.tags.get(openerKeyOf(tab)) ??
      openerKeyOf(tab)
    );
  }

  private listed(state: WindowTabs = this.state) {
    return state.tabs.filter(
      (tab) => tab.group !== undefined && this.groups.includes(tab.group),
    );
  }

  private nth(n: number) {
    const tabs = this.listed();
    return tabs.length === 0 ? undefined : tabs[n % tabs.length];
  }

  private group(n: number) {
    return this.groups[n % Math.max(1, this.groups.length)];
  }

  see(state: WindowTabs = this.state, group?: string): Record<string, Seen> {
    const named = group === undefined ? this.groups : [group];
    return Object.fromEntries(
      named.map((key) => {
        const layout = groupLayoutOf(state, key);
        const tagOf = (id: string | undefined) => {
          const tab = state.tabs.find((entry) => entry.id === id);
          return tab && this.tag(tab);
        };
        return [
          key,
          {
            focused: layout.focused,
            sides: layout.sides.map((side) => ({
              tabs: side.tabs.map((tab) => this.tag(tab)),
              up: tagOf(side.up),
            })),
          },
        ];
      }),
    );
  }

  private seeOne(group: string) {
    const seen = this.see(this.state, group)[group];
    if (!seen) {
      throw new Error("no group");
    }
    return seen;
  }

  private fail(rule: Rule, detail: string) {
    this.violations.push({ detail, rule });
  }

  private same(rule: Rule, got: unknown, want: unknown, what: string) {
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      this.fail(
        rule,
        `${what}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`,
      );
    }
  }

  private run<K extends TabOp>(
    onScreen: string | undefined,
    op: K,
    ...args: TabOpArgs<K>
  ) {
    const { state } = applyTabCommand(this.state, { onScreen }, { args, op });
    this.state = state.openers
      ? { ...state, openers: prunedOpeners(state.openers, state.tabs) }
      : state;
  }

  /** One action, checked. Answers what it broke. */
  do(action: Action): Violation[] {
    const before = this.see();
    // By strip key, which a tab keeps whatever it turns into; only the
    // tabs a strip lists, not the pages drawn inside them.
    const agentIds = new Map(
      this.listed().map((tab) => [openerKeyOf(tab), agentIdOf(tab)]),
    );
    this.violations = [];
    let label: string | undefined;
    let touched: readonly string[] | "all" = "all";
    try {
      const done = this.act(action);
      label = done?.label;
      touched = done?.touched ?? [];
    } catch (error) {
      label = `${action.t} threw`;
      this.fail("throws", String(error));
    }
    if (label === undefined) {
      return [];
    }
    const after = this.see();
    this.always();
    const named = new Map<string, WindowTab>();
    for (const tab of this.listed()) {
      const other = named.get(agentIdOf(tab));
      if (other !== undefined) {
        this.fail(
          "agentIdUnique",
          `${this.tag(tab)} and ${this.tag(other)} both go by ${agentIdOf(tab)}`,
        );
      }
      named.set(agentIdOf(tab), tab);
      const was = agentIds.get(openerKeyOf(tab));
      if (was !== undefined && was !== agentIdOf(tab)) {
        this.fail(
          "agentId",
          `${this.tag(tab)} went from ${was} to ${agentIdOf(tab)}`,
        );
      }
    }
    if (touched !== "all") {
      for (const [group, seen] of Object.entries(before)) {
        if (!touched.includes(group)) {
          this.same("bystanders", after[group] ?? null, seen, `group ${group}`);
        }
      }
    }
    this.steps.push({ after, before, label, violations: this.violations });
    return this.violations;
  }

  private always() {
    const ids = this.state.tabs.flatMap((tab) => [
      tab.id,
      ...(tab.past ?? []).map((visit) => visit.id),
      ...(tab.future ?? []).map((visit) => visit.id),
    ]);
    if (everyTabId(this.state).size !== ids.length) {
      const twice = ids.filter((id, at) => ids.indexOf(id) !== at);
      this.fail("unique", `${twice.join(", ")} twice`);
    }
    for (const group of this.groups) {
      const keys = tabsIn(this.state, group).map(openerKeyOf);
      if (new Set(keys).size !== keys.length) {
        this.fail("unique", `two tabs under one strip key in ${group}`);
      }
    }
    for (const group of this.groups) {
      const own = tabsIn(this.state, group);
      const active = this.state.activeByGroup[group];
      const beside = this.state.besideByGroup?.[group];
      const activeTab = own.find((tab) => tab.id === active);
      const besideTab = own.find((tab) => tab.id === beside);
      const layout = groupLayoutOf(this.state, group);
      if (active !== undefined && !activeTab) {
        this.fail("pointers", `${group}'s tab up (${active}) is not in it`);
      }
      if (beside !== undefined && !besideTab) {
        this.fail(
          "pointers",
          `${group}'s other tab up (${beside}) is not in it`,
        );
      }
      if (beside !== undefined && layout.sides.length < 2) {
        this.fail("pointers", `${group} has one side and an other tab up`);
      }
      if (
        activeTab &&
        besideTab &&
        layout.sides.length === 2 &&
        sideOf(activeTab) === sideOf(besideTab)
      ) {
        this.fail("pointers", `${group}'s two tabs up are on one side`);
      }
      if (
        own.some((tab) => sideOf(tab) === 1) &&
        !own.some((tab) => sideOf(tab) === 0)
      ) {
        this.fail("pointers", `${group} has a right side and no left`);
      }
    }
    for (const tab of this.state.tabs) {
      if (tab.kind === "screen") {
        const { entries, index } = historyOf(tab);
        if (entries[index] !== tab.href) {
          this.fail(
            "history",
            `${this.tag(tab)} is at ${tab.href}, its history at ${String(entries[index])}`,
          );
        }
      }
    }
    const relaunched = joinTabGroups(new Map(splitTabGroups(this.state)));
    this.same("kept", this.see(relaunched), this.see(), "after a relaunch");
  }

  private tab(tabKind: "blank" | "chat" | "page" | "screen", group: string) {
    const id = this.id(
      tabKind === "page" ? "p" : tabKind === "blank" ? "new" : "s",
    );
    return tabKind === "page"
      ? this.page(id, group)
      : ({
          group,
          href:
            tabKind === "blank"
              ? "/chats"
              : tabKind === "chat"
                ? CHAT_HREF
                : `/apps/${id}`,
          id,
          kind: "screen",
        } satisfies WindowTab);
  }

  private act(
    action: Action,
  ): undefined | { label: string; touched: readonly string[] | "all" } {
    switch (action.t) {
      case "newTab": {
        const group = this.group(action.g);
        if (group === undefined) {
          return undefined;
        }
        const was = this.seeOne(group);
        const tab = this.tab(action.kind, group);
        this.run(group, "openInGroup", tab, {
          from: { reason: "newTab" },
          group,
          select: !action.behind,
        });
        this.opened(group, was, tab.id, action.behind);
        this.same(
          "sameSides",
          this.seeOne(group).sides.length,
          was.sides.length,
          "sides",
        );
        return {
          label: `Open ${tab.id} in ${group}${action.behind ? " behind" : ""}`,
          touched: [group],
        };
      }
      case "link": {
        const source = this.nth(action.n);
        const group = source?.group;
        if (!source || group === undefined) {
          return undefined;
        }
        const was = this.seeOne(group);
        const sourceIsUp = groupLayoutOf(this.state, group).sides.some(
          (side) => side.up === source.id,
        );
        if (!sourceIsUp) {
          return undefined;
        }
        const tab = this.tab("page", group);
        // As the pane opens a link pressed into a new tab.
        this.run(group, "openPageTab", {
          behind: action.behind,
          from: { reason: "link", tab: source.id },
          into: group,
          newTab: true,
          page: { id: tab.id, openedAt: 0, url: `https://${tab.id}.test/` },
          show: false,
        });
        this.opened(group, was, tab.id, action.behind);
        this.same(
          "sameSides",
          this.seeOne(group).sides.length,
          was.sides.length,
          "sides",
        );
        const back = backToOpenerOf(this.state, tab.id);
        if (back?.id !== source.id) {
          this.fail(
            "openerBack",
            `Back from ${tab.id} goes to ${back ? this.tag(back) : "nothing"}, opened from ${this.tag(source)}`,
          );
        }
        return {
          label: `Follow a link in ${this.tag(source)} to a new tab ${tab.id}`,
          touched: [group],
        };
      }
      case "chatLink":
      case "agentOpen":
      case "handOver": {
        const chats = this.listed().filter(isChatTab);
        const chat = chats[action.n % Math.max(1, chats.length)];
        const group = chat?.group;
        if (!chat || group === undefined) {
          return undefined;
        }
        const was = this.seeOne(group);
        const name = this.tag(chat);
        if (action.t === "handOver") {
          const id = this.id("f");
          this.run(group, "handOverBeside", {
            chatTab: chat.id,
            href: `/apps/${id}`,
            id,
            openedBy: CHAT,
          });
          return {
            label: `${name}'s reply hands over ${id}`,
            touched: [group],
          };
        }
        const id = this.id("p");
        this.run(group, "openPageBesideChat", {
          ask:
            action.t === "chatLink"
              ? { chatTab: chat.id, gesture: action.gesture }
              : { chatTab: chat.id, isShown: action.shown },
          id,
          openedAt: 0,
          ...(action.t === "agentOpen" ? { openedBy: CHAT } : {}),
          url: `https://${id}.test/`,
        });
        if (action.t === "agentOpen") {
          return {
            label: `${name}'s agent opens ${id}${action.shown ? " to show" : ""}`,
            touched: [group],
          };
        }
        this.opened(group, was, id, action.gesture === "background");
        return {
          label: `${action.gesture === "background" ? "Background click" : action.gesture === "click" ? "Click" : "Shift-click"} a link in ${name} (${id})`,
          touched: [group],
        };
      }
      case "pick": {
        const tab = this.nth(action.n);
        if (tab?.group === undefined) {
          return undefined;
        }
        this.run(tab.group, "pickTab", tab.id);
        const now = this.seeOne(tab.group);
        this.same(
          "frontComesUp",
          now.sides[now.focused]?.up,
          this.tag(tab),
          "picked",
        );
        return { label: `Pick ${this.tag(tab)}`, touched: [tab.group] };
      }
      case "raise": {
        const tab = this.nth(action.n);
        if (tab?.group === undefined) {
          return undefined;
        }
        this.run(tab.group, "raiseTab", tab.id);
        return {
          label: `Agent shows ${this.tag(tab)}`,
          touched: [tab.group],
        };
      }
      case "focusSide": {
        const group = this.group(action.g);
        if (
          group === undefined ||
          groupLayoutOf(this.state, group).sides.length < 2
        ) {
          return undefined;
        }
        const side = action.s % 2 === 1 ? 1 : 0;
        const was = this.seeOne(group);
        this.run(group, "focusSide", group, side);
        this.same(
          "frontComesUp",
          this.seeOne(group),
          { ...was, focused: side },
          "focused",
        );
        return {
          label: `Press in ${group}'s ${side ? "right" : "left"} side`,
          touched: [group],
        };
      }
      case "move": {
        const tab = this.nth(action.n);
        const group = this.group(action.g);
        if (!tab || group === undefined || tab.group === undefined) {
          return undefined;
        }
        const side = action.s % 2 === 1 ? 1 : 0;
        const from = tab.group;
        const wasFrom = this.seeOne(from);
        const wasTo = this.seeOne(group);
        const name = this.tag(tab);
        // A drag brings the tab up as it starts.
        this.run(from, "selectTab", tab.id);
        this.run(group, "moveTabTo", {
          group,
          id: tab.id,
          index: action.at % 4,
          select: true,
          side,
          ...(action.split ? { split: true } : {}),
        });
        this.moved(name, from, wasFrom, group, wasTo);
        const now = this.seeOne(group);
        // A side that stays a side is where the tab is asked to be: the
        // side it names, unless the tab alone made it.
        const others = wasTo.sides.map((each) =>
          each.tabs.filter((each_) => each_ !== name),
        );
        if (others.length === 2 && others.every((each) => each.length > 0)) {
          this.same(
            "moveLands",
            now.sides.findIndex((each) => each.tabs.includes(name)),
            side,
            "side",
          );
          const want = Math.min(action.at % 4, others[side]?.length ?? 0);
          this.same(
            "moveLands",
            now.sides[side]?.tabs.indexOf(name),
            want,
            "place",
          );
        }
        this.same("frontComesUp", now.sides[now.focused]?.up, name, "moved");
        this.settleGroups();
        return {
          label: `Drag ${name} to ${group}'s ${side ? "right" : "left"} side${action.split ? ", splitting" : ""}, place ${String(action.at % 4)}`,
          touched: [from, group],
        };
      }
      case "moveToGroup": {
        const tab = this.nth(action.n);
        const group = this.group(action.g);
        if (!tab || group === undefined || tab.group === undefined) {
          return undefined;
        }
        const from = tab.group;
        const wasFrom = this.seeOne(from);
        const wasTo = this.seeOne(group);
        this.run(group, "moveToGroup", tab.id, group);
        this.moved(this.tag(tab), from, wasFrom, group, wasTo);
        this.settleGroups();
        return {
          label: `Move ${this.tag(tab)} to group ${group}`,
          touched: [from, group],
        };
      }
      case "reorder": {
        const group = this.group(action.g);
        const layout =
          group === undefined ? undefined : groupLayoutOf(this.state, group);
        const side = layout?.sides[action.s % layout.sides.length];
        if (group === undefined || !layout || !side || side.tabs.length < 2) {
          return undefined;
        }
        const was = this.seeOne(group);
        const at = layout.sides.indexOf(side);
        const by = 1 + (action.by % (side.tabs.length - 1));
        const keys = side.tabs.map(openerKeyOf);
        const turned = [...keys.slice(by), ...keys.slice(0, by)];
        const names = side.tabs.map((tab) => this.tag(tab));
        this.run(group, "reorderGroup", group, turned);
        this.same(
          "moveKeepsRest",
          this.seeOne(group),
          {
            ...was,
            sides: was.sides.map((each, index) =>
              index === at
                ? {
                    tabs: [...names.slice(by), ...names.slice(0, by)],
                    up: each.up,
                  }
                : each,
            ),
          },
          "reordered",
        );
        return { label: `Reorder ${group}'s strip`, touched: [group] };
      }
      case "join": {
        const group = this.group(action.g);
        if (group === undefined) {
          return undefined;
        }
        const was = this.seeOne(group);
        if (was.sides.length < 2) {
          return undefined;
        }
        this.run(group, "joinSides", group);
        this.same(
          "joinKeeps",
          this.seeOne(group),
          {
            focused: 0,
            sides: [
              {
                tabs: was.sides.flatMap((side) => side.tabs),
                up: was.sides[was.focused]?.up,
              },
            ],
          },
          "joined",
        );
        return { label: `Join ${group}'s sides`, touched: [group] };
      }
      case "close":
      case "closeReopen": {
        const tab = this.nth(action.n);
        const group = tab?.group;
        if (!tab || group === undefined) {
          return undefined;
        }
        if (tabsIn(this.state, group).length < 2) {
          return undefined;
        }
        const was = this.seeOne(group);
        const name = this.tag(tab);
        const blank = isBlankNewTab(tab);
        this.requestClose(tab, group);
        this.closedOne(group, was, name);
        if (action.t === "close" || blank) {
          return { label: `Close ${name}`, touched: [group] };
        }
        this.reopen();
        const now = this.seeOne(group);
        this.same(
          "reopenTab",
          now,
          {
            focused: was.sides.findIndex((side) => side.tabs.includes(name)),
            sides: was.sides.map((side) =>
              side.tabs.includes(name) ? { ...side, up: name } : side,
            ),
          },
          "reopened",
        );
        return { label: `Close ${name}, then reopen it`, touched: [group] };
      }
      case "closeSide":
      case "sideReopen": {
        const group = this.group(action.g);
        const layout =
          group === undefined ? undefined : groupLayoutOf(this.state, group);
        if (group === undefined || layout?.sides.length !== 2) {
          return undefined;
        }
        const side = action.s % 2 === 1 ? 1 : 0;
        const was = this.seeOne(group);
        const blanks = layout.sides[side]?.tabs.some(isBlankNewTab);
        if (action.t === "sideReopen" && blanks) {
          return undefined;
        }
        this.closeSide(group, side);
        this.same(
          "closeKeepsRest",
          this.seeOne(group),
          { focused: 0, sides: [was.sides[1 - side]] },
          "side closed",
        );
        const which = side ? "right" : "left";
        if (action.t === "closeSide") {
          return { label: `Close ${group}'s ${which} side`, touched: [group] };
        }
        this.reopen();
        this.same("reopenSide", this.seeOne(group), was, "side reopened");
        return {
          label: `Close ${group}'s ${which} side, then reopen it`,
          touched: [group],
        };
      }
      case "closeGroup":
      case "groupReopen": {
        const group = this.group(action.g);
        if (group === undefined || this.groups.length < 2) {
          return undefined;
        }
        const was = this.seeOne(group);
        const blanks = tabsIn(this.state, group).some(isBlankNewTab);
        this.closeGroup(group);
        if (action.t === "closeGroup") {
          return { label: `Close group ${group}`, touched: [group] };
        }
        if (blanks) {
          return { label: `Close group ${group}`, touched: [group] };
        }
        this.reopen();
        const back = this.groups.at(-1);
        this.same(
          "reopenGroup",
          back === undefined ? undefined : this.seeOne(back),
          was,
          "group reopened",
        );
        return {
          label: `Close group ${group}, then reopen it`,
          touched: [group],
        };
      }
      case "reopen": {
        if (this.closed.recentlyClosed.length === 0) {
          return undefined;
        }
        this.reopen();
        return { label: "Reopen the last thing closed", touched: "all" };
      }
      case "go": {
        const tab = this.nth(action.n);
        const group = tab?.group;
        if (!tab || group === undefined) {
          return undefined;
        }
        const was = this.seeOne(group);
        const name = this.tag(tab);
        const id = this.id("v");
        if (action.page) {
          this.run(group, "openPageTab", {
            behind: false,
            into: group,
            newTab: false,
            page: { id, openedAt: 0, url: `https://${id}.test/` },
            replacing: tab,
            show: false,
          });
        } else {
          this.run(group, "tabToScreen", {
            href: `/apps/${id}`,
            id: tab.id,
            newId: id,
          });
        }
        this.same(
          "moveKeepsRest",
          this.seeOne(group).sides.map((side) => side.tabs),
          was.sides.map((side) => side.tabs),
          "went",
        );
        return {
          label: `Send ${name} to ${action.page ? "a site" : "an app page"}`,
          touched: [group],
        };
      }
      case "backForward":
      case "back": {
        const tab = this.nth(action.n);
        const group = tab?.group;
        if (!tab || group === undefined) {
          return undefined;
        }
        const was = this.seeOne(group);
        const name = this.tag(tab);
        const find = () =>
          tabsIn(this.state, group).find((each) => this.tag(each) === name);
        const start = JSON.stringify(shown(tab));
        // A screen steps its own history before its visits.
        const isTrail = tab.kind === "screen" && historyOf(tab).index > 0;
        if (!isTrail && !tab.past?.length) {
          return undefined;
        }
        this.run(group, isTrail ? "stepTrail" : "stepVisit", tab.id, -1);
        this.same(
          "sameSides",
          this.seeOne(group).sides.length,
          was.sides.length,
          "sides",
        );
        if (action.t === "back") {
          return { label: `Back in ${name}`, touched: [group] };
        }
        const there = find();
        if (there) {
          const canTrail =
            there.kind === "screen" &&
            historyOf(there).index < historyOf(there).entries.length - 1;
          this.run(group, canTrail ? "stepTrail" : "stepVisit", there.id, 1);
        }
        const end = find();
        this.same(
          "backThenForward",
          end && JSON.stringify(shown(end)),
          start,
          name,
        );
        this.same("backThenForward", this.seeOne(group), was, "layout");
        return { label: `Back then Forward in ${name}`, touched: [group] };
      }
      case "toFile": {
        const tab = this.nth(action.n);
        const group = tab?.group;
        if (tab?.kind !== "page" || group === undefined) {
          return undefined;
        }
        const was = this.seeOne(group);
        const id = this.id("file");
        this.run(group, "pageBecomesFile", {
          file: { href: `/files?path=/tmp/${id}.html`, id },
          hostGroup: `hosted:${id}`,
          left: { id: this.id("left"), url: "https://left.test/" },
          page: tab.id,
        });
        const now = this.seeOne(group);
        this.same("moveKeepsRest", now, was, "became a file tab");
        return {
          label: `${this.tag(tab)} goes to a file on the computer`,
          touched: [group],
        };
      }
      case "download": {
        const tab = this.nth(action.n);
        const group = tab?.group;
        if (tab?.kind !== "page" || group === undefined) {
          return undefined;
        }
        const was = this.seeOne(group);
        const name = this.tag(tab);
        const goesBack = Boolean(tab.past?.length);
        this.run(group, "pageBecameDownload", tab.id);
        if (goesBack) {
          this.same("moveKeepsRest", this.seeOne(group), was, "went back");
        } else if (
          tabsIn(this.state, group).some((each) => each.id === tab.id)
        ) {
          this.same("moveKeepsRest", this.seeOne(group), was, "stayed");
        } else {
          this.closedOne(group, was, name);
        }
        return {
          label: `${name}'s page turns out to be a download`,
          touched: [group],
        };
      }
      case "relaunch": {
        const before = this.see();
        this.state = joinTabGroups(new Map(splitTabGroups(this.state)));
        this.same("kept", this.see(), before, "relaunched");
        return { label: "Quit and relaunch", touched: [] };
      }
      case "dragAway": {
        // A drag brings the tab under the pointer up, then is let go.
        const tab = this.nth(action.n);
        const group = tab?.group;
        if (!tab || group === undefined) {
          return undefined;
        }
        const was = this.seeOne(group);
        const ups = upTabsIn(this.state, group);
        const own = tabsIn(this.state, group);
        const over = own[action.pick % own.length];
        this.run(group, "selectTab", tab.id);
        if (over) {
          this.run(group, "selectTab", over.id);
        }
        this.run(group, "putUpBack", group, ups);
        if (ups.active !== undefined) {
          this.same("dragCancel", this.seeOne(group), was, "drag canceled");
        }
        return { label: `Drag ${this.tag(tab)} and let go`, touched: [group] };
      }
    }
  }

  /** What opening a tab may change. */
  private opened(group: string, was: Seen, id: string, behind: boolean) {
    const now = this.seeOne(group);
    const tab = this.state.tabs.find((each) => each.id === id);
    const name = tab ? this.tag(tab) : id;
    const without = now.sides
      .map((side) => side.tabs.filter((each) => each !== name))
      .flat();
    // In place of a side's only blank New Tab, it takes that tab's place.
    const wasTabs = was.sides.flatMap((side) => side.tabs);
    const replaced = wasTabs.filter((each) => !without.includes(each));
    if (
      replaced.length > 1 ||
      (replaced.length === 1 && without.length !== wasTabs.length - 1)
    ) {
      this.fail(
        "closeKeepsRest",
        `opening ${name} lost ${replaced.join(", ")}`,
      );
    }
    if (behind) {
      this.same(
        "behindMovesNothing",
        now.sides[now.focused]?.up,
        was.sides[was.focused]?.up,
        "with the keyboard",
      );
      if (was.sides.length === 2 && replaced.length === 0) {
        this.same(
          "behindMovesNothing",
          now.sides.map((side) => side.up),
          was.sides.map((side) => side.up),
          "up",
        );
      }
    } else if (tab?.group === group) {
      this.same("frontComesUp", now.sides[now.focused]?.up, name, "opened");
    }
  }

  private closedOne(group: string, was: Seen, name: string) {
    const now = this.seeOne(group);
    const wasSides = was.sides
      .map((side) => side.tabs.filter((each) => each !== name))
      .filter((tabs) => tabs.length > 0);
    this.same(
      "closeKeepsRest",
      now.sides.map((side) => side.tabs),
      wasSides,
      "tabs left",
    );
    if (!was.sides.some((side) => side.up === name)) {
      this.same(
        "closeKeepsUp",
        { focused: now.focused, ups: now.sides.map((side) => side.up) },
        { focused: was.focused, ups: was.sides.map((side) => side.up) },
        "up",
      );
    } else if (was.sides[was.focused]?.up !== name) {
      this.same(
        "closeKeepsUp",
        now.sides[now.focused]?.up,
        was.sides[was.focused]?.up,
        "with the keyboard",
      );
    }
  }

  private moved(
    name: string,
    from: string,
    wasFrom: Seen,
    to: string,
    wasTo: Seen,
  ) {
    const flat = (seen: Seen) =>
      seen.sides.flatMap((side) => side.tabs).filter((each) => each !== name);
    this.same(
      "moveKeepsRest",
      flat(this.seeOne(to)),
      flat(wasTo),
      `${to}'s others`,
    );
    if (from !== to) {
      this.same(
        "moveKeepsRest",
        flat(this.seeOne(from)),
        flat(wasFrom),
        `${from}'s others`,
      );
    }
    const now = this.seeOne(to).sides.flatMap((side) => side.tabs);
    if (now.filter((each) => each === name).length !== 1) {
      this.fail(
        "moveKeepsRest",
        `${name} is in ${to} ${String(now.length)} times`,
      );
    }
  }

  /** A group whose last tab moved out is gone from the list. */
  private settleGroups() {
    this.groups = this.groups.filter(
      (group) => tabsIn(this.state, group).length > 0,
    );
  }

  // The close and reopen `app-window.tsx` does, through the same functions.

  private place(group: string) {
    return {
      id: TabIdSchema.parse(this.id("closed")),
      pathname: `/g/${group}`,
    };
  }

  private requestClose(tab: WindowTab, group: string) {
    const layout = groupLayoutOf(this.state, group);
    this.closed = withTabClosed(this.closed, layout, tab, this.place(group));
    this.run(group, "closeTab", tab.id);
  }

  private closeSide(group: string, side: 0 | 1) {
    const layout = groupLayoutOf(this.state, group);
    const kept = keptOf(layout.sides[side]?.tabs ?? []);
    this.closed = withSideClosed(
      this.closed,
      layout,
      side,
      kept,
      this.place(group),
    );
    this.run(group, "closeSide", group, side);
  }

  private closeGroup(group: string) {
    const kept = keptOf(tabsIn(this.state, group));
    const layout = groupLayoutOf(this.state, group);
    this.closed = withGroupClosed(this.closed, layout, kept, this.place(group));
    this.run(group, "dropGroup", group);
    this.groups = this.groups.filter((each) => each !== group);
  }

  private reopen() {
    const [entry] = this.closed.recentlyClosed;
    if (!entry) {
      return;
    }
    this.closed = forgetClosed(this.closed, { id: entry.id });
    const reopening = reopeningOf(entry, {
      again: (tab) => {
        const id = this.id("again");
        this.tags.set(id, this.tag(tab));
        return reopenedTab(tab, id);
      },
      isOpen: (group) => this.groups.includes(group),
    });
    if (reopening?.kind === "side") {
      this.run(reopening.group, "reopenSide", reopening.placing);
    } else if (reopening?.kind === "tab") {
      this.run(reopening.group, "reopenTab", reopening.placing);
    } else if (reopening) {
      const group = this.id("G");
      this.groups = [...this.groups, group];
      this.run(
        group,
        "restoreGroup",
        group,
        reopening.tabs.map((each) => ({ ...each, group })),
        reopening.ups,
      );
      // The save that follows puts a restored group's sides right.
      this.state = joinTabGroups(new Map(splitTabGroups(this.state)));
    }
  }
}

/** What a tab shows and where it stands in what it has shown, without its ids. */
function shown(tab: WindowTab) {
  return {
    at: tab.kind === "screen" ? tab.href : tab.url,
    future: (tab.future ?? []).length,
    kind: tab.kind,
    past: (tab.past ?? []).length,
    ...(tab.kind === "screen" ? { history: historyOf(tab) } : {}),
  };
}
