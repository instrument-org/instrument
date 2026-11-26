import { type WindowTab } from "@/client/atoms/window";
import { emptyTabsModel, forgetClosed } from "@/client/lib/tabs-model";
import { unlistedTabGroups, WINDOW_TABS_KEY } from "@/shared/kept-state";
import { TabIdSchema, type TabsModel } from "@/shared/tabs";
import fc from "fast-check";

import {
  keptOf,
  reopeningOf,
  withGroupClosed,
  withTabClosed,
} from "./closed-tabs";
import {
  everyTabId,
  groupLayoutOf,
  reopenedTab,
  tabsIn,
  type WindowTabs,
} from "./tab-model";
import { joinTabGroups, splitTabGroups } from "./tab-members";
import { listedWith, listedWithout } from "./tab-groups";
import { applyTabCommand, type TabOp, type TabOpArgs } from "./tab-ops";

/**
 * Random sequences of what a person does across several windows on one
 * workspace: tabs and whole groups moved between windows, torn off into new
 * ones, groups closed and reopened from a window's own closed list, a group
 * picked from the Chats page, windows closed and reopened, Merge All Windows
 * and a relaunch. The tabs change through the operations every window change
 * goes through (`TAB_OPS`); what each window lists, and what main sweeps, by
 * the functions `useTabGroupActions`, `useGroupTabMoves`, `mergeAllWindows`
 * and `sweepTabGroups` call, in the order they call them
 * (docs/architecture/windows.md).
 */

export const WINDOW_RULES = {
  listed:
    "A group with tabs is listed by some window, open or closed to come back",
  mergeKeeps:
    "Merge All Windows keeps every group open in any window, as it was",
  moveKeeps: "A group moved to another window keeps its layout",
  oneWindow: "A group is open in one window at a time",
  relaunchKeeps: "A relaunch keeps every group an open window shows",
  reopenHere: "What a window reopens comes back in that window",
  throws: "No action throws",
  unique: "No tab is in two places",
  windowBack:
    "Closing a window and reopening it brings back its groups as they were",
} as const;
export type WindowRule = keyof typeof WINDOW_RULES;

export interface WindowViolation {
  detail: string;
  rule: WindowRule;
}

/** How many closed windows can come back (windows.md, Coming back). */
const KEPT_CLOSED_WINDOWS = 10;

const num = fc.nat({ max: 11 });

export const windowActionArb = fc.oneof(
  fc.record({ t: fc.constant("newTab" as const), w: num, g: num }),
  fc.record({ t: fc.constant("moveTab" as const), w: num, n: num, g: num }),
  fc.record({
    t: fc.constant("tabToWindow" as const),
    w: num,
    n: num,
    to: num,
  }),
  fc.record({
    t: fc.constant("groupToWindow" as const),
    w: num,
    g: num,
    to: num,
  }),
  fc.record({ t: fc.constant("tearOff" as const), w: num, n: num }),
  fc.record({ t: fc.constant("groupToNewWindow" as const), w: num, g: num }),
  fc.record({ t: fc.constant("closeTab" as const), w: num, n: num }),
  fc.record({ t: fc.constant("closeGroup" as const), w: num, g: num }),
  fc.record({ t: fc.constant("reopen" as const), w: num }),
  fc.record({ t: fc.constant("showGroup" as const), w: num, n: num }),
  fc.record({
    t: fc.constant("closeWindow" as const),
    w: num,
    back: fc.boolean(),
  }),
  fc.record({ t: fc.constant("reopenWindow" as const) }),
  fc.record({ t: fc.constant("merge" as const) }),
  fc.record({ t: fc.constant("relaunch" as const) }),
);
export type WindowAction =
  typeof windowActionArb extends fc.Arbitrary<infer T> ? T : never;

interface Win {
  closed: TabsModel;
  id: string;
  list: string[];
  open: boolean;
}

type Layouts = Record<string, { focused: number; sides: string[][] }>;

export class Windows {
  state: WindowTabs = {
    activeByGroup: { A: "a1", B: "b1", C: "c1" },
    tabs: [
      this.page("a1", "A"),
      this.page("a2", "A"),
      this.page("b1", "B"),
      this.page("c1", "C"),
      this.page("c2", "C"),
    ],
  };
  wins: Win[] = [
    { closed: emptyTabsModel(), id: "w0", list: ["A", "B"], open: true },
    { closed: emptyTabsModel(), id: "w1", list: ["C"], open: true },
  ];
  /** Closed windows that can come back, newest first. */
  closedWindows: string[] = [];
  readonly steps: { label: string; violations: WindowViolation[] }[] = [];
  private made = 0;
  private violations: WindowViolation[] = [];

