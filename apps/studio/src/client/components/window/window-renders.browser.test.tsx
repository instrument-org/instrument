// First: React reads the counter's hook as it loads.
import {
  grown,
  mountedComponents,
  type Renders,
  rendersOf,
  settled,
  topComponents,
} from "@/tests/render-count";
import { renderAppWindow } from "@/tests/app-window";
import { expect, it } from "vitest";

import { runWindowCommand } from "./use-window-commands";

// How much of the window a tab group or tab action renders, counted as the
// studio-drive probe counts (`perf-tab-groups.mjs`). Each limit is a scaling
// rule or a share of the window, so a feature that adds to the window moves
// the limit with it.
//
// A failure names what rendered. To see why, run the probe on the running app
// with those components in its `watch`, which says which prop, state or
// context changed. A limit raised on purpose says why in its commit.

const FILE = "src/client/components/window/window-renders.browser.test.tsx";

/**
 * What one more group out of sight may add to a new tab or a tab switch, in
 * components rendered: room for the sidebar list's wrapper around its row,
 * short of the row drawn again (about 28) or the group's own screens.
 */
const NEW_TAB_PER_GROUP = 15;

/**
 * What one more group out of sight may add to a group switch, which draws
 * each sidebar row again: short of the group's own tabs and screens drawn
 * again with it.
 */
const GROUP_SWITCH_PER_GROUP = 80;

/**
 * Each action's renders as a share of the components the window has mounted,
 * about twice what each renders. A group switch's commits draw the sidebar
 * more than once, so its share passes the whole window.
 */
const SHARE_OF_WINDOW = { groupSwitch: 2, newTab: 1.2, tabSwitch: 1 };

/** Groups of two tabs each: a screen kept drawn behind the group up, and a new tab, up. */
async function addGroups(count: number) {
  for (let index = 0; index < count; index++) {
    runWindowCommand("newChat");
    await settled();
    window.__studioDrive?.goto("/release-notes");
    await settled();
    runWindowCommand("newTab");
    await settled();
  }
}

/** A new tab, back to the tab before it, and over to the next group and back. */
async function actions() {
  const newTab = await rendersOf(() => {
    runWindowCommand("newTab");
  });
  const tabSwitch = await rendersOf(() => {
    runWindowCommand("previousTab");
  });
  const groupSwitch = await rendersOf(() => {
    runWindowCommand("nextChat");
  });
  await rendersOf(() => {
    runWindowCommand("previousChat");
  });
  return { groupSwitch, mounted: mountedComponents(), newTab, tabSwitch };
}

type Action = "groupSwitch" | "newTab" | "tabSwitch";

it("costs a new tab, a tab switch and a group switch the same however many groups are open", async () => {
  await renderAppWindow();
  await addGroups(2);
  const few = await actions();
  const groupsFew = window.__studioDrive?.look().groups.length ?? 0;
  await addGroups(6);
  const many = await actions();
  const added = (window.__studioDrive?.look().groups.length ?? 0) - groupsFew;
  expect(added).toBe(6);

  const growth = (action: Action, perGroup: number) => {
    const each = (many[action].fibers - few[action].fibers) / added;
    return each <= perGroup
      ? undefined
      : `${action}: ${few[action].fibers} components rendered with ${groupsFew} groups open, ${many[action].fibers} with ${groupsFew + added}: ${Math.round(each)} more for each group out of sight, past the ${perGroup} allowed. What rendered more: ${grown(few[action], many[action])}.`;
  };
  const share = (action: Action) => {
    const limit = SHARE_OF_WINDOW[action];
    const renders: Renders = few[action];
    return renders.fibers <= limit * few.mounted
      ? undefined
      : `${action}: ${renders.fibers} components rendered over ${renders.commits} commits, past ${limit} times the ${few.mounted} the window has mounted. What rendered: ${topComponents(renders)}.`;
  };
  const failures = [
    growth("newTab", NEW_TAB_PER_GROUP),
    growth("tabSwitch", NEW_TAB_PER_GROUP),
    growth("groupSwitch", GROUP_SWITCH_PER_GROUP),
    share("newTab"),
    share("tabSwitch"),
    share("groupSwitch"),
  ].filter((failure) => failure !== undefined);
  expect(
    failures,
    `The window renders more than it did for tab and group actions (${FILE}). Find the component whose props or context changed and keep them steady; see the notes atop the file.`,
  ).toEqual([]);
}, 60_000);
