import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { taskDir } from "../task-dir-utils";
import { getTaskState } from "../task-state-store";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { createShowCommand } from "./show";

const rootDir = mkdtempSync(path.join(os.tmpdir(), "show-cmd-"));
const taskId = TaskIdSchema.parse("show-command-task");
const sessionId = StoreId.newSessionId();

createMockTaskConfig(taskId);
setWorkspaceConfig({
  ...getWorkspaceConfig(),
  tasksDir: AbsolutePathSchema.parse(rootDir),
});

function run(...args: string[]) {
  const fsTree = new InMemoryFs();
  fsTree.writeFileSync("/task/output/report.pdf", "pdf");
  fsTree.writeFileSync("/task/work/scratch.txt", "notes");
  fsTree.writeFileSync("/mnt/Photos/cat.png", "png");
  fsTree.writeFileSync("/task/.instrument/state.json", "{}");

  return createShowCommand({ sessionId, taskId }).execute(
    args,
    createCommandContext({
      cwd: "/task",
      env: new Map<string, string>(),
      fs: fsTree,
      stdin: EMPTY_BYTES,
    }),
  );
}

async function storedPane() {
  const state = await getTaskState(taskDir(taskId));
  return state.pane;
}

afterEach(async () => {
  await fs.rm(taskDir(taskId), { force: true, recursive: true });
});

describe("show", () => {
  it("opens a task file as a tab and says what it showed", async () => {
    const result = await run("output/report.pdf");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Showing output/report.pdf\n");
    expect(await storedPane()).toMatchInlineSnapshot(`
      {
        "open": true,
        "selected": "file:output/report.pdf",
        "tabs": [
          {
            "filePath": "output/report.pdf",
            "type": "file",
          },
        ],
      }
    `);
  });

  it("keeps a file under a shared folder addressed by its mount path", async () => {
    await run("/mnt/Photos/cat.png");

    const pane = await storedPane();
    expect(pane?.tabs).toEqual([
      { filePath: "/mnt/Photos/cat.png", type: "file" },
    ]);
  });

  it("appends in argument order and focuses the last", async () => {
    const result = await run("work/scratch.txt", "output/report.pdf");

    expect(result.stdout).toBe(
      "Showing work/scratch.txt\nShowing output/report.pdf\n",
    );
    const pane = await storedPane();
    expect(pane?.selected).toBe("file:output/report.pdf");
  });

  it("exits non-zero for a path that resolves to nothing", async () => {
    const result = await run("output/missing.pdf");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatchInlineSnapshot(`
      "show: "output/missing.pdf" does not exist.
      "
    `);
    expect(await storedPane()).toBeUndefined();
  });

  it("still shows what resolved when one argument fails", async () => {
    const result = await run("output/report.pdf", "nope.txt");

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("Showing output/report.pdf\n");
    const pane = await storedPane();
    expect(pane?.tabs).toHaveLength(1);
  });

  it("refuses a path outside the task and the shared folders", async () => {
    const result = await run("/skills/some-skill/SKILL.md");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("outside the task");
  });

  it("refuses the task's private directory", async () => {
    const result = await run(".instrument/state.json");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("private directory");
  });

  // The pane always draws the browser, so showing a URL focuses it rather than
  // storing a tab that would then sit in the order the user can drag.
  it("focuses the browser for a URL without storing a tab", async () => {
    const result = await run("https://example.com");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Showing https://example.com\n");
    const pane = await storedPane();
    expect(pane?.selected).toBe("browser");
    expect(pane?.tabs).toEqual([]);
  });

  // One browsing session means one page, so absorbing the extras would report
  // three URLs shown while showing the third.
  it("refuses more than one URL rather than navigating to the last", async () => {
    const result = await run("https://example.com", "https://example.org");

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("Showing https://example.com\n");
    expect(result.stderr).toContain("only one URL");
  });

  it("does not claim to have shown a page that failed to load", async () => {
    const config = getWorkspaceConfig();
    setWorkspaceConfig({
      ...config,
      browser: {
        ...config.browser,
        // `Page.navigate` reports a navigation that never started here rather
        // than by throwing.
        sendCommand: () =>
          Promise.resolve({ errorText: "net::ERR_NAME_NOT_RESOLVED" }),
      },
    });

    try {
      const result = await run("https://nowhere.invalid");

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("ERR_NAME_NOT_RESOLVED");
      // Focusing the browser would show the user the previous page and call it
      // the one they asked for.
      expect(await storedPane()).toBeUndefined();
    } finally {
      setWorkspaceConfig(config);
    }
  });

  it("still shows a file when the URL beside it fails", async () => {
    const config = getWorkspaceConfig();
    setWorkspaceConfig({
      ...config,
      browser: {
        ...config.browser,
        sendCommand: () =>
          Promise.resolve({ errorText: "net::ERR_NAME_NOT_RESOLVED" }),
      },
    });

    try {
      const result = await run("output/report.pdf", "https://nowhere.invalid");

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("Showing output/report.pdf\n");
      const pane = await storedPane();
      expect(pane?.selected).toBe("file:output/report.pdf");
    } finally {
      setWorkspaceConfig(config);
    }
  });

  it("asks for an argument", async () => {
    const result = await run();

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("nothing to show");
  });
});