  private page(id: string, group: string): WindowTab {
    return { group, id, kind: "page", openedAt: 0, url: `https://${id}.test/` };
  }

  private id(prefix: string) {
    this.made += 1;
    return `${prefix}${String(this.made)}`;
  }

  private fail(rule: WindowRule, detail: string) {
    this.violations.push({ detail, rule });
  }

  private same(rule: WindowRule, got: unknown, want: unknown, what: string) {
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
    this.state = applyTabCommand(this.state, { onScreen }, { args, op }).state;
  }

  private openWins() {
    return this.wins.filter((win) => win.open);
  }

  private win(n: number) {
    const open = this.openWins();
    return open.length === 0 ? undefined : open[n % open.length];
  }

  /** A group the window lists that has tabs. */
  private groupOf(win: Win, n: number) {
    const live = win.list.filter(
      (group) => tabsIn(this.state, group).length > 0,
    );
    return live.length === 0 ? undefined : live[n % live.length];
  }

  private tabOf(win: Win, n: number) {
    const tabs = win.list.flatMap((group) => tabsIn(this.state, group));
    return tabs.length === 0 ? undefined : tabs[n % tabs.length];
  }

  /** Each group's sides by tab id, and its side with the keyboard. */
  layouts(groups?: readonly string[]): Layouts {
    const named = groups ?? [
      ...new Set(
        this.state.tabs.flatMap((tab) => (tab.group ? [tab.group] : [])),
      ),
    ];
    return Object.fromEntries(
      named.map((group) => {
        const layout = groupLayoutOf(this.state, group);
        return [
          group,
          {
            focused: layout.focused,
            sides: layout.sides.map((side) => side.tabs.map((tab) => tab.id)),
          },
        ];
      }),
    );
  }

  /** One action, checked. Answers what it broke. */
  do(action: WindowAction): WindowViolation[] {
    this.violations = [];
    let label: string | undefined;
    try {
      label = this.act(action);
    } catch (error) {
      label = `${action.t} threw`;
      this.fail("throws", String(error));
    }
    if (label === undefined) {
      return [];
    }
    this.takeOffClosedWindows();
    this.always();
    this.steps.push({ label, violations: this.violations });
    return this.violations;
  }

  private always() {
    const ids = this.state.tabs.map((tab) => tab.id);
    if (everyTabId(this.state).size < ids.length) {
      this.fail("unique", "a tab id twice");
    }
    const listed = new Set(this.wins.flatMap((win) => win.list));
    for (const tab of this.state.tabs) {
      if (tab.group !== undefined && !listed.has(tab.group)) {
        this.fail("listed", `${tab.group} (${tab.id}) is listed by no window`);
      }
    }
    const seen = new Map<string, string>();
    for (const win of this.openWins()) {
      for (const group of win.list) {
        if (tabsIn(this.state, group).length === 0) {
          continue;
        }
        const other = seen.get(group);
        if (other !== undefined) {
          this.fail("oneWindow", `${group} is open in ${other} and ${win.id}`);
        }
        seen.set(group, win.id);
      }
    }
  }

  /** What main removes: the groups no window, open or closed to come back, lists, or with no tabs (`sweepTabGroups`). */
  private sweep() {
    const members = splitTabGroups(this.state);
    const record = Object.fromEntries(
      [...members].map(([key, value]) => [`${WINDOW_TABS_KEY}/${key}`, value]),
    );
    const gone = new Set(
      unlistedTabGroups(record, new Set(this.wins.flatMap((win) => win.list))),
    );
    this.state = joinTabGroups(
      new Map(
        [...members].filter(([key]) => !gone.has(`${WINDOW_TABS_KEY}/${key}`)),
      ),
    );
  }

  /** A closed window past the ones that can come back goes, file and all, and main sweeps. */
  private forget(id: string) {
    this.wins = this.wins.filter((win) => win.id !== id);
    this.closedWindows = this.closedWindows.filter((each) => each !== id);
    this.sweep();
  }

  /** `drop` in `useTabGroupActions`: off the window's list, its tabs and record gone. */
  private drop(win: Win, group: string) {
    win.list = listedWithout(win.list, group);
    this.run(group, "dropGroup", group);
  }

  /** `moveTab` in `useTabGroupActions`, as the window `win` does it. */
  private moveTab(win: Win, id: string, group: string) {
    const tab = this.state.tabs.find((each) => each.id === id);
    this.run(group, "moveTabTo", {
      group,
      id,
      select: true,
      side: groupLayoutOf(this.state, group).focused === 1 ? 1 : 0,
    });
    const from = tab?.group;
    if (
      from !== undefined &&
      from !== group &&
      tabsIn(this.state, from).length === 0
    ) {
      this.drop(win, from);
    }
  }

