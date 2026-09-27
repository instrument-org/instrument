import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

import { buildWorkspaceFsLayout } from "../../../lib/workspace-fs-layout";
import { TaskDirSchema } from "../../../schemas/paths";
import { TaskIdSchema } from "../../../schemas/task-id";
import { BrowserTargetIdSchema, type WorkspaceConfig } from "../../../types";
import { type WorkspaceServerParentRef } from "../types";
import {
  createLocalFileGate,
  createMainFrameLoadGate,
  handleCdpClient,
} from "./cdp-bridge";

vi.mock("../../../lib/resolve-workspace-file-path", async () => {
  const { buildWorkspaceFsLayout: build } =
    await import("../../../lib/workspace-fs-layout");
  const { TaskDirSchema: TaskDir } = await import("../../../schemas/paths");
  return {
    taskFsLayout: () =>
      Promise.resolve(
        build({ taskHostRoot: TaskDir.parse("/Users/me/Tasks/t1") }),
      ),
  };
});

/** Drain pending microtasks. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

function frameNavigated(id: string, parentId?: string) {
  return {
    frame: {
      domainAndRegistry: "",
      id,
      loaderId: "loader",
      mimeType: "text/html",
      ...(parentId === undefined ? {} : { parentId }),
      secureContext: "Secure",
      securityOrigin: "https://example.com",
      url: "https://example.com/",
    },
    type: "Navigation",
  };
}

/** Attach a resolution flag to a held navigate. */
function track(p: Promise<void>): () => boolean {
  let done = false;
  void p.then(() => {
    done = true;
  });
  return () => done;
}

describe("createMainFrameLoadGate", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves when the main frame stops loading", async () => {
    const gate = createMainFrameLoadGate();
    gate.observe("Page.frameNavigated", frameNavigated("main"));
    const done = track(gate.nextMainFrameLoad(20_000).promise);
    await flush();
    expect(done()).toBe(false);

    gate.observe("Page.frameStoppedLoading", { frameId: "main" });
    await flush();
    expect(done()).toBe(true);
  });

  it("ignores an iframe stopping, including one still finishing the prior page", async () => {
    const gate = createMainFrameLoadGate();
    gate.observe("Page.frameNavigated", frameNavigated("main"));
    gate.observe("Page.frameNavigated", frameNavigated("ad", "main"));
    const done = track(gate.nextMainFrameLoad(20_000).promise);

    gate.observe("Page.frameStoppedLoading", { frameId: "ad" });
    await flush();
    expect(done()).toBe(false);

    gate.observe("Page.frameStoppedLoading", { frameId: "main" });
    await flush();
    expect(done()).toBe(true);
  });

  it("releases at the cap when the main frame never stops", async () => {
    vi.useFakeTimers();
    const gate = createMainFrameLoadGate();
    gate.observe("Page.frameNavigated", frameNavigated("main"));
    const done = track(gate.nextMainFrameLoad(20_000).promise);

    await vi.advanceTimersByTimeAsync(19_999);
    expect(done()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done()).toBe(true);
  });

  it("cancel releases at once and clears the cap timer", async () => {
    vi.useFakeTimers();
    const gate = createMainFrameLoadGate();
    gate.observe("Page.frameNavigated", frameNavigated("main"));
    const held = gate.nextMainFrameLoad(20_000);
    const done = track(held.promise);

    held.cancel();
    await flush();
    expect(done()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for the main frame's load after a fresh navigation resets it", async () => {
    const gate = createMainFrameLoadGate();
    gate.observe("Page.frameNavigated", frameNavigated("main"));
    const first = track(gate.nextMainFrameLoad(20_000).promise);
    gate.observe("Page.frameStoppedLoading", { frameId: "main" });
    await flush();
    expect(first()).toBe(true);

    const second = track(gate.nextMainFrameLoad(20_000).promise);
    await flush();
    expect(second()).toBe(false);
    gate.observe("Page.frameStoppedLoading", { frameId: "main" });
    await flush();
    expect(second()).toBe(true);
  });
});

