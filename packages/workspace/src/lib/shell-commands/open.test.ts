import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import { describe, expect, it } from "vitest";

import { publisher } from "../../rpc/publisher";
import { StoreId } from "../../schemas/store-id";
import { TaskIdSchema } from "../../schemas/task-id";
import { createOpenCommand } from "./open";

const taskId = TaskIdSchema.parse("open-command-task");

/** A window: answers each page it is asked to open with the tab it made. */
function answeringWindow() {
  const tabIds: StoreId.Session[] = [];
  const unsubscribe = publisher.subscribe("orchestrator.open", (ask) => {
    if (ask.target.kind !== "page") {
      return;
    }
    const tabId = StoreId.newSessionId();
    tabIds.push(tabId);
    publisher.publish("orchestrator.opened", {
      id: ask.id,
      requestId: ask.target.requestId,
      tabId,
    });
  });
  return { tabIds, unsubscribe };
}

function run(options: { tabIdTimeoutMs?: number }, ...args: string[]) {
  const fsTree = new InMemoryFs();
  fsTree.writeFileSync("/mnt/Instrument/report.md", "# report");
  return createOpenCommand({ taskId, ...options }).execute(
    args,
    createCommandContext({
      cwd: "/task",
      env: new Map<string, string>(),
      fs: fsTree,
      stdin: EMPTY_BYTES,
    }),
  );
}

describe("open", () => {
  it("prints the tab the window made for a page, so a task can be handed it", async () => {
    const window = answeringWindow();
    try {
      const result = await run(
        {},
        "https://example.com/",
        "https://example.org/",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(
        `Opened https://example.com/ (tab ${window.tabIds[0]})\nOpened https://example.org/ (tab ${window.tabIds[1]})\n`,
      );
    } finally {
      window.unsubscribe();
    }
  });

  it("still opens the page when no window answers", async () => {
    const result = await run({ tabIdTimeoutMs: 20 }, "https://example.com/");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Opened https://example.com/\n");
  });

  it("opens a file under a mount without asking for a tab id", async () => {
    const result = await run(
      { tabIdTimeoutMs: 20 },
      "/mnt/Instrument/report.md",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Opened /mnt/Instrument/report.md\n");
  });
});
