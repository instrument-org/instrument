/**
 * Every CDP command that reaches a tab of the in-app browser, and who does
 * what with it on the way.
 *
 * agent-browser speaks CDP to a browser it believes it launched. What it
 * reaches is two layers: the workspace's CDP bridge (`cdp-task-bridge.ts`,
 * over the tabs a task holds, each driven through a session from
 * `cdp-bridge.ts`), then the main process (`dispatch-command.ts` in Studio),
 * which sends the rest to the guest's own debugger. A guest's
 * debugger is not a browser's: it has no `Browser` domain, no target tree of
 * its own, and some commands reach the app window that embeds it (a
 * `Page.reload` once reloaded the whole window). So each side answers some
 * commands itself, and this table is the one place that says which.
 *
 * The bridge has two sides: `task` is the task's endpoint, which answers the
 * `Target` domain over the tabs the task holds on whatever session it
 * arrives, and `session` is one tab's session, which every other command
 * attached to a tab goes through. The task endpoint does what a session
 * does unless its own entry says otherwise.
 *
 * - `passthrough`: sent to the guest's debugger as it came.
 * - `wrapped`: sent to the debugger, with work around it (a gate, a held
 *   answer, a longer budget, a measurement checked).
 * - `override`: answered without the debugger seeing it.
 * - `refuse`: answered with an error.
 *
 * A side left out passes the command through. The commands are the ones
 * agent-browser {@link CDP_METHODS_READ_FROM} sends (read from its source,
 * since its inspect proxy aside it builds no method name at run time), plus
 * the ones the bridge sends on its own (`sender: "bridge"`). Main warns once
 * for any command that reaches it and is not here. A `Target.*` command that
 * is not here never reaches main: the task endpoint refuses it, since it
 * could name a target other than the agent's tabs (see
 * docs/decisions/2026-10-07-cdp-bridge-refuses-unlisted-target-commands.md).
 */
export type CdpHandling = "override" | "passthrough" | "refuse" | "wrapped";

export interface CdpMethodRule {
  /** What the main process does with it. */
  main?: CdpHandling;
  /** Who sends it, when agent-browser does not: the bridge itself, or nobody now. */
  sender?: "bridge" | "none";
  /** What a tab's session in the bridge does with it. */
  session?: CdpHandling;
  /** What the bridge's task endpoint does with it, when not what a session does. */
  task?: CdpHandling;
  /** Why a side does not simply pass it through. */
  why?: string;
}

/** The agent-browser release whose commands this table was read from. */
export const CDP_METHODS_READ_FROM = "0.38.1";

const TARGET_TREE =
  "the guest's debugger would answer with every Electron target (the app window, DevTools), so the bridge answers with the tabs the task holds";

