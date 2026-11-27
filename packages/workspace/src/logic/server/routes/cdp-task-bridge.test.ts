import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

import { cdpMethodsHandled } from "../../../lib/cdp-methods";
import {
  announceChatTab,
  closeChatTab,
  noteTabCommand,
  tabsActedInBy,
  takeTabNews,
} from "../../../lib/tab-activity";
import { StoreId } from "../../../schemas/store-id";
import { ChatIdSchema } from "../../../schemas/chat-id";
import { type WindowTabAction } from "../../../schemas/window-tab";
import {
  type BrowserTargetId,
  browserTargetOf,
  type WorkspaceConfig,
} from "../../../types";
import { type WorkspaceServerParentRef } from "../types";
import { handleTaskCdpClient, isPageWork } from "./cdp-task-bridge";

const TASK_ID = ChatIdSchema.parse("read-the-pages");

const SESSION_ID = StoreId.SessionSchema.parse(
  "ses_01M3AX9RF3C2E9RTATMB602W0C",
);
const OTHER_SESSION = StoreId.SessionSchema.parse(
  "ses_01M3AX9RF3C2E9RTATMB602W0D",
);

/** The tabs the chat's agents opened, in memory. */
const record: { openedTabs: { id: BrowserTargetId }[] } = { openedTabs: [] };
/** The chat's tabs as the window groups them, a page's guest up or not. */
let windowList: {
  id: string;
  kind: "page";
  /** The page the tab draws, where it is not the tab's own id, as for a tab on an HTML file. */
  targetId?: string;
  title: string;
  url: string;
}[] = [];
vi.mock("../../../lib/chat/chat-tabs", () => ({
  chatPageTabs: () =>
    Promise.resolve(
      windowList.map((entry) => ({
        ...entry,
        targetId: (entry.targetId ?? entry.id) as BrowserTargetId,
      })),
    ),
  forgetOpenedTabs: (_chatId: unknown, ids: ReadonlySet<string>) => {
    record.openedTabs = record.openedTabs.filter((entry) => !ids.has(entry.id));
    return Promise.resolve();
  },
  noteOpenedTab: (_chatId: unknown, id: BrowserTargetId) => {
    record.openedTabs = [...record.openedTabs, { id }];
    return Promise.resolve();
  },
}));
vi.mock("../../../lib/chat-record", () => ({
  getChatState: () =>
    Promise.resolve({ closedTabs: [], openedTabs: record.openedTabs }),
}));
vi.mock("../../../lib/record-folders", () => ({
  chatDir: (id: string) => `/tmp/chats/${id}`,
  resolveChat: (id: string) => id,
}));
vi.mock("../../../lib/chat/tab-cap", () => ({
  closeTabsOverCap: () => Promise.resolve(),
}));
vi.mock("../../../lib/chat-dir-utils", () => ({
  getBrowserSessionDir: () => "/tmp/profile",
}));
// The chats whose folders were read for a gate.
const { layoutsReadFor } = vi.hoisted(() => ({
  layoutsReadFor: [] as string[],
}));
vi.mock("../../../lib/session-layout", async () => {
  const { buildWorkspaceFsLayout } =
    await import("../../../lib/workspace-fs-layout");
  const { WorkDirSchema } = await import("../../../schemas/paths");
  return {
    sessionLayout: ({ chatId }: { chatId: string }) => {
      layoutsReadFor.push(chatId);
      return Promise.resolve(
        buildWorkspaceFsLayout({
          chatHostRoot: WorkDirSchema.parse("/tmp/tasks/read-the-pages"),
        }),
      );
    },
  };
});
// The window: what the session asked of it, a new tab joining the chat's.
const asked: WindowTabAction[] = [];
/** Whether the window leaves a restore ask unanswered, as it does past the ask's timeout. */
let restoreUnanswered = false;
/** Why the window opens no tab, as for a chat whose tab the person closed. */
let openRefused: string | undefined;
vi.mock("../../../lib/chat/window-tab", () => ({
  askWindow: ({ action }: { action: WindowTabAction }) => {
    asked.push(action);
    if (action.kind === "restore" && restoreUnanswered) {
      return Promise.resolve(undefined);
    }
    if (action.kind === "close") {
      windowList = windowList.filter((entry) => entry.id !== action.tabId);
    }
    if (action.kind === "adopt") {
      windowList = [
        ...windowList,
        { id: action.tabId, kind: "page", title: "", url: action.url },
      ];
    }
    return Promise.resolve({
      requestId: "r",
      ...(action.kind === "restore" ||
      action.kind === "close" ||
      action.kind === "adopt"
        ? { tabId: action.tabId }
        : {}),
    });
  },
  requestWindowTab: (options: { show: boolean; url?: string }) => {
    asked.push({
      kind: "open",
      show: options.show,
      target: { kind: "page", ...(options.url ? { url: options.url } : {}) },
    });
    if (openRefused !== undefined) {
      return Promise.resolve({ error: openRefused });
    }
    const tabId = StoreId.newTabId();
    windowList = [
      ...windowList,
      {
        id: tabId,
        kind: "page",
        title: "",
        url: options.url ?? "about:blank",
      },
    ];
    return Promise.resolve(tabId);
  },
}));

