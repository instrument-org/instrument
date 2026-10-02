import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

import { publisher } from "../../../rpc/publisher";
import { StoreId } from "../../../schemas/store-id";
import { TaskIdSchema } from "../../../schemas/task-id";
import { type HeldTab } from "../../../schemas/task-state";
import { WINDOW_ID } from "../../../schemas/window-id";
import { type WindowTabAction } from "../../../schemas/window-tab";
import {
  type BrowserTargetId,
  encodeBrowserTargetId,
  type WorkspaceConfig,
} from "../../../types";
import { type WorkspaceServerParentRef } from "../types";
import { handleTaskCdpClient, TASK_TAB_CAP } from "./cdp-task-bridge";

const TASK_ID = TaskIdSchema.parse("read-the-pages");

// The task's record, in memory: which tabs it holds.
const record: { browserTabs?: HeldTab[] } = {};
vi.mock("../../../lib/task-record", () => ({
  getTaskState: () => Promise.resolve({ ...record }),
  setTaskState: (_dir: unknown, patch: { browserTabs?: HeldTab[] }) => {
    Object.assign(record, patch);
    return Promise.resolve();
  },
}));
vi.mock("../../../lib/task-dir-utils", () => ({
  getBrowserSessionDir: () => "/tmp/profile",
  taskDir: (id: string) => `/tmp/tasks/${id}`,
}));
vi.mock("../../../lib/resolve-workspace-file-path", async () => {
  const { buildWorkspaceFsLayout } =
    await import("../../../lib/workspace-fs-layout");
  const { TaskDirSchema } = await import("../../../schemas/paths");
  return {
    taskFsLayout: () =>
      Promise.resolve(
        buildWorkspaceFsLayout({
          taskHostRoot: TaskDirSchema.parse("/tmp/tasks/read-the-pages"),
        }),
      ),
  };
});
// The window: what the task asked of it, answered with a tab of its own.
const asked: WindowTabAction[] = [];
vi.mock("../../../lib/chat/window-tab", () => ({
  askWindow: ({ action }: { action: WindowTabAction }) => {
    asked.push(action);
    return Promise.resolve({ requestId: "r" });
  },
  chatSessionOfTask: () =>
    StoreId.SessionSchema.parse("ses_01M3AX9RF3C2E9RTATMB602W0B"),
  requestWindowTab: (options: { show: boolean; url?: string }) => {
    asked.push({
      kind: "open",
      show: options.show,
      target: { kind: "page", ...(options.url ? { url: options.url } : {}) },
    });
    return Promise.resolve(StoreId.newSessionId());
  },
}));

function connect() {
  const live = new Set<BrowserTargetId>(
    (record.browserTabs ?? []).map((held) => held.id),
  );
  const subscribers = new Map<
    BrowserTargetId,
    {
      onDetach: () => void;
      onEvent: (method: string, params: unknown) => void;
    }[]
  >();
  const pages = new Map<BrowserTargetId, { title: string; url: string }>();
  const sent: Record<string, unknown>[] = [];
  const listeners: Record<string, (data: unknown) => void> = {};
  const ws = {
    on: (event: string, cb: (data: unknown) => void) => {
      listeners[event] = cb;
    },
    readyState: WebSocket.OPEN,
    send: (data: string) =>
      // The bridge's own frames, which are JSON objects.
      sent.push(JSON.parse(data) as Record<string, unknown>),
  };
  const sendCommand = vi.fn(() => Promise.resolve({ ok: true }));
  const config = {
    browser: {
      createTarget: (id: string, sessionId: string) => {
        const targetId = `${id}/${sessionId}` as BrowserTargetId;
        live.add(targetId);
        return Promise.resolve({ targetId });
      },
      getTargetMeta: (targetId: BrowserTargetId) =>
        live.has(targetId)
          ? { id: WINDOW_ID, partitionDir: "/tmp/profile", sessionId: "s" }
          : null,
      getTargetUrl: (targetId: BrowserTargetId) =>
        pages.get(targetId)?.url ?? "https://example.com/",
      listTargets: () =>
        Promise.resolve(
          [...live].map((id) => ({
            id,
            title: pages.get(id)?.title ?? "Example",
            type: "page",
            url: pages.get(id)?.url ?? "https://example.com/",
          })),
        ),
      sendCommand,
      setAgentFileRoots: vi.fn(),
      stopScreencast: vi.fn(),
      subscribeEvents: (
        targetId: BrowserTargetId,
        onDetach: () => void,
        onEvent: (method: string, params: unknown) => void,
      ) => {
        subscribers.set(targetId, [
          ...(subscribers.get(targetId) ?? []),
          { onDetach, onEvent },
        ]);
        return vi.fn();
      },
    },
    captureException: vi.fn(),
  } as unknown as WorkspaceConfig;
  handleTaskCdpClient(ws as unknown as WebSocket, TASK_ID, config, {
    send: vi.fn(),
  } as unknown as WorkspaceServerParentRef);

  let nextId = 0;
  const command = async (
    method: string,
    params: unknown = {},
    sessionId?: string,
  ) => {
    const id = ++nextId;
    listeners.message?.(
      Buffer.from(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }),
      ),
    );
    await flush();
    return sent.find((frame) => frame.id === id) as {
      error?: { message: string };
      result?: Record<string, unknown>;
    };
  };
  const events = (method: string) =>
    sent
      .filter((frame) => frame.method === method)
      .map((frame) => frame.params);
  return {
    /** A tab of the window coming open, as one handed over is. */
    appears: (targetId: BrowserTargetId) => {
      live.add(targetId);
    },
    closeByUser: (targetId: BrowserTargetId) => {
      live.delete(targetId);
      for (const { onDetach } of subscribers.get(targetId) ?? []) {
        onDetach();
      }
    },
    /** A tab's page moving on by itself, as a clicked link takes it. */
    command,
    events,
    navigates: async (
      targetId: BrowserTargetId,
      page: { title: string; url: string },
    ) => {
      pages.set(targetId, page);
      for (const { onEvent } of subscribers.get(targetId) ?? []) {
        onEvent("Page.frameNavigated", { frame: { id: "f", url: page.url } });
        onEvent("Page.loadEventFired", { timestamp: 1 });
      }
      await flush();
    },
    sendCommand,
  };
}

