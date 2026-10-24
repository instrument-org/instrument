import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CDP_METHODS,
  cdpHandlingOf,
  isKnownCdpMethod,
} from "../../../lib/cdp-methods";
import { getWorkspaceConfig } from "../../../lib/workspace-config";
import { workspaceLayout } from "../../../lib/workspace-layout";
import { buildWorkspaceFsLayout } from "../../../lib/workspace-fs-layout";
import { ChatDirSchema, WorkDirSchema } from "../../../schemas/paths";
import { ChatIdSchema } from "../../../schemas/chat-id";
import { BrowserTargetIdSchema, type WorkspaceConfig } from "../../../types";
import { type WorkspaceServerParentRef } from "../types";
import {
  createLocalFileGate,
  createMainFrameLoadGate,
  openTargetSession,
  parseCdpMessage,
} from "./cdp-bridge";

/** The chat's work folder, spelled as an absolute path is on this platform. */
const TASK = path.resolve("/Users/me/Tasks/t1");

/** A file's address as the guest shows it: `file:///C:/...` on Windows. */
const fileUrl = (hostPath: string) => pathToFileURL(hostPath).href;

/** The folders of the chat whose agent drives the page. */
const chatLayout = () =>
  Promise.resolve(
    buildWorkspaceFsLayout({ chatHostRoot: WorkDirSchema.parse(TASK) }),
  );

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

describe("parseCdpMessage", () => {
  it("takes a command with an id and a method, with or without a session", () => {
    expect(
      parseCdpMessage(
        Buffer.from(JSON.stringify({ id: 1, method: "Page.enable" })),
      ),
    ).toEqual({ id: 1, method: "Page.enable" });
  });

  it.each([
    ["not JSON", "{"],
    ["no id", JSON.stringify({ method: "Page.enable" })],
    ["no method", JSON.stringify({ id: 1 })],
    ["a method that is not a string", JSON.stringify({ id: 1, method: 7 })],
  ])("drops a frame with %s", (_label, frame) => {
    expect(parseCdpMessage(Buffer.from(frame))).toBeUndefined();
  });
});

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
  // The chat's record folder, in the workspace, which the rules keep hidden.
  const record = path.join(
    workspaceLayout(getWorkspaceConfig().rootDir).chatsDir,
    "t1",
  );
  const layout = buildWorkspaceFsLayout({
    chatHostRoot: WorkDirSchema.parse(TASK),
    recordHostRoot: ChatDirSchema.parse(record),
  });
  const own = fileUrl(path.join(TASK, "work", "page.html"));
  const outside = fileUrl(path.resolve("/Users/me/Desktop/private.html"));

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
    {
      expected: true,
      url: fileUrl(
        path.join(path.dirname(path.dirname(record)), "workspace.json"),
      ),
    },
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