describe("createLocalFileGate", () => {
  const layout = buildWorkspaceFsLayout({
    taskHostRoot: TaskDirSchema.parse("/Users/me/Tasks/t1"),
  });
  const own = "file:///Users/me/Tasks/t1/work/page.html";
  const outside = "file:///Users/me/Desktop/private.html";

  function gateAt(url: string | undefined, readLayout = true) {
    const at = { url };
    const onLayout = vi.fn();
    const gate = createLocalFileGate({
      currentUrl: () => at.url,
      onLayout,
      readLayout: readLayout ? () => Promise.resolve(layout) : undefined,
    });
    return { at, gate, onLayout };
  }

  it("is closed until the first read of the layout", async () => {
    const { gate } = gateAt("https://example.com/");
    expect(gate.isClosed()).toBe(true);
    await gate.load();
    expect(gate.isClosed()).toBe(false);
  });

  it.each([
    { expected: false, url: "https://example.com/" },
    { expected: false, url: own },
    { expected: false, url: `${own}?instrument-edit=n1` },
    { expected: true, url: outside },
    { expected: true, url: "file:///Users/me/Tasks/t1/.instrument/task.db" },
  ])("judges a tab at $url closed: $expected", async ({ expected, url }) => {
    const { gate } = gateAt(url);
    await gate.load();
    expect(gate.isClosed()).toBe(expected);
  });

  it("follows the guest's address, not an event it may never hear", async () => {
    const { at, gate } = gateAt(own);
    await gate.load();
    expect(gate.isClosed()).toBe(false);
    at.url = outside;
    expect(gate.isClosed()).toBe(true);
  });

  it("lets the agent open its own files and nothing else", async () => {
    const { gate } = gateAt(undefined);
    await gate.load();
    expect(await gate.mayOpen(own)).toBe(true);
    expect(await gate.mayOpen(outside)).toBe(false);
  });

  it("hands every read of the layout to the main process", async () => {
    const { gate, onLayout } = gateAt(undefined);
    await gate.load();
    await gate.mayOpen(own);
    expect(onLayout).toHaveBeenCalledTimes(2);
  });

  it("refuses every file to a tab no task owns", async () => {
    const { gate } = gateAt(own, false);
    await gate.load();
    expect(gate.isClosed()).toBe(true);
    expect(await gate.mayOpen(own)).toBe(false);
  });
});

