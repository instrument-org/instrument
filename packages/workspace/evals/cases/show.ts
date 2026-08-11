/**
 * Does a model reach for `show` on its own, and does it keep the fence?
 *
 * The two mechanisms are deliberately not interchangeable: the fence is the
 * record of what a reply handed over, and `show` is a request to put something
 * on screen right now. A model that treats them as alternatives produces one of
 * the two failures this measures -- a panel that opens onto work the transcript
 * never mentions, or a deliverable named in the reply that the user has to go
 * find. Both read as the feature being broken.
 *
 * Adherence is a property of the command's description, so this has to be
 * measured again whenever that description moves.
 */
import path from "node:path";

import { taskDir } from "../../src/lib/task-dir-utils";
import { getTaskState } from "../../src/lib/task-state-store";
import { TaskPane } from "../../src/schemas/task-pane";
import { type Assertion, defineEval } from "../harness";

const FIXTURES = path.resolve(import.meta.dirname, "../fixtures/files-fence");

function describePane(pane: TaskPane.Type): string {
  const tabs = pane.tabs
    .map((tab) => (tab.type === "browser" ? "browser" : tab.filePath))
    .join(" | ");
  return `${pane.open ? "open" : "closed"}, selected ${pane.selected ?? "(none)"}, tabs: ${tabs || "(none)"}`;
}

function describeTabs(tabs: TaskPane.Tab[]): string {
  return (
    tabs
      .map((tab) => (tab.type === "browser" ? "browser" : tab.filePath))
      .join(" | ") || "(pane empty)"
  );
}

async function paneTabs(taskId: Parameters<typeof taskDir>[0]) {
  const pane = await taskPane(taskId);
  return pane.tabs;
}

async function taskPane(taskId: Parameters<typeof taskDir>[0]) {
  const state = await getTaskState(taskDir(taskId));
  return state.pane ?? TaskPane.EMPTY;
}

/**
 * The pane holds a file the turn produced. Read from stored state rather than
 * from the command's stdout: what the user ends up looking at is the thing
 * under test, and a `show` whose write did not land still prints its line.
 */
const assertShowedAFile: Assertion = {
  check: async ({ taskId }) => {
    const tabs = await paneTabs(taskId);
    const files = tabs.filter((tab) => tab.type !== "browser");
    return {
      evidence: describeTabs(tabs),
      passed: files.length > 0,
      text: "Left a file open in the pane",
    };
  },
  text: "Left a file open in the pane",
};

/**
 * Scratch stays out of the panel. `work/` is where a model writes the script
 * that makes the deliverable, and showing that instead is the specific mistake
 * worth catching: it is the same confusion that made the old watcher-derived
 * change card useless.
 */
const assertShowedTheDeliverable: Assertion = {
  check: async ({ taskId }) => {
    const tabs = await paneTabs(taskId);
    const files = tabs.flatMap((tab) =>
      tab.type === "browser" ? [] : [tab.filePath],
    );
    const scratch = files.filter((filePath) => filePath.startsWith("work/"));
    return {
      evidence:
        files.length === 0
          ? "Nothing open in the pane"
          : `${describeTabs(tabs)}${scratch.length > 0 ? ` -- scratch: ${scratch.join(", ")}` : ""}`,
      passed: files.length > 0 && scratch.length === 0,
      text: "Showed the deliverable rather than its scratch",
    };
  },
  text: "Showed the deliverable rather than its scratch",
};

/**
 * A URL is a selection, not an insertion: the browser is the pane's fixed first
 * tab, so `show <url>` opens the pane onto it rather than storing a tab. Asked
 * as "is the pane open on the browser" for that reason, and because that is the
 * whole of what the user is promised -- the navigation itself is something
 * `agent-browser` would have done anyway.
 */
const assertShowedTheBrowser: Assertion = {
  check: async ({ taskId }) => {
    const pane = await taskPane(taskId);
    return {
      evidence: describePane(pane),
      passed:
        pane.open && pane.selected === TaskPane.tabKey({ type: "browser" }),
      text: "Opened the pane onto the browser",
    };
  },
  text: "Opened the pane onto the browser",
};

/**
 * The pane is not the record. A closed panel must not erase what the reply said
 * it produced, so a turn that shows a deliverable still names it in the fence.
 */
const assertStillNamedItInTheFence: Assertion = {
  check: async ({ sessions, taskId }) => {
    const tabs = await paneTabs(taskId);
    const shown = tabs.flatMap((tab) =>
      tab.type === "browser" ? [] : [tab.filePath],
    );
    const text = sessions
      .flatMap((session) =>
        session.messages
          .filter((message) => message.role === "assistant")
          .flatMap((message) =>
            message.parts.flatMap((part) =>
              part.type === "text" ? [part.text] : [],
            ),
          ),
      )
      .join("\n\n");
    const missing = shown.filter((filePath) => !text.includes(filePath));
    return {
      evidence:
        shown.length === 0
          ? "Nothing was shown, so nothing to corroborate"
          : missing.length === 0
            ? `All ${shown.length} shown file(s) also named in the reply`
            : `Shown but never named: ${missing.join(", ")}`,
      passed: shown.length > 0 && missing.length === 0,
      text: "Named what it showed in the reply as well",
    };
  },
  text: "Named what it showed in the reply as well",
};

/** Nothing to look at, so nothing should open. */
const assertShowedNothing: Assertion = {
  check: async ({ taskId }) => {
    const tabs = await paneTabs(taskId);
    return {
      evidence:
        tabs.length === 0
          ? "Pane left alone, as expected"
          : `Unwanted tabs: ${describeTabs(tabs)}`,
      passed: tabs.length === 0,
      text: "Left the pane alone when there was nothing to show",
    };
  },
  text: "Left the pane alone when there was nothing to show",
};

export const SHOW_EVALS = [
  defineEval({
    assertions: [
      assertShowedAFile,
      assertShowedTheDeliverable,
      assertStillNamedItInTheFence,
    ],
    name: "show-a-rendered-chart",
    prompt:
      "Using these numbers -- Jan 48200, Feb 51150, Mar 60400, Apr 57300, May 71900, Jun 83250 -- render me a line chart as a PNG and put it up on screen so I can look at it.",
  }),
  defineEval({
    assertions: [
      assertShowedAFile,
      assertShowedTheDeliverable,
      assertStillNamedItInTheFence,
    ],
    folders: [{ access: "read-only", path: path.join(FIXTURES, "Notes") }],
    name: "show-a-file-it-only-found",
    prompt:
      "Which of the notes in my Notes folder has the Helsinki launch date in it? Open it up so I can read it.",
  }),
  defineEval({
    assertions: [assertShowedTheBrowser],
    name: "show-a-page",
    prompt: "Pull up example.com so I can see it.",
  }),
  defineEval({
    assertions: [assertShowedNothing],
    name: "show-nothing-to-look-at",
    prompt:
      "In two sentences, what is the difference between a semaphore and a mutex?",
  }),
];