describe("openTargetSession on a local page", () => {
  const own = fileUrl(path.join(TASK, "output", "confine.html"));
  const secret = fileUrl(path.resolve("/Users/me/other/secret.txt"));
  const targetId = BrowserTargetIdSchema.parse(
    "tab_00000000018888888888888888",
  );

  function connect(target = targetId) {
    const guest = { url: own as string | undefined };
    const sent: unknown[] = [];
    let scripts = 0;
    const events: {
      emit?: (method: string, params: unknown, frameSession?: string) => void;
    } = {};
    const sendCommand = vi.fn(
      (
        _target: unknown,
        method: string,
        params: unknown,
        _frameSession?: string,
      ) => {
        const expression = (params as { expression?: string }).expression ?? "";
        const assigned = /location\.href\s*=\s*'([^']+)'/.exec(expression);
        if (method === "Runtime.evaluate" && assigned) {
          // The worst case: a page navigation the main process let through.
          guest.url = assigned[1];
        }
        if (method === "Page.navigate") {
          guest.url = (params as { url: string }).url;
        }
        if (method === "Page.addScriptToEvaluateOnNewDocument") {
          return Promise.resolve({ identifier: `script-${String(++scripts)}` });
        }
        return Promise.resolve({ result: { value: "page text" } });
      },
    );
    const setAgentFileRoots = vi.fn();
    const config = {
      browser: {
        getTargetMeta: () => ({
          id: ChatIdSchema.parse("t1"),
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
          onEvent: (
            method: string,
            params: unknown,
            frameSession?: string,
          ) => void,
        ) => {
          events.emit = onEvent;
          return vi.fn();
        },
      },
      captureException: vi.fn(),
    } as unknown as WorkspaceConfig;
    const session = openTargetSession({
      onDetach: vi.fn(),
      readLayout: chatLayout,
      send: (frame) => sent.push(frame),
      sessionId: `session-${target}`,
      targetId: target,
      workspaceConfig: config,
      workspaceRef: { send: vi.fn() } as unknown as WorkspaceServerParentRef,
    });
    let nextId = 0;
    const command = async (
      method: string,
      params: unknown = {},
      sessionId?: string,
    ) => {
      const id = ++nextId;
      session.run({ id, method, params, ...(sessionId ? { sessionId } : {}) });
      for (let i = 0; i < 20; i++) {
        await flush();
      }
      return sent.find((frame) => (frame as { id?: number }).id === id) as {
        error?: { message: string };
        result?: unknown;
      };
    };
    return {
      close: session.end,
      command,
      emit: (m: string, p: unknown, frameSession?: string) => {
        events.emit?.(m, p, frameSession);
      },
      guest,
      owns: session.owns,
      sendCommand,
      sent,
      setAgentFileRoots,
    };
  }

  // The task endpoint answers the Target domain before a session sees it.
  it.each(
    Object.keys(CDP_METHODS)
      .filter(isKnownCdpMethod)
      .filter((method) => !method.startsWith("Target.")),
  )("handles %s as the table of CDP methods says", async (method) => {
    const { command, sendCommand } = connect();
    const reply = await command(method);
    const forwarded = sendCommand.mock.calls.some(
      ([, sent]) => sent === method,
    );
    const handling = cdpHandlingOf(method, "session");
    expect({ error: reply.error !== undefined, forwarded }).toEqual({
      error: handling === "refuse",
      forwarded: handling === "passthrough" || handling === "wrapped",
    });
  });

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

  it("lets the agent leave", async () => {
    const { command, guest } = connect();
    await command("Page.enable");
    guest.url = secret;
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
      "tab_0000000001888888888888888A",
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
    ` ${secret}`,
    `\t${secret}`,
    secret.replace("file:", "file\n:"),
    `\u0000${secret}`,
    secret.replace("file:", "FILE:"),
    `view-source:${secret}`,
    `view-source: ${secret}`,
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

  it("takes back the scripts, bindings, and switched-off checks the agent left when it leaves", async () => {
    const { close, command, sendCommand } = connect();
    await command("Page.addScriptToEvaluateOnNewDocument", { source: "a" });
    await command("Page.addScriptToEvaluateOnNewDocument", { source: "b" });
    await command("Page.removeScriptToEvaluateOnNewDocument", {
      identifier: "script-1",
    });
    await command("Runtime.addBinding", { name: "leak" });
    await command("Security.setIgnoreCertificateErrors", { ignore: true });
    sendCommand.mockClear();
    close();
    const undone = sendCommand.mock.calls
      .map(([, method, params]) => [method, params])
      .filter(([method]) =>
        /^(?:Page\.removeScript|Runtime\.removeBinding|Security\.|Page\.setBypassCSP)/.test(
          String(method),
        ),
      );
    expect(undone).toMatchInlineSnapshot(`
      [
        [
          "Page.removeScriptToEvaluateOnNewDocument",
          {
            "identifier": "script-2",
          },
        ],
        [
          "Runtime.removeBinding",
          {
            "name": "leak",
          },
        ],
        [
          "Security.setIgnoreCertificateErrors",
          {
            "ignore": false,
          },
        ],
      ]
    `);
  });

  it("puts back the place, time, language, and browser it emulated, and ends its trace, when it leaves", async () => {
    const { close, command, sendCommand } = connect();
    await command("Emulation.setGeolocationOverride", {
      latitude: 1,
      longitude: 2,
    });
    await command("Emulation.setTimezoneOverride", {
      timezoneId: "Asia/Tokyo",
    });
    await command("Emulation.setLocaleOverride", { locale: "ja-JP" });
    await command("Emulation.setUserAgentOverride", { userAgent: "bot" });
    await command("Tracing.start", {});
    sendCommand.mockClear();
    close();
    const undone = sendCommand.mock.calls
      .map(([, method, params]) => [method, params])
      .filter(([method]) =>
        /^(?:Emulation\.(?:clearGeolocation|setTimezone|setLocale|setUserAgent)|Tracing\.)/.test(
          String(method),
        ),
      );
    expect(undone).toMatchInlineSnapshot(`
      [
        [
          "Emulation.clearGeolocationOverride",
          {},
        ],
        [
          "Emulation.setTimezoneOverride",
          {
            "timezoneId": "",
          },
        ],
        [
          "Emulation.setLocaleOverride",
          {},
        ],
        [
          "Emulation.setUserAgentOverride",
          {
            "userAgent": "",
          },
        ],
        [
          "Tracing.end",
          {},
        ],
      ]
    `);
  });

  it("ends no trace the agent already ended", async () => {
    const { close, command, sendCommand } = connect();
    await command("Tracing.start", {});
    await command("Tracing.end", {});
    sendCommand.mockClear();
    close();
    expect(
      sendCommand.mock.calls.some(([, method]) => method === "Tracing.end"),
    ).toBe(false);
  });

  it("releases interception and forgets the agent's folders when its last connection closes", async () => {
    const target = BrowserTargetIdSchema.parse(
      "tab_00000000018888888888888889",
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

describe("openTargetSession with a frame in a process of its own", () => {
  const page = fileUrl(path.join(TASK, "output", "embeds.html"));
  const secret = fileUrl(path.resolve("/Users/me/other/secret.html"));
  const FRAME = "frame-session-1";
  let targets = 0;

  /** A connection to a page of its own, so no other test's connection shares it. */
  function connect() {
    const target = BrowserTargetIdSchema.parse(
      `tab_0000000001777777777777777${String(++targets)}`,
    );
    const guest = { url: page as string | undefined };
    const sent: { id?: number; method?: string; sessionId?: string }[] = [];
    const events: {
      emit?: (method: string, params: unknown, frameSession?: string) => void;
    } = {};
    const sendCommand = vi.fn(
      (
        _target: unknown,
        method: string,
        _params: unknown,
        _frameSession?: string,
      ) =>
        Promise.resolve(
          method === "Page.addScriptToEvaluateOnNewDocument"
            ? { identifier: "frame-script" }
            : {},
        ),
    );
    const config = {
      browser: {
        getTargetMeta: () => ({ partitionDir: "/tmp/profile" }),
        getTargetUrl: () => guest.url,
        sendCommand,
        setAgentFileRoots: vi.fn(),
        stopScreencast: vi.fn(),
        subscribeEvents: (
          _target: unknown,
          _onDetach: unknown,
          onEvent: (
            method: string,
            params: unknown,
            frameSession?: string,
          ) => void,
        ) => {
          events.emit = onEvent;
          return vi.fn();
        },
      },
      captureException: vi.fn(),
    } as unknown as WorkspaceConfig;
    const session = openTargetSession({
      onDetach: vi.fn(),
      readLayout: chatLayout,
      send: (frame) => sent.push(frame),
      sessionId: "page-session",
      targetId: target,
      workspaceConfig: config,
      workspaceRef: { send: vi.fn() } as unknown as WorkspaceServerParentRef,
    });
    let nextId = 0;
    const command = async (
      method: string,
      params: unknown = {},
      sessionId?: string,
    ) => {
      const id = ++nextId;
      session.run({ id, method, params, ...(sessionId ? { sessionId } : {}) });
      for (let i = 0; i < 20; i++) {
        await flush();
      }
      return sent.find((frame) => frame.id === id) as {
        error?: { message: string };
        result?: unknown;
      };
    };
    const emit = (method: string, params: unknown, frameSession?: string) => {
      events.emit?.(method, params, frameSession);
    };
    /** The page's frame attaching, as the guest reports it once auto-attach is on. */
    const attaches = (
      type: string,
      url: string,
      attached = FRAME,
      on?: string,
    ) => {
      emit(
        "Target.attachedToTarget",
        {
          sessionId: attached,
          targetInfo: {
            attached: true,
            canAccessOpener: false,
            targetId: `${attached}-target`,
            title: "",
            type,
            url,
          },
          waitingForDebugger: false,
        },
        on,
      );
    };
    const toAgent = (method: string) =>
      sent.filter((frame) => frame.method === method);
    return {
      attaches,
      close: session.end,
      command,
      emit,
      guest,
      owns: session.owns,
      sendCommand,
      target,
      toAgent,
    };
  }

  it("asks the guest for the page's frames alone, never paused at their start", async () => {
    const { command, sendCommand, target } = connect();

    const reply = await command(
      "Target.setAutoAttach",
      { autoAttach: true, flatten: true, waitForDebuggerOnStart: true },
      "page-session",
    );

    expect(reply.error).toBeUndefined();
    expect(sendCommand).toHaveBeenCalledWith(target, "Target.setAutoAttach", {
      autoAttach: true,
      filter: [{ type: "iframe" }, { exclude: true }],
      flatten: true,
      waitForDebuggerOnStart: false,
    });
  });

  it("announces a frame on the page's session and sends the frame's commands and events through it", async () => {
    const { attaches, command, emit, owns, sendCommand, target, toAgent } =
      connect();
    await command("Page.enable");
    attaches("iframe", "https://booking.example/widget");

    expect(toAgent("Target.attachedToTarget")).toEqual([
      expect.objectContaining({ sessionId: "page-session" }),
    ]);
    expect(owns(FRAME)).toBe(true);

    const reply = await command("Accessibility.getFullAXTree", {}, FRAME);
    emit("Runtime.consoleAPICalled", { args: [] }, FRAME);

    expect(reply.error).toBeUndefined();
    expect(sendCommand).toHaveBeenCalledWith(
      target,
      "Accessibility.getFullAXTree",
      {},
      FRAME,
    );
    expect(toAgent("Runtime.consoleAPICalled")).toEqual([
      expect.objectContaining({ sessionId: FRAME }),
    ]);
  });

  it("lets go of anything attached that is not a frame, and never tells the agent of it", async () => {
    const { attaches, command, owns, sendCommand, target, toAgent } = connect();
    await command("Page.enable");
    attaches("worker", "https://booking.example/worker.js", "worker-session");

    expect(sendCommand).toHaveBeenCalledWith(
      target,
      "Target.detachFromTarget",
      { sessionId: "worker-session" },
    );
    expect(toAgent("Target.attachedToTarget")).toEqual([]);
    expect(owns("worker-session")).toBe(false);
    expect(
      (await command("Runtime.evaluate", {}, "worker-session")).error?.message,
    ).toBe("No session worker-session");
  });

  it("closes a frame to the agent while its page shows a file it may not see", async () => {
    const { attaches, command, emit, guest, sendCommand, toAgent } = connect();
    await command("Page.enable");
    attaches("iframe", "https://booking.example/widget");
    sendCommand.mockClear();

    guest.url = secret;
    const read = await command("Runtime.evaluate", {}, FRAME);
    emit("Runtime.consoleAPICalled", { args: [] }, FRAME);

    expect(read.error?.message).toContain("outside the folders you can read");
    expect(sendCommand).not.toHaveBeenCalled();
    expect(toAgent("Runtime.consoleAPICalled")).toEqual([]);
  });

  it("closes a frame to the agent once it shows a file it may not see", async () => {
    const { attaches, command, emit, sendCommand, toAgent } = connect();
    await command("Page.enable");
    attaches("iframe", "https://booking.example/widget");
    emit(
      "Page.frameNavigated",
      { frame: { id: `${FRAME}-target`, parentId: "main", url: secret } },
      FRAME,
    );
    sendCommand.mockClear();

    const read = await command("Runtime.evaluate", {}, FRAME);
    emit("Fetch.requestPaused", { requestId: "r1" }, FRAME);

    expect(read.error?.message).toContain("This frame is showing a file");
    expect(toAgent("Fetch.requestPaused")).toEqual([]);
    expect(sendCommand.mock.calls).toEqual([
      [expect.anything(), "Fetch.continueRequest", { requestId: "r1" }, FRAME],
    ]);
  });

  it("tells the agent of no frame that attaches while the page is closed to it", async () => {
    const { attaches, command, guest, owns, toAgent } = connect();
    await command("Page.enable");
    guest.url = secret;

    attaches("iframe", "https://booking.example/widget");

    expect(toAgent("Target.attachedToTarget")).toEqual([]);
    expect(owns(FRAME)).toBe(false);
  });

  it("forgets a frame that detaches, and every frame inside it", async () => {
    const { attaches, command, emit, owns, toAgent } = connect();
    await command("Page.enable");
    attaches("iframe", "https://booking.example/widget");
    attaches("iframe", "https://pay.example/", "inner-session", FRAME);

    emit("Target.detachedFromTarget", { sessionId: FRAME });

    expect([owns(FRAME), owns("inner-session")]).toEqual([false, false]);
    expect(
      toAgent("Target.detachedFromTarget").map((frame) => frame.sessionId),
    ).toEqual([FRAME, "page-session"]);
  });

  it("puts back what the agent left on a frame, and stops attaching frames, when it leaves", async () => {
    const { attaches, close, command, sendCommand, target } = connect();
    await command("Page.enable");
    attaches("iframe", "https://booking.example/widget");
    await command(
      "Page.addScriptToEvaluateOnNewDocument",
      { source: "1" },
      FRAME,
    );
    sendCommand.mockClear();

    close();

    expect(sendCommand).toHaveBeenCalledWith(
      target,
      "Page.removeScriptToEvaluateOnNewDocument",
      { identifier: "frame-script" },
      FRAME,
    );
    expect(sendCommand).toHaveBeenCalledWith(
      target,
      "Fetch.disable",
      {},
      FRAME,
    );
    expect(sendCommand).toHaveBeenLastCalledWith(
      target,
      "Target.setAutoAttach",
      {
        autoAttach: false,
        filter: [{ type: "iframe" }, { exclude: true }],
        flatten: true,
        waitForDebuggerOnStart: false,
      },
    );
  });
});
