import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { publisher } from "../../rpc/publisher";
import { StoreId } from "../../schemas/store-id";
import { TaskIdSchema } from "../../schemas/task-id";
import { type WindowTabAction } from "../../schemas/window-tab";
import { createTabCommand } from "./tab";

const taskId = TaskIdSchema.parse("tab-command-chat");

// The window's own task holds the tabs the window makes; finding it for real
// would make one.
vi.mock(import("../orchestrator/ensure"), () => ({
  windowTaskId: () => Promise.resolve(TaskIdSchema.parse("window-task")),
}));

// Which task is at work in which tab, as the chat's tasks' records would say.
const holders = new Map<
  string,
  { id: ReturnType<typeof TaskIdSchema.parse>; title: string }
>();
vi.mock(import("../orchestrator/window-tab"), async (importOriginal) => ({
  ...(await importOriginal()),
  tabHolders: () => Promise.resolve(holders),
}));

let asked: { action: WindowTabAction; sessionId?: StoreId.Session }[];
let stopAnswering: () => void;

/**
 * A window with one tab open, `tab-known`: answers each ask the way the
 * window does, with a new tab for an open and an error for an id it has not
 * got.
 */
function answeringWindow() {
  const known = "tab-known";
  return publisher.subscribe("orchestrator.tab", (ask) => {
    asked.push({
      action: ask.action,
      ...(ask.sessionId ? { sessionId: ask.sessionId } : {}),
    });
    const { action } = ask;
    const answer =
      action.kind === "open"
        ? { tabId: `made-${asked.length}` }
        : action.tabId === known
          ? { tabId: known }
          : { error: `no tab ${action.tabId} is open in this chat.` };
    publisher.publish("orchestrator.tabDone", {
      id: ask.id,
      requestId: ask.requestId,
      ...answer,
    });
  });
}

function run(
  options: { sessionId?: StoreId.Session; timeoutMs?: number },
  ...args: string[]
) {
  const fsTree = new InMemoryFs();
  fsTree.writeFileSync("/mnt/Instrument/report.md", "# report");
  return createTabCommand({ taskId, ...options }).execute(
    args,
    createCommandContext({
      cwd: "/task",
      env: new Map<string, string>(),
      fs: fsTree,
      stdin: EMPTY_BYTES,
    }),
  );
}

beforeEach(() => {
  asked = [];
  holders.clear();
  stopAnswering = answeringWindow();
});

afterEach(() => {
  stopAnswering();
});

describe("tab open", () => {
  it("prints the tab the window made for each page, so a task can be handed it", async () => {
    const result = await run(
      {},
      "open",
      "https://example.com/",
      "https://example.org/",
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "Opened https://example.com/ (tab made-1)\nOpened https://example.org/ (tab made-2)\n",
    );
    expect(asked.map(({ action }) => action)).toEqual([
      {
        kind: "open",
        show: true,
        target: { kind: "page", url: "https://example.com/" },
      },
      {
        kind: "open",
        show: true,
        target: { kind: "page", url: "https://example.org/" },
      },
    ]);
  });

  // A terminal's `open` stands you in a folder, and so does this one. The
  // slash is how the window is told which of the two it was handed.
  it("opens a folder, named with the slash that says it is one", async () => {
    const result = await run({}, "open", "/mnt/Instrument");

    expect(result.stdout).toBe("Opened /mnt/Instrument/ (tab made-1)\n");
    expect(asked[0]?.action).toEqual({
      kind: "open",
      show: true,
      target: { kind: "path", mount: "/mnt/Instrument/" },
    });
  });

  it("refuses a path the window cannot show, and opens the rest", async () => {
    const result = await run(
      {},
      "open",
      "/etc/hosts",
      "/mnt/Instrument/report.md",
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('"/etc/hosts" is not a page');
    expect(result.stdout).toBe(
      "Opened /mnt/Instrument/report.md (tab made-1)\n",
    );
  });

  it("names the chat that asked", async () => {
    const sessionId = StoreId.newSessionId();
    await run({ sessionId }, "open", "https://example.com/");

    expect(asked[0]?.sessionId).toBe(sessionId);
  });

  it("still opens the page when no window answers", async () => {
    stopAnswering();
    const result = await run({ timeoutMs: 20 }, "open", "https://example.com/");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Opened https://example.com/\n");
  });
});

describe("tab close, replace and show", () => {
  it("closes a tab by its id", async () => {
    const result = await run({}, "close", "tab-known");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Closed tab tab-known.\n");
  });

  it("says which task was working in a tab it closed", async () => {
    holders.set("tab-known", {
      id: TaskIdSchema.parse("read-the-page"),
      title: "Read the page",
    });

    const result = await run({}, "close", "tab-known");

    expect(result.stdout).toContain(
      'Task read-the-page ("Read the page") was working in it',
    );
  });

  it("passes on the window's refusal of a tab it does not have", async () => {
    const result = await run({}, "close", "tab-gone");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("tab: no tab tab-gone is open in this chat.\n");
  });

  it("points a tab at a page", async () => {
    const result = await run(
      {},
      "replace",
      "tab-known",
      "https://example.com/",
    );

    expect(result.stdout).toBe(
      "Tab tab-known now shows https://example.com/.\n",
    );
    expect(asked[0]?.action).toEqual({
      kind: "replace",
      tabId: "tab-known",
      target: { kind: "page", url: "https://example.com/" },
    });
  });

  it("brings a tab forward", async () => {
    const result = await run({}, "show", "tab-known");

    expect(result.stdout).toBe("Tab tab-known is on the user's screen.\n");
  });

  it("says nothing changed when no window answers", async () => {
    stopAnswering();
    const result = await run({ timeoutMs: 20 }, "show", "tab-known");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("the window did not answer");
  });

  it.each([
    { args: [] },
    { args: ["list"] },
    { args: ["close"] },
    { args: ["show"] },
    { args: ["replace", "tab-known"] },
  ])("prints the usage for $args", async ({ args }) => {
    const result = await run({}, ...args);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Usage: tab open");
  });
});