describe("handleCdpClient on a local page", () => {
  const TASK = "/Users/me/Tasks/t1";
  const own = `file://${TASK}/output/confine.html`;
  const secret = "file:///Users/me/other/secret.txt";
  const targetId = BrowserTargetIdSchema.parse(
    "t1/ses_00000000018888888888888888",
  );

  function connect(target = targetId) {
    const guest = { url: own as string | undefined };
    const sent: unknown[] = [];
    const listeners: Record<string, (data: unknown) => void> = {};
    const events: { emit?: (method: string, params: unknown) => void } = {};
    const ws = {
      on: (event: string, cb: (data: unknown) => void) => {
        listeners[event] = cb;
      },
      readyState: WebSocket.OPEN,
      send: (data: string) => sent.push(JSON.parse(data)),
    };
    const sendCommand = vi.fn(
      (_target: unknown, method: string, params: unknown) => {
        const expression = (params as { expression?: string }).expression ?? "";
        const assigned = /location\.href\s*=\s*'([^']+)'/.exec(expression);
        if (method === "Runtime.evaluate" && assigned) {
          // The worst case: a page navigation the main process let through.
          guest.url = assigned[1];
        }
        if (method === "Page.navigate") {
          guest.url = (params as { url: string }).url;
        }
        return Promise.resolve({ result: { value: "page text" } });
      },
    );
    const setAgentFileRoots = vi.fn();
    const config = {
      browser: {
        getTargetMeta: () => ({
          id: TaskIdSchema.parse("t1"),
          partitionDir: "/tmp/profile",
          sessionId: "ses_00000000018888888888888888",
        }),
        getTargetUrl: () => guest.url,
        listTargets: () => Promise.resolve([]),
        sendCommand,
        setAgentFileRoots,
        stopScreencast: vi.fn(),
        subscribeEvents: (
          _target: unknown,
          _onDetach: unknown,
          onEvent: (method: string, params: unknown) => void,
        ) => {
          events.emit = onEvent;
          return vi.fn();
        },
      },
      captureException: vi.fn(),
    } as unknown as WorkspaceConfig;
    handleCdpClient(ws as unknown as WebSocket, target, config, {
      send: vi.fn(),
    } as unknown as WorkspaceServerParentRef);
    let nextId = 0;
    const command = async (method: string, params: unknown = {}) => {
      const id = ++nextId;
      listeners.message?.(Buffer.from(JSON.stringify({ id, method, params })));
      for (let i = 0; i < 20; i++) {
        await flush();
      }
      return sent.find((frame) => (frame as { id?: number }).id === id) as {
        error?: { message: string };
        result?: unknown;
      };
    };
    return {
      close: () => listeners.close?.(undefined),
      command,
      emit: (m: string, p: unknown) => {
        events.emit?.(m, p);
      },
      guest,
      sendCommand,
      sent,
      setAgentFileRoots,
    };
  }

  it("tells the main process which folders the agent can read", async () => {
    const { command, setAgentFileRoots } = connect();
    await command("Page.enable");
    expect(setAgentFileRoots).toHaveBeenCalledWith(
      targetId,
      expect.arrayContaining([TASK]),
    );
  });

  it("reads nothing once a page has taken the tab outside, with Page events off", async () => {
    const { command } = connect();
    const disabled = await command("Page.disable");
    expect(disabled.error).toBeUndefined();
    await command("Runtime.evaluate", {
      expression: `location.href='${secret}'`,
    });
    const read = await command("Runtime.evaluate", {
      expression: "document.body.innerText",
    });
    expect(read.error?.message).toContain("outside the folders you can read");
  });

  it("judges a command by where the guest is when it arrives", async () => {
    const { command, guest } = connect();
    await command("Page.enable");
    guest.url = secret;
    const read = await command("Runtime.evaluate", {
      expression: "document.title",
    });
    expect(read.error?.message).toContain("outside the folders you can read");
  });

  it("withholds the page's content events while the tab is outside", async () => {
    const { command, emit, guest, sent } = connect();
    await command("Page.enable");
    guest.url = secret;
    emit("Runtime.consoleAPICalled", { args: [{ value: "the secret" }] });
    expect(
      sent.some(
        (frame) =>
          (frame as { method?: string }).method === "Runtime.consoleAPICalled",
      ),
    ).toBe(false);
  });

  it.each([
    "Page.disable",
    "Runtime.disable",
    "Target.sendMessageToTarget",
    "Target.exposeDevToolsProtocol",
    "Target.getTargetInfo",
    "Page.captureScreenshot",
    "DOM.getDocument",
    "Fetch.enable",
    "Debugger.enable",
    "Page.getNavigationHistory",
    "Network.setRequestInterception",
    "Network.setBlockedURLs",
    "Emulation.setScriptExecutionDisabled",
    "Emulation.setCPUThrottlingRate",
    "Emulation.setDeviceMetricsOverride",
  ])("refuses %s while the tab is outside", async (method) => {
    const { command, guest, sendCommand } = connect();
    await command("Page.enable");
    guest.url = secret;
    sendCommand.mockClear();
    const reply = await command(method);
    expect(reply.error?.message).toContain("outside the folders you can read");
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("still answers the target commands it handles itself, and lets the agent leave", async () => {
    const { command, guest } = connect();
    await command("Page.enable");
    guest.url = secret;
    const targets = await command("Target.getTargets");
    expect(targets.error).toBeUndefined();
    const left = await command("Page.navigate", {
      url: "https://example.com/",
    });
    expect(left.error).toBeUndefined();
    const read = await command("Runtime.evaluate", { expression: "1" });
    expect(read.error).toBeUndefined();
  });

  it("refuses to open a file outside the agent's folders", async () => {
    const { command } = connect();
    const reply = await command("Page.navigate", { url: secret });
    expect(reply.error?.message).toContain("is not a file you can open");
  });

  it.each([
    ["Fetch.disable", {}],
    ["Fetch.continueRequest", { requestId: "r1" }],
    ["Debugger.resume", {}],
    ["Page.reload", {}],
  ])(
    "lets the agent undo a pause or reload while the tab is outside: %s",
    async (method, params) => {
      const { command, guest } = connect();
      await command("Page.enable");
      guest.url = secret;
      const reply = await command(method, params);
      expect(reply.error).toBeUndefined();
    },
  );

  it("lets a paused request of a hidden page go, without telling the agent about it", async () => {
    const { command, emit, guest, sendCommand, sent } = connect();
    await command("Page.enable");
    guest.url = secret;
    sendCommand.mockClear();
    emit("Fetch.requestPaused", { request: { url: secret }, requestId: "r7" });
    emit("Network.requestWillBeSent", { request: { url: secret } });
    expect(sendCommand).toHaveBeenCalledWith(
      expect.anything(),
      "Fetch.continueRequest",
      { requestId: "r7" },
    );
    const methods = sent.map((frame) => (frame as { method?: string }).method);
    expect(methods).not.toContain("Fetch.requestPaused");
    expect(methods).not.toContain("Network.requestWillBeSent");
  });

  it("holds back a request for a hidden file before the tab gets there", async () => {
    const { command, emit, sendCommand, sent } = connect();
    await command("Page.enable");
    sendCommand.mockClear();
    emit("Network.requestWillBeSent", {
      documentURL: secret,
      request: { url: secret },
    });
    emit("Fetch.requestPaused", { request: { url: secret }, requestId: "r9" });
    emit("Network.requestWillBeSent", { request: { url: own } });
    const urls = sent
      .filter((frame) => (frame as { method?: string }).method !== undefined)
      .map(
        (frame) =>
          (frame as { params: { request?: { url?: string } } }).params.request
            ?.url,
      );
    expect(urls).toEqual([own]);
    expect(sendCommand).toHaveBeenCalledWith(
      expect.anything(),
      "Fetch.continueRequest",
      { requestId: "r9" },
    );
  });

  it("lets a request held by the older interception go too", async () => {
    const { command, emit, guest, sendCommand } = connect();
    await command("Page.enable");
    guest.url = secret;
    sendCommand.mockClear();
    emit("Network.requestIntercepted", {
      interceptionId: "i3",
      request: { url: secret },
    });
    expect(sendCommand).toHaveBeenCalledWith(
      expect.anything(),
      "Network.continueInterceptedRequest",
      { interceptionId: "i3" },
    );
  });

  it("hands the main process no folders for a connection that closed before its layout arrived", async () => {
    const target = BrowserTargetIdSchema.parse(
      "t1/ses_0000000001888888888888888A",
    );
    const early = connect(target);
    early.close();
    for (let i = 0; i < 20; i++) {
      await flush();
    }
    expect(early.setAgentFileRoots).toHaveBeenCalledWith(target, null);
    expect(early.setAgentFileRoots).not.toHaveBeenCalledWith(
      target,
      expect.any(Array),
    );
  });

  it.each([
    " file:///Users/me/other/secret.txt",
    "\tfile:///Users/me/other/secret.txt",
    "file\n:///Users/me/other/secret.txt",
    "\u0000file:///Users/me/other/secret.txt",
    "FILE:///Users/me/other/secret.txt",
    "view-source:file:///Users/me/other/secret.txt",
    "view-source: file:///Users/me/other/secret.txt",
  ])("refuses to open %j", async (url) => {
    const { command } = connect();
    const reply = await command("Page.navigate", { url });
    expect(reply.error?.message).toContain("is not a file you can open");
  });

  it("holds back a page event about a hidden file, and passes the agent's own", async () => {
    const { command, emit, sent } = connect();
    await command("Page.enable");
    emit("Page.frameStartedNavigating", { url: secret });
    emit("Page.frameNavigated", { frame: { id: "f", url: secret } });
    emit("Page.frameNavigated", { frame: { id: "f", url: own } });
    const pageEvents = sent
      .filter((frame) =>
        (frame as { method?: string }).method?.startsWith("Page.frame"),
      )
      .map((frame) => JSON.stringify((frame as { params: unknown }).params));
    expect(pageEvents).toHaveLength(1);
    expect(pageEvents[0]).toContain("confine.html");
  });

  it("puts back what the agent changed about the page when it leaves", async () => {
    const { close, command, sendCommand } = connect();
    await command("Page.enable");
    close();
    const methods = sendCommand.mock.calls.map(([, method]) => method);
    expect(methods).toEqual(
      expect.arrayContaining([
        "Network.setBlockedURLs",
        "Emulation.setScriptExecutionDisabled",
        "Emulation.setCPUThrottlingRate",
        "Network.emulateNetworkConditions",
      ]),
    );
  });

  it("releases interception and forgets the agent's folders when its last connection closes", async () => {
    const target = BrowserTargetIdSchema.parse(
      "t1/ses_00000000018888888888888889",
    );
    const first = connect(target);
    const second = connect(target);
    await first.command("Page.enable");
    await second.command("Page.enable");
    first.close();
    expect(first.sendCommand).toHaveBeenCalledWith(target, "Fetch.disable", {});
    expect(first.sendCommand).toHaveBeenCalledWith(
      target,
      "Network.setRequestInterception",
      { patterns: [] },
    );
    expect(first.setAgentFileRoots).not.toHaveBeenCalledWith(target, null);
    second.close();
    expect(second.setAgentFileRoots).toHaveBeenCalledWith(target, null);
  });
});