function connect(sessionId: StoreId.Session = SESSION_ID) {
  const live = new Set<BrowserTargetId>(
    windowList.map((entry) => (entry.targetId ?? entry.id) as BrowserTargetId),
  );
  const subscribers = new Map<
    BrowserTargetId,
    {
      onDetach: () => void;
      onEvent: (method: string, params: unknown, frameSession?: string) => void;
    }[]
  >();
  const pages = new Map<BrowserTargetId, { title: string; url: string }>();
  /** The guests the bridge closed itself, pages that never had a tab. */
  const closedPages: BrowserTargetId[] = [];
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
  const sendCommand = vi.fn(
    (..._args: unknown[]): Promise<unknown> => Promise.resolve({ ok: true }),
  );
  const config = {
    browser: {
      closeTarget: (targetId: BrowserTargetId) => {
        live.delete(targetId);
        closedPages.push(targetId);
        return Promise.resolve();
      },
      createTarget: (targetId: BrowserTargetId) => {
        live.add(targetId);
        return Promise.resolve();
      },
      getTargetMeta: (targetId: BrowserTargetId) =>
        live.has(targetId) ? { partitionDir: "/tmp/profile" } : null,
      getTargetAddress: (targetId: BrowserTargetId) =>
        live.has(targetId)
          ? (pages.get(targetId)?.url ??
            windowList.find((entry) => entry.id === targetId)?.url ??
            "https://example.com/")
          : undefined,
      getLoadedDocumentUrl: (targetId: BrowserTargetId) =>
        live.has(targetId)
          ? (pages.get(targetId)?.url ??
            windowList.find((entry) => entry.id === targetId)?.url ??
            "https://example.com/")
          : undefined,
      listTargets: () =>
        Promise.resolve(
          [...live].map((id) => ({
            id,
            title: pages.get(id)?.title ?? "Example",
            type: "page",
            url: pages.get(id)?.url ?? "https://example.com/",
          })),
        ),
      personInputAt: () => undefined,
      sendCommand,
      setAgentFileRoots: vi.fn(),
      stopScreencast: vi.fn(),
      subscribeEvents: (
        targetId: BrowserTargetId,
        onDetach: () => void,
        onEvent: (
          method: string,
          params: unknown,
          frameSession?: string,
        ) => void,
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
  handleTaskCdpClient(
    ws as unknown as WebSocket,
    { sessionId, chatId: TASK_ID },
    config,
    { send: vi.fn() } as unknown as WorkspaceServerParentRef,
  );

  let nextId = 0;
  const command = async (
    method: string,
    params: unknown = {},
    session?: string,
  ) => {
    const id = ++nextId;
    listeners.message?.(
      Buffer.from(
        JSON.stringify({
          id,
          method,
          params,
          ...(session ? { sessionId: session } : {}),
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
    /** An event from a tab's guest, from one of its frames when `frameSession` names one. */
    emit: async (
      targetId: BrowserTargetId,
      method: string,
      params: unknown,
      frameSession?: string,
    ) => {
      for (const { onEvent } of subscribers.get(targetId) ?? []) {
        onEvent(method, params, frameSession);
      }
      await flush();
    },
    closedPages,
    /** The agent's connection closing, as its daemon exits. */
    disconnects: async () => {
      listeners.close?.(undefined);
      await flush();
    },
    closeByUser: (targetId: BrowserTargetId) => {
      live.delete(targetId);
      for (const { onDetach } of subscribers.get(targetId) ?? []) {
        onDetach();
      }
    },
    /** A tab's page discarded: the tab stays in the window, its guest goes. */
    discards: (targetId: BrowserTargetId) => {
      live.delete(targetId);
    },
    /** A tab's page taken by another window: the page goes, and a new one stands in its place. */
    movesWindow: async (targetId: BrowserTargetId) => {
      const watching = subscribers.get(targetId) ?? [];
      subscribers.delete(targetId);
      for (const { onDetach } of watching) {
        onDetach();
      }
      await flush();
    },
    command,
    disconnect: () => listeners.close?.(undefined),
    events,
    /** A tab's page moving on by itself, as a clicked link takes it. */
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
    /** A tab coming into the chat while the agent is connected. */
    opensInWindow: (targetId: BrowserTargetId) => {
      live.add(targetId);
      windowList = [
        ...windowList,
        { id: targetId, kind: "page", title: "Later", url: "https://later/" },
      ];
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

/**
 * A page tab of the chat's in the window. `opened` for one an agent opened;
 * `worked` for one this session already sent a command, so it starts there
 * rather than in a blank tab of its own.
 */
function tab({
  opened = false,
  worked = true,
}: { opened?: boolean; worked?: boolean } = {}) {
  const tabId = StoreId.newTabId();
  const targetId = browserTargetOf(tabId);
  windowList = [
    ...windowList,
    { id: tabId, kind: "page", title: "Example", url: "https://example.com/" },
  ];
  if (opened) {
    record.openedTabs = [...record.openedTabs, { id: targetId }];
  }
  if (worked) {
    noteTabCommand(targetId, { chatId: TASK_ID, sessionId: SESSION_ID });
  }
  return { tabId, targetId };
}

/** The ids `Target.targetCreated` announced, in order. */
function created(events: (method: string) => unknown[]) {
  return events("Target.targetCreated").map(
    (params) =>
      (params as { targetInfo: { targetId: string } }).targetInfo.targetId,
  );
}

beforeEach(() => {
  record.openedTabs = [];
  windowList = [];
  asked.length = 0;
  restoreUnanswered = false;
});

describe("a session's browser", () => {
  it("is the tabs the chat's agents opened and the session worked in, by the window's ids, and a tab of the user's once its agent names it", async () => {
    // A tab the window put in the chat with nothing written about it: a
    // draft's page as it becomes the chat.
    const sent = tab({ worked: false });
    const own = tab();
    const another = tab({ opened: true, worked: false });
    const { command, events } = connect();

    await command("Target.setDiscoverTargets", { discover: true });
    const targets = await command("Target.getTargets");

    // The tab the session worked in first, then the rest.
    const ids = (infos: unknown) =>
      (infos as { targetId: string }[]).map((info) => info.targetId);
    expect(ids(targets.result?.targetInfos)).toEqual([
      own.tabId,
      another.tabId,
    ]);
    expect(created(events)).toEqual([own.tabId, another.tabId]);
    expect(asked).toEqual([]);

    expect(
      await announceChatTab(
        { chatId: TASK_ID, sessionId: SESSION_ID },
        sent.tabId,
      ),
    ).toBe(true);
    const again = await command("Target.getTargets");

    expect(created(events)).toEqual([own.tabId, another.tabId, sent.tabId]);
    expect(ids(again.result?.targetInfos)).toEqual([
      own.tabId,
      sent.tabId,
      another.tabId,
    ]);
  });

  it("gives a session that has worked in none of the chat's tabs a blank page of its own with no tab, listed first", async () => {
    const theirs = tab({ worked: false });
    const { command } = connect(OTHER_SESSION);

    const targets = await command("Target.getTargets");

    const ids = (targets.result?.targetInfos as { targetId: string }[]).map(
      (info) => info.targetId,
    );
    expect(asked).toEqual([]);
    expect(ids).toHaveLength(1);
    expect(ids).not.toContain(theirs.tabId);
    expect(record.openedTabs).toEqual([]);
  });

  it("sends a page's commands to that page, and no other, as this session's", async () => {
    const first = tab();
    const second = tab();
    const { command, sendCommand } = connect(OTHER_SESSION);

    const attached = await command("Target.attachToTarget", {
      flatten: true,
      targetId: second.tabId,
    });
    const sessionId = attached.result?.sessionId as string;
    await command("Runtime.evaluate", { expression: "1" }, sessionId);

    expect(sendCommand).toHaveBeenCalledWith(
      second.targetId,
      "Runtime.evaluate",
      { expression: "1" },
    );
    expect(sendCommand).not.toHaveBeenCalledWith(
      first.targetId,
      "Runtime.evaluate",
      expect.anything(),
    );
  });

  it("reaches a tab's cross-site frame through the tab's session, and only once its page asked for frames", async () => {
    const only = tab();
    const { command, emit, events, sendCommand } = connect();
    const attached = await command("Target.attachToTarget", {
      flatten: true,
      targetId: only.tabId,
    });
    const page = attached.result?.sessionId as string;

    await command(
      "Target.setAutoAttach",
      { autoAttach: true, flatten: true, waitForDebuggerOnStart: true },
      page,
    );
    await emit(only.targetId, "Target.attachedToTarget", {
      sessionId: "frame-1",
      targetInfo: {
        targetId: "F1",
        type: "iframe",
        url: "https://pay.example/",
      },
      waitingForDebugger: false,
    });
    const read = await command("DOM.getDocument", {}, "frame-1");
    const front = await command("Page.bringToFront", {}, "frame-1");

    expect(sendCommand).toHaveBeenCalledWith(
      only.targetId,
      "Target.setAutoAttach",
      expect.objectContaining({
        autoAttach: true,
        waitForDebuggerOnStart: false,
      }),
    );
    expect(events("Target.attachedToTarget")).toEqual([
      expect.objectContaining({ sessionId: "frame-1" }),
    ]);
    expect(read.error).toBeUndefined();
    expect(sendCommand).toHaveBeenCalledWith(
      only.targetId,
      "DOM.getDocument",
      {},
      "frame-1",
    );
    expect(front.result).toEqual({});
    expect(sendCommand).not.toHaveBeenCalledWith(
      expect.anything(),
      "Page.bringToFront",
      expect.anything(),
      expect.anything(),
    );
  });

  it("judges a tab's local files by the folders of the session's chat", async () => {
    const only = tab();
    layoutsReadFor.length = 0;
    const { command } = connect();

    const attached = await command("Target.attachToTarget", {
      flatten: true,
      targetId: only.tabId,
    });
    await command(
      "Runtime.evaluate",
      { expression: "1" },
      attached.result?.sessionId as string,
    );

    expect(layoutsReadFor).not.toEqual([]);
    expect(new Set(layoutsReadFor)).toEqual(new Set([TASK_ID]));
  });

  it("refuses to attach to a tab that is not the chat's", async () => {
    tab();
    const { command } = connect();

    const attached = await command("Target.attachToTarget", {
      flatten: true,
      targetId: StoreId.newTabId(),
    });

    expect(attached.error?.message).toContain("not one of this chat's tabs");
  });

  it("opens a new tab behind, in the chat, as one an agent opened", async () => {
    tab();
    const { command, events } = connect();

    const made = await command("Target.createTarget", {
      url: "https://example.org/",
    });

    expect(asked).toEqual([
      {
        kind: "open",
        show: false,
        target: { kind: "page", url: "https://example.org/" },
      },
    ]);
    const tabId = made.result?.targetId;
    expect(record.openedTabs.at(-1)).toEqual({ id: tabId });
    expect(created(events)).toContain(tabId);
  });

  it("says why when the window opens no tab, never making a group for it", async () => {
    tab();
    openRefused = "the user closed this chat's tab, so nothing opened.";
    const { command } = connect();

    const made = await command("Target.createTarget", {
      url: "https://example.org/",
    });
    openRefused = undefined;

    expect(made.error?.message).toMatchInlineSnapshot(
      `"The window opened no tab: the user closed this chat's tab, so nothing opened."`,
    );
    expect(record.openedTabs).toEqual([]);
  });

  it("refuses a new tab at an address the browser cannot load, and closes the blank tab it made", async () => {
    tab();
    const { command, sendCommand } = connect();
    sendCommand.mockImplementation((...args: unknown[]) =>
      args[1] === "Page.navigate"
        ? Promise.reject(new Error("Cannot navigate to invalid URL"))
        : Promise.resolve({ ok: true }),
    );

    const made = await command("Target.createTarget", {
      url: "devil-symbolism/index.html",
    });

    expect(made.error?.message).toMatchInlineSnapshot(
      `"devil-symbolism/index.html did not open: Cannot navigate to invalid URL"`,
    );
    const opened = asked.find((action) => action.kind === "open");
    expect(opened).toBeDefined();
    expect(asked.filter((action) => action.kind === "close")).toHaveLength(1);
    expect(record.openedTabs).toEqual([]);
  });

  it("gives a page asked for with no address its tab in the chat only once it goes somewhere", async () => {
    tab();
    const { command, navigates } = connect();

    const made = await command("Target.createTarget", { url: "about:blank" });
    const tabId = StoreId.TabSchema.parse(made.result?.targetId);
    expect(asked).toEqual([]);
    expect(record.openedTabs).toEqual([]);

    await navigates(browserTargetOf(tabId), {
      title: "Shop",
      url: "https://shop/",
    });

    expect(asked).toEqual([{ kind: "adopt", tabId, url: "https://shop/" }]);
    expect(record.openedTabs).toEqual([{ id: tabId }]);
  });

  it("closes a page asked for with no address that never went anywhere with the connection", async () => {
    tab();
    const { closedPages, command, disconnects } = connect();
    const made = await command("Target.createTarget", { url: "about:blank" });

    await disconnects();

    expect(closedPages).toEqual([made.result?.targetId]);
    expect(asked).toEqual([]);
  });

  it.each([
    "chrome-extension://aeblfdkhhhdcdjpifhhbdiojplfjncoa/app/app.html",
    "Chrome-Extension://aeblfdkhhhdcdjpifhhbdiojplfjncoa/app/app.html",
    "chrome-\textension://aeblfdkhhhdcdjpifhhbdiojplfjncoa/app/app.html",
    "\u0001chrome-extension://aeblfdkhhhdcdjpifhhbdiojplfjncoa/app/app.html",
  ])("refuses a new tab at an extension's own page: %s", async (url) => {
    const { command } = connect();

    const made = await command("Target.createTarget", { url });

    expect(made.error?.message).toContain("is an extension's own page");
    expect(asked).toEqual([]);
    expect(record.openedTabs).toEqual([]);
  });

  it("lists a tab whose page was discarded at the window's address, and brings it back only as a command reaches it", async () => {
    const resting = tab();
    windowList = windowList.map((entry) =>
      entry.id === resting.tabId
        ? { ...entry, title: "Kept", url: "https://example.org/kept" }
        : entry,
    );
    const { command, discards, sendCommand } = connect();
    discards(resting.targetId);

    const targets = await command("Target.getTargets");
    expect(targets.result?.targetInfos).toMatchObject([
      {
        targetId: resting.tabId,
        title: "Kept",
        url: "https://example.org/kept",
      },
    ]);

    const attached = await command("Target.attachToTarget", {
      flatten: true,
      targetId: resting.tabId,
    });
    expect(attached.result?.sessionId).toBeDefined();
    expect(asked.map((action) => action.kind)).not.toContain("restore");

    await command(
      "Runtime.evaluate",
      { expression: "1" },
      attached.result?.sessionId as string,
    );
    expect(asked.map((action) => action.kind)).toContain("restore");
    expect(sendCommand).toHaveBeenCalledWith(
      resting.targetId,
      "Runtime.evaluate",
      { expression: "1" },
    );
  });

  it("asks the window again for a discarded page it did not bring back, once for commands that arrive together", async () => {
    const resting = tab();
    const { command, discards, sendCommand } = connect();
    discards(resting.targetId);
    const attached = await command("Target.attachToTarget", {
      flatten: true,
      targetId: resting.tabId,
    });
    const session = attached.result?.sessionId as string;
    const restores = () =>
      asked.filter((action) => action.kind === "restore").length;

    restoreUnanswered = true;
    const refused = await Promise.all([
      command("Runtime.evaluate", { expression: "1" }, session),
      command("Runtime.evaluate", { expression: "2" }, session),
    ]);
    expect(refused.map((frame) => frame.error?.message)).toEqual([
      `Tab ${resting.tabId} is closed; there is no page to act on.`,
      `Tab ${resting.tabId} is closed; there is no page to act on.`,
    ]);
    expect(restores()).toBe(1);

    restoreUnanswered = false;
    const driven = await command(
      "Runtime.evaluate",
      { expression: "3" },
      session,
    );
    expect(driven.error).toBeUndefined();
    expect(restores()).toBe(2);
    expect(sendCommand).toHaveBeenCalledWith(
      resting.targetId,
      "Runtime.evaluate",
      { expression: "3" },
    );
  });

  it("closes a tab an agent opened, in the window", async () => {
    tab();
    const own = tab({ opened: true });
    const { command, events } = connect();
    await command("Target.setDiscoverTargets", { discover: true });

    await command("Target.closeTarget", { targetId: own.tabId });

    expect(asked).toEqual([{ kind: "close", tabId: own.tabId }]);
    expect(record.openedTabs).toEqual([]);
    expect(events("Target.targetDestroyed")).toEqual([{ targetId: own.tabId }]);
  });

  it("only lets go of a tab of the user's", async () => {
    const theirs = tab();
    const { command } = connect();

    const closed = await command("Target.closeTarget", {
      targetId: theirs.tabId,
    });

    expect(closed.result).toEqual({ success: true });
    expect(asked).toEqual([]);
    expect(windowList.map((entry) => entry.id)).toContain(theirs.tabId);
  });

  it("closes the only tab the agent has when the wrapper asks, and tells the agent it is gone", async () => {
    const own = tab({ opened: true });
    const { command, events } = connect();
    await command("Target.getTargets");

    expect(
      await closeChatTab({ chatId: TASK_ID, sessionId: SESSION_ID }, own.tabId),
    ).toBe(true);

    expect(asked).toEqual([{ kind: "close", tabId: own.tabId }]);
    expect(windowList).toEqual([]);
    expect(record.openedTabs).toEqual([]);
    expect(events("Target.targetDestroyed")).toEqual([{ targetId: own.tabId }]);
    // The note a finished task leaves names the tabs it drove.
    expect(tabsActedInBy(SESSION_ID)).not.toContain(own.targetId);
  });

  it("leaves a tab of the user's as it is when the wrapper asks to close it", async () => {
    const theirs = tab();
    const { command, events } = connect();
    await command("Target.getTargets");

    expect(
      await closeChatTab(
        { chatId: TASK_ID, sessionId: SESSION_ID },
        theirs.tabId,
      ),
    ).toBe(false);

    expect(asked).toEqual([]);
    expect(events("Target.targetDestroyed")).toEqual([]);
    expect(windowList.map((entry) => entry.id)).toEqual([theirs.tabId]);
  });

  it("closes nothing for the wrapper once the session's connection is gone", async () => {
    const own = tab({ opened: true });
    const sessionId = StoreId.newSessionId();
    connect(sessionId).disconnect();

    expect(await closeChatTab({ chatId: TASK_ID, sessionId }, own.tabId)).toBe(
      false,
    );
    expect(asked).toEqual([]);
  });

  it.each(
    cdpMethodsHandled("task", "override").filter((method) =>
      method.startsWith("Target."),
    ),
  )("answers %s itself, as the table of CDP methods says", async (method) => {
    const held = tab();
    const { command, sendCommand } = connect();
    // The ones that name a tab name one of the chat's.
    const reply = await command(method, { targetId: held.tabId });
    expect(reply.error).toBeUndefined();
    expect(sendCommand).not.toHaveBeenCalledWith(
      expect.anything(),
      method,
      expect.anything(),
    );
  });

  it.each(cdpMethodsHandled("task", "refuse"))(
    "refuses %s, as the table of CDP methods says",
    async (method) => {
      tab();
      const { command } = connect();
      expect((await command(method)).error).toBeDefined();
    },
  );

  it.each([
    "Target.attachToBrowserTarget",
    "Target.exposeDevToolsProtocol",
    "Target.sendMessageToTarget",
  ])(
    "refuses %s, a target command the table does not list, on a tab's session too",
    async (method) => {
      const only = tab();
      const { command, sendCommand } = connect();
      const attached = await command("Target.attachToTarget", {
        flatten: true,
        targetId: only.tabId,
      });
      sendCommand.mockClear();

      const browserLevel = await command(method);
      const onSession = await command(
        method,
        {},
        attached.result?.sessionId as string,
      );

      expect([browserLevel.error?.message, onSession.error?.message]).toEqual([
        "Method not found",
        "Method not found",
      ]);
      expect(sendCommand).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["Page.navigate", { url: "file:///Users/me/other/secret.html" }],
    ["Runtime.evaluate", { expression: "document.body.innerText" }],
  ])(
    "refuses %s sent with no session, which would skip the tab's file gate",
    async (method, params) => {
      tab();
      const { command, sendCommand } = connect();

      const reply = await command(method, params);

      expect(reply.error?.message).toBe("Method not found");
      expect(sendCommand).not.toHaveBeenCalled();
    },
  );

  it("never brings a page forward in the window", async () => {
    const only = tab();
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
      only.targetId,
      "Page.bringToFront",
      expect.anything(),
    );
  });

  it("tells the agent when the user closes one of the chat's tabs", async () => {
    const closing = tab();
    tab();
    const { closeByUser, command, events } = connect();
    await command("Target.setDiscoverTargets", { discover: true });
    await command("Target.attachToTarget", {
      flatten: true,
      targetId: closing.tabId,
    });

    closeByUser(closing.targetId);

    expect(events("Target.detachedFromTarget")).toEqual([
      { sessionId: `session-${closing.tabId}`, targetId: closing.tabId },
    ]);
    expect(events("Target.targetDestroyed")).toEqual([
      { targetId: closing.tabId },
    ]);
  });

  it("tells the agent where a tab it drove has gone, and names it", async () => {
    const driven = tab();
    const { command, events, navigates } = connect();
    await command("Target.setDiscoverTargets", { discover: true });
    await command("Target.attachToTarget", {
      flatten: true,
      targetId: driven.tabId,
    });

    await navigates(driven.targetId, {
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

  it("tells the agent a tab whose page another window took is back, to attach to again", async () => {
    const moving = tab();
    const { command, events, movesWindow } = connect();
    await command("Target.setDiscoverTargets", { discover: true });
    await command("Target.attachToTarget", {
      flatten: true,
      targetId: moving.tabId,
    });

    await movesWindow(moving.targetId);

    expect(events("Target.detachedFromTarget")).toEqual([
      { sessionId: `session-${moving.tabId}`, targetId: moving.tabId },
    ]);
    expect(
      events("Target.targetCreated").map(
        (params) =>
          (params as { targetInfo: { targetId: string } }).targetInfo.targetId,
      ),
    ).toEqual([moving.tabId, moving.tabId]);
    const reply = await command("Target.attachToTarget", {
      flatten: true,
      targetId: moving.tabId,
    });
    expect(reply).toMatchObject({
      result: { sessionId: `session-${moving.tabId}` },
    });
  });

  it("announces a tab that came into the chat after it connected only when the wrapper asks", async () => {
    tab();
    const { command, events, opensInWindow } = connect();
    await command("Target.setDiscoverTargets", { discover: true });

    const later = browserTargetOf(StoreId.newTabId());
    opensInWindow(later);
    await flush();
    expect(created(events)).not.toContain(later);

    expect(
      await announceChatTab({ chatId: TASK_ID, sessionId: SESSION_ID }, later),
    ).toBe(true);
    expect(created(events)).toContain(later);
  });

  it("keeps who else acted in a tab for the session's next result", async () => {
    const shared = tab({ worked: false });
    noteTabCommand(
      shared.targetId,
      { chatId: TASK_ID, sessionId: SESSION_ID },
      Date.now() - 10_000,
    );
    takeTabNews(SESSION_ID);
    const other = connect(OTHER_SESSION);
    const mine = connect();
    const theirs = await other.command("Target.attachToTarget", {
      flatten: true,
      targetId: shared.tabId,
    });
    await other.command(
      "Runtime.evaluate",
      { expression: "document.title" },
      theirs.result?.sessionId as string,
    );
    const attached = await mine.command("Target.attachToTarget", {
      flatten: true,
      targetId: shared.tabId,
    });

    await mine.command(
      "Runtime.evaluate",
      { expression: "document.title" },
      attached.result?.sessionId as string,
    );

    expect(takeTabNews(SESSION_ID)).toMatchObject([
      { agents: [{ sessionId: OTHER_SESSION }], targetId: shared.targetId },
    ]);
  });
});

describe("a tab on an HTML file", () => {
  /** A tab on a file, by its own id, drawn by a page under another id, which the session worked in. */
  function fileTab() {
    const tabId = StoreId.newTabId();
    const targetId = browserTargetOf(StoreId.newTabId());
    windowList = [
      ...windowList,
      {
        id: tabId,
        kind: "page",
        targetId,
        title: "Report",
        url: "file:///tmp/tasks/read-the-pages/report.html",
      },
    ];
    noteTabCommand(targetId, { chatId: TASK_ID, sessionId: SESSION_ID });
    return { tabId, targetId };
  }
  const ids = (infos: unknown) =>
    (infos as { targetId: string }[]).map((info) => info.targetId);

  it("is named by the tab's id, and its commands reach the page that draws it", async () => {
    const file = fileTab();
    const { command, events, sendCommand } = connect();

    const targets = await command("Target.getTargets");
    const attached = await command("Target.attachToTarget", {
      flatten: true,
      targetId: file.tabId,
    });
    await command(
      "Runtime.evaluate",
      { expression: "document.title" },
      attached.result?.sessionId as string,
    );

    expect(ids(targets.result?.targetInfos)).toEqual([file.tabId]);
    expect(created(events)).toEqual([file.tabId]);
    expect(sendCommand).toHaveBeenCalledWith(
      file.targetId,
      "Runtime.evaluate",
      { expression: "document.title" },
    );
  });

  it("keeps its id as a page tab becomes the file's, with no tab gone or new", async () => {
    const page = tab();
    const { command, events } = connect();
    await command("Target.getTargets");
    await command("Target.attachToTarget", {
      flatten: true,
      targetId: page.tabId,
    });

    // `agent-browser open ./report.html`: the page tab becomes a tab on the
    // file, which agents name by the page tab's id and its page draws.
    windowList = windowList.map((entry) =>
      entry.id === page.tabId
        ? {
            ...entry,
            targetId: page.targetId,
            url: "file:///tmp/tasks/read-the-pages/report.html",
          }
        : entry,
    );
    const targets = await command("Target.getTargets");

    expect(ids(targets.result?.targetInfos)).toEqual([page.tabId]);
    expect(created(events)).toEqual([page.tabId]);
    expect(events("Target.targetDestroyed")).toEqual([]);
  });

  it("drives the new page that draws it once the tab walks to another file and back", async () => {
    const file = fileTab();
    const { closeByUser, command, events, sendCommand } = connect();
    await command("Target.getTargets");
    await command("Target.attachToTarget", {
      flatten: true,
      targetId: file.tabId,
    });

    // To a Markdown file, which no page draws, then back to an HTML one,
    // drawn by a page of its own.
    const next = browserTargetOf(StoreId.newTabId());
    closeByUser(file.targetId);
    windowList = windowList.map((entry) =>
      entry.id === file.tabId ? { ...entry, targetId: next } : entry,
    );
    await command("Target.getTargets");
    const attached = await command("Target.attachToTarget", {
      flatten: true,
      targetId: file.tabId,
    });
    await command(
      "Runtime.evaluate",
      { expression: "document.title" },
      attached.result?.sessionId as string,
    );

    expect(sendCommand).toHaveBeenCalledWith(next, "Runtime.evaluate", {
      expression: "document.title",
    });
    // The agent hears its page went and came back, under the one id.
    expect(created(events)).toEqual([file.tabId, file.tabId]);
  });
});

describe("what counts as a session's work in a page", () => {
  it.each([
    ["Page.navigate", { url: "https://example.com/" }, true],
    ["Input.dispatchMouseEvent", { type: "mousePressed" }, true],
    ["Runtime.evaluate", { expression: "document.title" }, true],
    ["Accessibility.getFullAXTree", {}, true],
    ["DOM.getDocument", {}, true],
    ["Page.captureScreenshot", {}, true],
    ["Runtime.evaluate", { expression: "1", returnByValue: true }, false],
    ["Page.enable", {}, false],
    ["DOM.enable", {}, false],
    ["Runtime.runIfWaitingForDebugger", {}, false],
    ["Target.setAutoAttach", { autoAttach: true }, false],
    ["Emulation.setFocusEmulationEnabled", { enabled: true }, false],
  ])("%s %j: %s", (method, params, work) => {
    expect(isPageWork(method, params)).toBe(work);
  });

  it("tells nobody of a session that only connected to a tab and checked it answers", async () => {
    const shared = tab({ worked: false });
    const reader = StoreId.newSessionId();
    noteTabCommand(
      shared.targetId,
      { chatId: TASK_ID, sessionId: reader },
      Date.now() - 10_000,
    );
    takeTabNews(reader);
    const { command } = connect(StoreId.newSessionId());
    const attached = await command("Target.attachToTarget", {
      flatten: true,
      targetId: shared.tabId,
    });
    const session = attached.result?.sessionId as string;
    await command("Page.enable", {}, session);
    await command("Runtime.evaluate", { expression: "1" }, session);
    noteTabCommand(shared.targetId, { chatId: TASK_ID, sessionId: reader });

    expect(takeTabNews(reader)).toEqual([]);
  });
});

describe("a session's start tab", () => {
  /** A session new to the chat, connected, with the tab it was given to start in. */
  async function started() {
    const theirs = tab({ worked: false });
    const sessionId = StoreId.newSessionId();
    const connection = connect(sessionId);
    const targets = await connection.command("Target.getTargets");
    const [start] = (targets.result?.targetInfos as { targetId: string }[])
      .map((info) => info.targetId)
      .filter((id) => id !== theirs.tabId);
    asked.length = 0;
    return { ...connection, sessionId, start: start ?? "", theirs };
  }

  it("closes when the session opens a tab of its own before going anywhere, having never had a tab", async () => {
    const { closedPages, command, events, start } = await started();

    const made = await command("Target.createTarget", {
      url: "https://example.org/",
    });

    expect(made.result?.targetId).not.toBe(start);
    expect(closedPages).toEqual([start]);
    expect(asked.map((action) => action.kind)).toEqual(["open"]);
    expect(events("Target.targetDestroyed")).toContainEqual({
      targetId: start,
    });
    expect(record.openedTabs.map((opened) => opened.id)).not.toContain(start);
  });

  it("closes when the session goes to work in another tab", async () => {
    const { closedPages, command, start, theirs } = await started();
    const attached = await command("Target.attachToTarget", {
      flatten: true,
      targetId: theirs.tabId,
    });

    await command(
      "Accessibility.getFullAXTree",
      {},
      attached.result?.sessionId as string,
    );

    expect(closedPages).toEqual([start]);
    expect(asked).toEqual([]);
  });

  it("gets its tab in the chat once the session sends it somewhere, and stays", async () => {
    const { closedPages, command, disconnects, navigates, start } =
      await started();
    const startTarget = browserTargetOf(StoreId.TabSchema.parse(start));

    await navigates(startTarget, { title: "Shop", url: "https://shop/" });
    await command("Target.createTarget", { url: "https://example.org/" });
    await disconnects();

    expect(asked).toContainEqual({
      kind: "adopt",
      tabId: start,
      url: "https://shop/",
    });
    expect(record.openedTabs.map((opened) => opened.id)).toContain(start);
    expect(closedPages).toEqual([]);
  });

  it("closes with the connection while it never went anywhere", async () => {
    const { closedPages, disconnects, start } = await started();

    await disconnects();

    expect(closedPages).toEqual([start]);
    expect(asked).toEqual([]);
  });
});

describe("a session whose only tab was closed", () => {
  /** A session connected with one tab an agent opened, closed for it since. */
  async function emptied() {
    const own = tab({ opened: true });
    const connection = connect();
    await connection.command("Target.getTargets");
    await closeChatTab({ chatId: TASK_ID, sessionId: SESSION_ID }, own.tabId);
    asked.length = 0;
    // agent-browser makes itself a page before its next command.
    const made = await connection.command("Target.createTarget", {
      url: "about:blank",
    });
    return { ...connection, blank: made.result?.targetId as string };
  }

  it("carries on in a blank page with no tab, as one new to the chat starts in", async () => {
    const { blank } = await emptied();

    expect(blank).toBeTruthy();
    expect(asked).toEqual([]);
    expect(windowList).toEqual([]);
  });

  it("has that blank page closed once it opens a tab of its own", async () => {
    const { blank, closedPages, command } = await emptied();

    const made = await command("Target.createTarget", {
      url: "https://example.org/",
    });

    expect(closedPages).toContain(blank);
    expect(windowList.map((entry) => entry.id)).toEqual([
      made.result?.targetId,
    ]);
  });

  it("keeps that tab once it has sent it somewhere", async () => {
    const { blank, command, navigates } = await emptied();
    await navigates(browserTargetOf(StoreId.TabSchema.parse(blank)), {
      title: "Shop",
      url: "https://shop/",
    });

    await command("Target.createTarget", { url: "https://example.org/" });

    expect(asked).not.toContainEqual({ kind: "close", tabId: blank });
  });
});

describe("a session reconnecting", () => {
  const firstTarget = async (sessionId: StoreId.Session) => {
    const targets = await connect(sessionId).command("Target.getTargets");
    return (targets.result?.targetInfos as { targetId: string }[])[0]?.targetId;
  };

  it("starts in the tab it worked in last", async () => {
    const sessionId = StoreId.newSessionId();
    tab({ worked: false });
    const mine = tab({ worked: false });
    noteTabCommand(mine.targetId, { chatId: TASK_ID, sessionId }, 1);

    expect(await firstTarget(sessionId)).toBe(mine.tabId);
    expect(asked).toEqual([]);
  });

  it("starts in a blank tab once another session has worked in its last tab since", async () => {
    const sessionId = StoreId.newSessionId();
    const mine = tab({ worked: false });
    noteTabCommand(mine.targetId, { chatId: TASK_ID, sessionId }, 1);
    noteTabCommand(
      mine.targetId,
      { chatId: TASK_ID, sessionId: StoreId.newSessionId() },
      2,
    );

    const first = await firstTarget(sessionId);

    expect(first).not.toBe(mine.tabId);
    expect(asked).toEqual([]);
  });
});