export const CDP_METHODS = {
  "Accessibility.enable": {},
  "Accessibility.getFullAXTree": {},
  "Browser.close": {},
  "Browser.getVersion": {},
  "Browser.getWindowForTarget": {
    main: "override",
    why: "a guest's debugger has no Browser domain; main reports the size the guest is laid out at",
  },
  "Browser.grantPermissions": {},
  "Browser.setContentsSize": {
    main: "override",
    why: "would resize the app window; answered with nothing done",
  },
  "Browser.setDownloadBehavior": {
    main: "override",
    task: "wrapped",
    why: "every guest shares one session, so main records the folder on the tab's entry for the session's one download listener; the task endpoint remembers it and sends it to every tab it holds",
  },
  "Debugger.disable": {
    sender: "bridge",
    why: "sent when a connection closes, so a pause the agent set up does not hold the person's page",
  },
  "Debugger.resume": {
    sender: "bridge",
    why: "sent when a pause lands on a page the agent may not see",
  },
  "DOM.describeNode": {},
  "DOM.enable": {},
  "DOM.getBoxModel": {
    main: "wrapped",
    why: "the measurement is kept, so the press that follows can be refused if the element moved",
  },
  "DOM.getDocument": {},
  "DOM.getFrameOwner": {},
  "DOM.querySelectorAll": {},
  "DOM.resolveNode": {},
  "DOM.scrollIntoViewIfNeeded": {
    main: "wrapped",
    why: "answered once the element's box holds still, since pages reflow a frame or two after a scroll",
  },
  "DOM.setFileInputFiles": {},
  "Emulation.clearDeviceMetricsOverride": {
    main: "override",
    sender: "none",
    why: "agent-browser no longer sends it; main would clear the size an agent asked for, since the guest was resized rather than emulated",
  },
  "Emulation.setCPUThrottlingRate": {
    sender: "bridge",
    why: "sent when a connection closes, to put the page back",
  },
  "Emulation.setDeviceMetricsOverride": {
    main: "override",
    why: "a real override corrupted the guest's raster; main resizes the guest element instead (in-app-browser-device-emulation)",
  },
  "Emulation.setEmulatedMedia": {
    why: "also sent by the bridge when a connection closes, to put the page back",
  },
  "Emulation.setGeolocationOverride": {},
  "Emulation.setLocaleOverride": {},
  "Emulation.setScriptExecutionDisabled": {
    sender: "bridge",
    why: "sent when a connection closes, to put the page back",
  },
  "Emulation.setTimezoneOverride": {},
  "Emulation.setUserAgentOverride": {},
  "Fetch.continueRequest": {
    why: "also sent by the bridge to release a request paused on a page the agent may not see",
  },
  "Fetch.continueWithAuth": {},
  "Fetch.disable": {
    why: "also sent by the bridge when a connection closes",
  },
  "Fetch.enable": {},
  "Fetch.failRequest": {},
  "Fetch.fulfillRequest": {},
  "Input.dispatchKeyEvent": {
    main: "wrapped",
    why: "refused unless the page renders and holds keyboard focus, which main reclaims first; the window is made to draw meanwhile",
  },
  "Input.dispatchMouseEvent": {
    main: "wrapped",
    why: "refused unless the page renders, and a press whose element moved since it was measured is refused; the window is made to draw meanwhile",
  },
  "Input.dispatchTouchEvent": {
    main: "wrapped",
    why: "refused unless the page renders; the window is made to draw meanwhile",
  },
  "Input.insertText": {
    main: "wrapped",
    why: "refused unless the page renders and holds keyboard focus, which main reclaims first",
  },
  "IO.close": {},
  "IO.read": {},
  "Network.clearBrowserCookies": {},
  "Network.continueInterceptedRequest": {
    sender: "bridge",
    why: "sent to release a request intercepted on a page the agent may not see",
  },
  "Network.emulateNetworkConditions": {
    why: "also sent by the bridge when a connection closes, to put the page back",
  },
  "Network.enable": {},
  "Network.getAllCookies": {},
  "Network.getCookies": {},
  "Network.getResponseBody": {},
  "Network.setBlockedURLs": {
    sender: "bridge",
    why: "sent when a connection closes, to put the page back",
  },
  "Network.setCacheDisabled": {
    sender: "bridge",
    why: "sent when a connection closes, to put the page back",
  },
  "Network.setCookies": {},
  "Network.setExtraHTTPHeaders": {
    why: "also sent by the bridge when a connection closes, to put the page back",
  },
  "Network.setRequestInterception": {
    sender: "bridge",
    why: "sent when a connection closes, so an interception does not hold the person's page",
  },
  "Page.addScriptToEvaluateOnNewDocument": {
    session: "wrapped",
    why: "recorded, and taken back when the connection closes, so nothing the agent left runs on the person's later loads in the tab",
  },
  "Page.bringToFront": {
    task: "override",
    why: "the task endpoint answers it with nothing done, so the agent never pulls the person's window to a tab",
  },
  "Page.captureScreenshot": {
    main: "override",
    why: "a viewport capture is served from the guest's surface (a covered window made to draw), a full-page one is refused with a pointer to PDF, and an element clip goes to the debugger",
  },
  "Page.createIsolatedWorld": {},
  "Page.enable": {},
  "Page.getFrameTree": {},
  "Page.getLayoutMetrics": {},
  "Page.handleJavaScriptDialog": {},
  "Page.navigate": {
    main: "wrapped",
    session: "wrapped",
    why: "the bridge refuses a file the agent's tools cannot read and holds the answer until the main frame loads; main gives it 20s, since Electron answers at commit",
  },
  "Page.printToPDF": {
    main: "override",
    why: "printed through the guest's own printToPDF",
  },
  "Page.reload": {
    main: "override",
    why: "the guest's debugger reloads the app window that embeds it, taking every tab with it; main reloads the guest itself",
  },
  "Page.removeScriptToEvaluateOnNewDocument": {},
  "Page.screencastFrameAck": {
    main: "override",
    why: "main drives the screencast itself, so there is nothing to acknowledge; the bridge does not count it as activity",
  },
  "Page.setBypassCSP": {
    session: "wrapped",
    sender: "none",
    why: "agent-browser never sends it, but a command through its inspect proxy can; switched back off when the connection closes",
  },
  "Page.setDocumentContent": {},
  "Page.startScreencast": {
    main: "override",
    why: "a guest's debugger has no screencast; main captures frames on an interval and sends them as Page.screencastFrame",
  },
  "Page.stopScreencast": {
    main: "override",
    why: "stops main's own capture interval",
  },
  "Runtime.addBinding": {
    session: "wrapped",
    why: "recorded, and taken back when the connection closes, so nothing the agent left runs on the person's later loads in the tab",
  },
  "Runtime.callFunctionOn": {
    main: "wrapped",
    why: "agent-browser's scroll-and-measure script is run again until two runs agree",
  },
  "Runtime.enable": {},
  "Runtime.evaluate": {
    main: "wrapped",
    why: "given 20s, since its promise runs the page's own code; the scroll-and-measure script is run again until two runs agree",
  },
  "Runtime.releaseObject": {},
  "Runtime.removeBinding": {
    sender: "bridge",
    why: "sent when a connection closes, for each binding it added",
  },
  "Runtime.runIfWaitingForDebugger": {},
  "Security.setIgnoreCertificateErrors": {
    session: "wrapped",
    why: "switched back on when the connection closes, so the person's later browsing in the tab is checked again",
  },
  "Target.activateTarget": {
    task: "override",
    why: `${TARGET_TREE}; which tab the agent works in changes nothing in the window`,
  },
  "Target.attachToTarget": {
    task: "override",
    why: `${TARGET_TREE}; a session is attached only to a tab this connection holds`,
  },
  "Target.closeTarget": {
    task: "override",
    why: `${TARGET_TREE}; the task endpoint closes a tab the task opened and lets go of a handed one`,
  },
  "Target.createBrowserContext": {
    task: "override",
    why: "Electron has no browser contexts; a synthetic id lets agent-browser's recording go on",
  },
  "Target.createTarget": {
    task: "override",
    why: `${TARGET_TREE}; the task endpoint asks the window for a background tab`,
  },
  "Target.detachFromTarget": {
    task: "refuse",
    why: "the task endpoint refuses a Target command it does not answer itself",
  },
  "Target.disposeBrowserContext": {
    task: "override",
    why: "Electron has no browser contexts",
  },
  "Target.getTargetInfo": {
    task: "refuse",
    why: "the task endpoint refuses a Target command it does not answer itself",
  },
  "Target.getTargets": {
    task: "override",
    why: TARGET_TREE,
  },
  "Target.setAutoAttach": {
    task: "override",
    why: "forwarded, it would announce the page's frames as sessions of their own, whose ids then misroute agent-browser's commands",
  },
  "Target.setDiscoverTargets": {
    task: "override",
    why: TARGET_TREE,
  },
  "Tracing.end": {},
  "Tracing.start": {},
  "WebMCP.cancelInvocation": {},
  "WebMCP.enable": {},
  "WebMCP.invokeTool": {},
} as const satisfies Record<string, CdpMethodRule>;

export type CdpMethod = keyof typeof CDP_METHODS;

const RULES: Readonly<Record<string, CdpMethodRule>> = CDP_METHODS;

/** Whether a command is one the table knows. */
export function isKnownCdpMethod(method: string): method is CdpMethod {
  return Object.hasOwn(CDP_METHODS, method);
}

/** What one side does with a command the table knows. */
export function cdpHandlingOf(
  method: CdpMethod,
  side: "main" | "session" | "task",
): CdpHandling {
  const rule = RULES[method] ?? {};
  return side === "task"
    ? (rule.task ?? rule.session ?? "passthrough")
    : (rule[side] ?? "passthrough");
}

/** The commands one side handles one way, in the table's order. */
export function cdpMethodsHandled(
  side: "main" | "session" | "task",
  handling: CdpHandling,
): CdpMethod[] {
  return Object.keys(RULES).filter(
    (method): method is CdpMethod =>
      isKnownCdpMethod(method) && cdpHandlingOf(method, side) === handling,
  );
}