  private place(group: string) {
    return {
      id: TabIdSchema.parse(this.id("closed")),
      pathname: `/g/${group}`,
    };
  }

  private act(action: WindowAction): string | undefined {
    switch (action.t) {
      case "newTab": {
        const win = this.win(action.w);
        const group = win && this.groupOf(win, action.g);
        if (!win || group === undefined) {
          return undefined;
        }
        const id = this.id("p");
        this.run(group, "openInGroup", this.page(id, group), {
          from: { reason: "newTab" },
          group,
          select: true,
        });
        return `${win.id}: open ${id} in ${group}`;
      }
      case "moveTab": {
        const win = this.win(action.w);
        const tab = win && this.tabOf(win, action.n);
        const group = win && this.groupOf(win, action.g);
        if (!win || !tab || group === undefined || tab.group === group) {
          return undefined;
        }
        this.moveTab(win, tab.id, group);
        return `${win.id}: move ${tab.id} to ${group}`;
      }
      case "tabToWindow": {
        // `receive` in `useGroupTabMoves`: into the group up there.
        const win = this.win(action.w);
        const to = this.win(action.to);
        const tab = win && this.tabOf(win, action.n);
        const group = to && this.groupOf(to, 0);
        if (
          !win ||
          !to ||
          win === to ||
          !tab ||
          group === undefined ||
          tab.group === group
        ) {
          return undefined;
        }
        const from = tab.group;
        const whole =
          from !== undefined && tabsIn(this.state, from).length === 1;
        this.moveTab(to, tab.id, group);
        // `useLetGoOfWholeGroup`: the window it left lets go of its group.
        if (whole && from !== undefined) {
          win.list = listedWithout(win.list, from);
        }
        return `${win.id}: move ${tab.id} into ${to.id}'s ${group}`;
      }
      case "groupToWindow": {
        const win = this.win(action.w);
        const to = this.win(action.to);
        const group = win && this.groupOf(win, action.g);
        if (!win || !to || win === to || group === undefined) {
          return undefined;
        }
        const was = this.layouts([group]);
        // Listed there before this window lets go (`sendGroupTabToWindow`).
        to.list = listedWith(to.list, group);
        win.list = listedWithout(win.list, group);
        this.same("moveKeeps", this.layouts([group]), was, group);
        return `${win.id}: move group ${group} to ${to.id}`;
      }
      case "tearOff": {
        const win = this.win(action.w);
        const tab = win && this.tabOf(win, action.n);
        if (
          !win ||
          tab?.group === undefined ||
          tabsIn(this.state, tab.group).length < 2
        ) {
          return undefined;
        }
        // `make({ moving })` in the window opened for it, which lists it alone.
        const made: Win = {
          closed: emptyTabsModel(),
          id: this.id("win"),
          list: [],
          open: true,
        };
        this.wins.push(made);
        const group = this.id("G");
        made.list = listedWith(made.list, group);
        this.moveTab(made, tab.id, group);
        return `${win.id}: tear ${tab.id} off into ${made.id}`;
      }
      case "groupToNewWindow": {
        const win = this.win(action.w);
        const group = win && this.groupOf(win, action.g);
        if (!win || group === undefined || win.list.length < 2) {
          return undefined;
        }
        const was = this.layouts([group]);
        // `moveToNewWindow`: the new window opens on it, then this one lets go.
        this.wins.push({
          closed: emptyTabsModel(),
          id: this.id("win"),
          list: [group],
          open: true,
        });
        win.list = listedWithout(win.list, group);
        this.same("moveKeeps", this.layouts([group]), was, group);
        return `${win.id}: move group ${group} to a new window`;
      }
      case "closeTab": {
        const win = this.win(action.w);
        const tab = win && this.tabOf(win, action.n);
        const group = tab?.group;
        if (
          !win ||
          !tab ||
          group === undefined ||
          tabsIn(this.state, group).length < 2
        ) {
          return undefined;
        }
        win.closed = withTabClosed(
          win.closed,
          groupLayoutOf(this.state, group),
          tab,
          this.place(group),
        );
        this.run(group, "closeTab", tab.id);
        return `${win.id}: close ${tab.id}`;
      }
      case "closeGroup": {
        const win = this.win(action.w);
        const group = win && this.groupOf(win, action.g);
        if (!win || group === undefined) {
          return undefined;
        }
        const kept = keptOf(tabsIn(this.state, group));
        win.closed = withGroupClosed(
          win.closed,
          groupLayoutOf(this.state, group),
          kept,
          this.place(group),
        );
        this.drop(win, group);
        return `${win.id}: close group ${group}`;
      }
      case "reopen": {
        const win = this.win(action.w);
        const entry = win?.closed.recentlyClosed[0];
        if (!win || !entry) {
          return undefined;
        }
        win.closed = forgetClosed(win.closed, { id: entry.id });
        // `reopenClosedTab` in app-window.tsx.
        const reopening = reopeningOf(entry, {
          again: (tab) => reopenedTab(tab, this.id("again")),
          isOpen: (group) =>
            win.list.includes(group) && tabsIn(this.state, group).length > 0,
        });
        if (!reopening) {
          return undefined;
        }
        let group: string;
        if (reopening.kind === "side") {
          group = reopening.group;
          this.run(group, "reopenSide", reopening.placing);
        } else if (reopening.kind === "tab") {
          group = reopening.group;
          this.run(group, "reopenTab", reopening.placing);
        } else {
          group = this.id("G");
          win.list = listedWith(win.list, group);
          this.run(
            group,
            "restoreGroup",
            group,
            reopening.tabs.map((each) => ({ ...each, group })),
            reopening.ups,
          );
          this.state = joinTabGroups(new Map(splitTabGroups(this.state)));
        }
        if (!win.list.includes(group)) {
          this.fail(
            "reopenHere",
            `${win.id} reopened into ${group}, which it does not list`,
          );
        }
        return `${win.id}: reopen the last thing closed`;
      }
      case "showGroup": {
        // A group picked on the Chats page (`show` in `useTabGroupActions`).
        const win = this.win(action.w);
        const groups = [
          ...new Set(this.wins.flatMap((each) => each.list)),
        ].filter((group) => tabsIn(this.state, group).length > 0);
        const group = groups[action.n % Math.max(1, groups.length)];
        if (!win || group === undefined || win.list.includes(group)) {
          return undefined;
        }
        const elsewhere = this.wins.filter(
          (each) => each !== win && each.list.includes(group),
        );
        if (elsewhere.some((each) => each.open)) {
          return `${win.id}: pick ${group}, open in another window`;
        }
        // Main says no for a closed window, so it comes up here.
        win.list = listedWith(win.list, group);
        return `${win.id}: pick ${group}${elsewhere.length > 0 ? ", listed in a closed window" : ""}`;
      }
      case "closeWindow": {
        const win = this.win(action.w);
        if (!win || this.openWins().length < 2) {
          return undefined;
        }
        const list = [...win.list];
        const was = this.layouts(
          list.filter((group) => tabsIn(this.state, group).length > 0),
        );
        win.open = false;
        this.closedWindows.unshift(win.id);
        for (const id of this.closedWindows.slice(KEPT_CLOSED_WINDOWS)) {
          this.forget(id);
        }
        if (!action.back) {
          return `close ${win.id}`;
        }
        this.reopenWindow();
        this.same("windowBack", win.list, list, `${win.id}'s groups`);
        this.same(
          "windowBack",
          this.layouts(Object.keys(was)),
          was,
          `${win.id}'s layouts`,
        );
        return `close ${win.id}, then reopen it`;
      }
      case "reopenWindow": {
        return this.reopenWindow() ? "reopen the closed window" : undefined;
      }
      case "merge": {
        const [front, ...others] = this.openWins();
        if (!front || others.length === 0) {
          return undefined;
        }
        const groups = new Set(front.list);
        for (const other of others) {
          for (const group of other.list) {
            groups.add(group);
          }
        }
        const shown = [...groups].filter(
          (group) => tabsIn(this.state, group).length > 0,
        );
        const was = this.layouts(shown);
        front.list = [...groups];
        for (const other of others) {
          this.forget(other.id);
        }
        this.same("mergeKeeps", this.layouts(shown), was, "layouts");
        for (const group of shown) {
          if (!front.list.includes(group)) {
            this.fail("mergeKeeps", `${group} is not in ${front.id}`);
          }
        }
        return "Merge All Windows";
      }
      case "relaunch": {
        const shown = [
          ...new Set(this.openWins().flatMap((win) => win.list)),
        ].filter((group) => tabsIn(this.state, group).length > 0);
        const was = this.layouts(shown);
        this.sweep();
        this.same("relaunchKeeps", this.layouts(shown), was, "layouts");
        return "Quit and relaunch";
      }
    }
  }

  /** What main does as an open window keeps its list (`takeOffClosedWindows` in kept-state.ts). */
  private takeOffClosedWindows() {
    const open = new Set(this.openWins().flatMap((win) => win.list));
    for (const win of this.wins) {
      if (!win.open && win.list.some((group) => open.has(group))) {
        win.list = win.list.filter((group) => !open.has(group));
      }
    }
  }

  private reopenWindow() {
    const [id] = this.closedWindows;
    const win = this.wins.find((each) => each.id === id);
    if (!win) {
      return false;
    }
    this.closedWindows.shift();
    win.open = true;
    return true;
  }
}