/** Lets every chained await the bridge started run out. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** A tab of the window, open, by its id. */
function tab(openedBy: HeldTab["openedBy"] = "handed") {
  const tabId = StoreId.newSessionId();
  return {
    held: {
      id: encodeBrowserTargetId(WINDOW_ID, tabId),
      openedBy,
    } satisfies HeldTab,
    tabId,
  };
}

beforeEach(() => {
  delete record.browserTabs;
  asked.length = 0;
});

describe("a task's browser", () => {
  it("is the tabs the task holds, by the window's ids for them", async () => {
    const first = tab();
    const second = tab("task");
    record.browserTabs = [first.held, second.held];
    const { command, events } = connect();

    await command("Target.setDiscoverTargets", { discover: true });
    const targets = await command("Target.getTargets");

    expect(
      (targets.result?.targetInfos as { targetId: string }[]).map(
        (info) => info.targetId,
      ),
    ).toEqual([first.tabId, second.tabId]);
    expect(
      events("Target.targetCreated").map(
        (params) =>
          (params as { targetInfo: { targetId: string } }).targetInfo.targetId,
      ),
    ).toEqual([first.tabId, second.tabId]);
  });

  it("sends a page's commands to that page, and no other", async () => {
    const first = tab();
    const second = tab();
    record.browserTabs = [first.held, second.held];
    const { command, sendCommand } = connect();

    const attached = await command("Target.attachToTarget", {
      flatten: true,
      targetId: second.tabId,
    });
    const sessionId = attached.result?.sessionId as string;
    await command("Runtime.evaluate", { expression: "1" }, sessionId);

    expect(sendCommand).toHaveBeenCalledWith(
      second.held.id,
      "Runtime.evaluate",
      {
        expression: "1",
      },
    );
    expect(sendCommand).not.toHaveBeenCalledWith(
      first.held.id,
      "Runtime.evaluate",
      expect.anything(),
    );
  });

  it("refuses to attach to a tab the task does not hold", async () => {
    record.browserTabs = [tab().held];
    const { command } = connect();

    const attached = await command("Target.attachToTarget", {
      flatten: true,
      targetId: StoreId.newSessionId(),
    });

    expect(attached.error?.message).toContain("not one of this task's tabs");
  });

  it("opens a new tab behind, in the task's chat, and holds it", async () => {
    record.browserTabs = [tab().held];
    const { command, events } = connect();

    const created = await command("Target.createTarget", {
      url: "https://example.org/",
    });

    expect(asked).toEqual([
      {
        kind: "open",
        show: false,
        target: { kind: "page", url: "https://example.org/" },
      },
    ]);
    const tabId = created.result?.targetId;
    expect(record.browserTabs.at(-1)).toEqual({
      id: `${WINDOW_ID}/${String(tabId)}`,
      openedBy: "task",
    });
    expect(
      events("Target.targetCreated").some(
        (params) =>
          (params as { targetInfo: { targetId: string } }).targetInfo
            .targetId === tabId,
      ),
    ).toBe(true);
  });

  it("stops opening tabs at the cap", async () => {
    record.browserTabs = Array.from(
      { length: TASK_TAB_CAP },
      () => tab("task").held,
    );
    const { command } = connect();

    const created = await command("Target.createTarget", {
      url: "about:blank",
    });

    expect(created.error?.message).toContain(`${TASK_TAB_CAP} tabs open`);
    expect(asked).toEqual([]);
  });

  it("closes a tab it opened, in the window", async () => {
    const own = tab("task");
    record.browserTabs = [tab().held, own.held];
    const { command, events } = connect();
    await command("Target.setDiscoverTargets", { discover: true });

    await command("Target.closeTarget", { targetId: own.tabId });

    expect(asked).toEqual([{ kind: "close", tabId: own.tabId }]);
    expect(record.browserTabs.map((held) => held.id)).not.toContain(
      own.held.id,
    );
    expect(events("Target.targetDestroyed")).toEqual([{ targetId: own.tabId }]);
  });

  it("only lets go of a tab it was handed, which is the user's", async () => {
    const handed = tab("handed");
    record.browserTabs = [handed.held, tab("task").held];
    const { command } = connect();

    const closed = await command("Target.closeTarget", {
      targetId: handed.tabId,
    });

    expect(closed.result).toEqual({ success: true });
    expect(asked).toEqual([]);
    expect(record.browserTabs.map((held) => held.id)).not.toContain(
      handed.held.id,
    );
  });

  it("never brings a page forward in the window", async () => {
    const only = tab();
    record.browserTabs = [only.held];
    const { command, sendCommand } = connect();
    const attached = await command("Target.attachToTarget", {
      flatten: true,
      targetId: only.tabId,
    });

    const answer = await command(
      "Page.bringToFront",
      {},
      attached.result?.sessionId as string,
    );
    await command("Target.activateTarget", { targetId: only.tabId });

    expect(answer.result).toEqual({});
    expect(sendCommand).not.toHaveBeenCalledWith(
      only.held.id,
      "Page.bringToFront",
      expect.anything(),
    );
  });

  it("tells the agent when the user closes one of its tabs", async () => {
    const closing = tab();
    record.browserTabs = [closing.held, tab().held];
    const { closeByUser, command, events } = connect();
    await command("Target.setDiscoverTargets", { discover: true });
    await command("Target.attachToTarget", {
      flatten: true,
      targetId: closing.tabId,
    });

    closeByUser(closing.held.id);

    expect(events("Target.detachedFromTarget")).toEqual([
      { sessionId: `session-${closing.tabId}`, targetId: closing.tabId },
    ]);
    expect(events("Target.targetDestroyed")).toEqual([
      { targetId: closing.tabId },
    ]);
  });

  it("tells the agent where a tab it drives has gone, and names it", async () => {
    const driven = tab();
    record.browserTabs = [driven.held];
    const { command, events, navigates } = connect();
    await command("Target.setDiscoverTargets", { discover: true });
    await command("Target.attachToTarget", {
      flatten: true,
      targetId: driven.tabId,
    });

    await navigates(driven.held.id, {
      title: "Glass - Wikipedia",
      url: "https://en.wikipedia.org/wiki/Glass",
    });
    const targets = await command("Target.getTargets");

    expect(
      events("Target.targetInfoChanged").map((params) => {
        const { targetId, title, url } = (
          params as { targetInfo: Record<string, string> }
        ).targetInfo;
        return { targetId, title, url };
      }),
    ).toEqual(
      Array.from({ length: 2 }, () => ({
        targetId: driven.tabId,
        title: "Glass - Wikipedia",
        url: "https://en.wikipedia.org/wiki/Glass",
      })),
    );
    expect(
      (targets.result?.targetInfos as { title: string }[]).map(
        (info) => info.title,
      ),
    ).toEqual(["Glass - Wikipedia"]);
  });

  it("tells the agent of a tab handed over while it is connected", async () => {
    record.browserTabs = [tab().held];
    const { appears, command, events } = connect();
    await command("Target.setDiscoverTargets", { discover: true });

    const handed = tab();
    appears(handed.held.id);
    record.browserTabs = [...record.browserTabs, handed.held];
    publisher.publish("task.stateUpdated", { id: TASK_ID });
    await flush();

    expect(
      events("Target.targetCreated").map(
        (params) =>
          (params as { targetInfo: { targetId: string } }).targetInfo.targetId,
      ),
    ).toContain(handed.tabId);
  });
});
