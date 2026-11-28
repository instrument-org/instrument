import { type PageDialog, type PageDialogAnswer } from "@/shared/browser";
import {
  PAGE_DIALOG_CHANNEL,
  PAGE_LEAVING_CHANNEL,
} from "@/shared/page-editor-channels";
import { isDrivenByWorkingAgent } from "@instrument-org/workspace/electron";
import { ipcMain, type WebContents } from "electron";
import { z } from "zod";

import { type BrowserEntry } from "./entry";
import { log } from "./log";
import { publisher } from "@/electron-main/rpc/publisher";

/**
 * The dialogs pages are waiting on, each with the reply its page is waiting
 * for, in the order they were asked. A dialog is answered once: by the
 * person in the tab, by the agent at work in it (`Page.handleJavaScriptDialog`),
 * or with Cancel when its guest goes.
 */
export function createPageDialogs(onChange: () => void) {
  const pending = new Map<
    string,
    {
      dialog: PageDialog;
      guestId: number;
      reply: (answer: PageDialogAnswer) => void;
    }
  >();
  let next = 0;

  return {
    /** Records a dialog and answers its id. */
    add(
      dialog: Omit<PageDialog, "id">,
      guestId: number,
      reply: (answer: PageDialogAnswer) => void,
    ): string {
      next += 1;
      const id = String(next);
      pending.set(id, { dialog: { ...dialog, id }, guestId, reply });
      onChange();
      return id;
    },
    /** Answers dialog `id`. False when it is no longer waiting. */
    answer(id: string, answer: PageDialogAnswer): boolean {
      const waiting = pending.get(id);
      if (!waiting) {
        return false;
      }
      pending.delete(id);
      onChange();
      waiting.reply(answer);
      return true;
    },
    /** Cancels everything guest `guestId` is waiting on. */
    dropGuest(guestId: number) {
      for (const [id, waiting] of pending) {
        if (waiting.guestId === guestId) {
          this.answer(id, { accept: false });
        }
      }
    },
    /** The dialogs waiting, oldest first, as the window draws them. */
    list(): PageDialog[] {
      return [...pending.values()].map(({ dialog }) => dialog);
    },
    /** The oldest dialog guest `guestId` is waiting on. */
    oldestOf(guestId: number): PageDialog | undefined {
      for (const waiting of pending.values()) {
        if (waiting.guestId === guestId) {
          return waiting.dialog;
        }
      }
      return undefined;
    },
  };
}

export type PageDialogs = ReturnType<typeof createPageDialogs>;

/** The dialogs the window's tabs' pages are waiting on, which the window draws. */
export const pageDialogs = createPageDialogs(() => {
  publisher.publish("browser.page-dialogs-changed", null);
});

/** Where a page last said it was going, and when, read when its `beforeunload` holds that up. */
interface Leaving {
  at: number;
  /** Whether the page said where it is going, which it may say of anywhere. */
  byPage?: true;
  kind: "push" | "reload" | "replace" | "traverse";
  steps: number;
  url: string;
}

/** How long a page's word on where it is going stays its answer to a held navigation. */
const LEAVING_FRESH_MS = 5000;

/** How long main waits for that word when a held navigation comes first. */
const LEAVING_WAIT_MS = 100;

/** A press of the person's in the page within this long makes a dialog theirs alone, whoever else is at work in the tab. */
const PERSON_ASKED_MS = 2000;

const leavingByGuest = new Map<number, Leaving>();

/** Guests whose next held navigation goes through: the person or the agent chose to leave. */
const leaveOnce = new Set<number>();

/**
 * Takes every page's `prompt` and its word on where it is going, once for
 * the app. `entryOf` finds the tab a guest is, and `personUsedAt` when the
 * person last pressed or typed in it.
 */
export function servePageDialogs({
  dialogs,
  entryOf,
  personUsedAt,
}: {
  dialogs: PageDialogs;
  entryOf: (guestId: number) => BrowserEntry | undefined;
  personUsedAt: (guestId: number) => number | undefined;
}) {
  ipcMain.on(
    PAGE_DIALOG_CHANNEL,
    (event, kind: unknown, message: unknown, defaultValue: unknown) => {
      const guest = event.sender;
      const entry = entryOf(guest.id);
      if (!entry || kind !== "prompt") {
        event.returnValue = null;
        return;
      }
      void ask({
        dialogs,
        dialog: {
          defaultValue: typeof defaultValue === "string" ? defaultValue : "",
          kind,
          message: typeof message === "string" ? message : "",
          site: siteOf(guest),
          targetId: entry.targetId,
        },
        entry,
        guest,
        personUsedAt: personUsedAt(guest.id),
      }).then((answer) => {
        event.returnValue = answer.accept ? (answer.text ?? "") : null;
      });
    },
  );
  ipcMain.on(
    PAGE_LEAVING_CHANNEL,
    (event, url: unknown, kind: unknown, steps: unknown) => {
      if (
        typeof url === "string" &&
        (kind === "push" ||
          kind === "reload" ||
          kind === "replace" ||
          kind === "traverse")
      ) {
        leavingByGuest.set(event.sender.id, {
          at: Date.now(),
          byPage: true,
          kind,
          steps: typeof steps === "number" ? steps : 0,
          url,
        });
      }
    },
  );
}

/** What Electron hands a `-run-dialog` listener for a dialog a page opened. */
interface RunDialog {
  defaultPromptText: string;
  dialogType: "alert" | "confirm" | "prompt";
  messageText: string;
}

/**
 * A page's `alert` and `confirm`, from any of its frames, asked in the tab.
 * Electron's own `-run-dialog` listener (an internal event its types leave
 * out) puts up a system sheet over the whole window, so this one takes its
 * place. Chromium waits on the reply, and once Electron cancels a guest's
 * dialogs (`-cancel-dialogs`, as its page goes) the reply is never sent.
 */
export function takePageDialogs(
  guest: WebContents,
  entry: BrowserEntry,
  {
    dialogs,
    personUsedAt,
  }: { dialogs: PageDialogs; personUsedAt: () => number | undefined },
) {
  const events: NodeJS.EventEmitter = guest;
  const waiting = new Set<string>();
  const canceled = new Set<string>();
  events.removeAllListeners("-run-dialog");
  events.on(
    "-run-dialog",
    (info: RunDialog, reply: (success: boolean, input: string) => void) => {
      let id: string | undefined;
      void ask({
        dialogs,
        dialog: {
          ...(info.dialogType === "prompt"
            ? { defaultValue: info.defaultPromptText }
            : {}),
          kind: info.dialogType,
          message: info.messageText,
          site: siteOf(guest),
          targetId: entry.targetId,
        },
        entry,
        guest,
        onAsked: (asked) => {
          id = asked;
          waiting.add(asked);
        },
        personUsedAt: personUsedAt(),
      }).then((answer) => {
        if (id !== undefined) {
          waiting.delete(id);
          if (canceled.delete(id)) {
            return;
          }
        }
        if (!guest.isDestroyed()) {
          reply(answer.accept, answer.accept ? (answer.text ?? "") : "");
        }
      });
    },
  );
  events.on("-cancel-dialogs", () => {
    for (const id of waiting) {
      canceled.add(id);
      dialogs.answer(id, { accept: false });
    }
  });
}

/**
 * A page's `beforeunload` holding a navigation up. Electron asks for a yes
 * or no on the spot and cancels the navigation on no answer, so the
 * navigation is let go and the question asked in the tab: leaving goes
 * where the page was going, the way it was going there. A guest the person
 * or the agent already chose to leave goes at once.
 */
export function guardPageLeaving(
  guest: WebContents,
  entry: BrowserEntry,
  {
    dialogs,
    mayPageGoTo,
    personUsedAt,
  }: {
    dialogs: PageDialogs;
    /**
     * Whether the page may take its tab to an address, as a link on it may
     * (`will-frame-navigate`), which a navigation main starts never asks.
     */
    mayPageGoTo: (url: string) => boolean;
    personUsedAt: () => number | undefined;
  },
) {
  const guestId = guest.id;
  rememberGoing(guest);
  /** Where a page's own word sends the tab, held to what a link on it may reach. */
  const mayGo = (going: Leaving | null) => {
    if (!going?.byPage || going.kind === "reload") {
      return true;
    }
    const history = guest.navigationHistory;
    const url =
      going.kind === "traverse" && going.steps !== 0
        ? history.getEntryAtIndex(history.getActiveIndex() + going.steps)?.url
        : going.url;
    return url !== undefined && mayPageGoTo(url);
  };
  guest.on("will-prevent-unload", (event) => {
    // A close asks in the tab itself (`askBeforeClosingPage`); left held, the
    // close is called off for the page to stay until the person answers.
    if (closingChecks.has(guestId)) {
      return;
    }
    const agentAt = agentLeaving.get(guestId);
    agentLeaving.delete(guestId);
    if (
      leaveOnce.delete(guestId) ||
      (agentAt !== undefined && Date.now() - agentAt < AGENT_LEAVING_MS)
    ) {
      event.preventDefault();
      return;
    }
    const askedAt = Date.now();
    setTimeout(() => {
      const waiting = dialogs.oldestOf(guestId)?.kind;
      if (guest.isDestroyed() || waiting === "leave" || waiting === "reload") {
        return;
      }
      const leaving = leavingByGuest.get(guestId);
      const going =
        leaving && askedAt - leaving.at < LEAVING_FRESH_MS ? leaving : null;
      void ask({
        dialogs,
        dialog: {
          kind: going?.kind === "reload" ? "reload" : "leave",
          message: "",
          site: siteOf(guest),
          targetId: entry.targetId,
        },
        entry,
        guest,
        personUsedAt: personUsedAt(),
      }).then(({ accept }) => {
        if (accept && !guest.isDestroyed()) {
          if (mayGo(going)) {
            leave(guest, going);
          } else {
            log.warn(
              `refused a page leaving for outside the agent's folders targetId=${entry.targetId}`,
            );
            publisher.publish("browser.navigation-refused", {
              targetId: entry.targetId,
            });
          }
        }
      });
    }, LEAVING_WAIT_MS);
  });
  guest.once("destroyed", () => {
    closingChecks.delete(guestId);
    leavingByGuest.delete(guestId);
    leaveOnce.delete(guestId);
    agentLeaving.delete(guestId);
    dialogs.dropGuest(guestId);
  });
}

/**
 * Has the guest's own navigations (the address field, Back and Forward,
 * Reload, whether the window's `<webview>` or main asks) say where they are
 * going, as a page's own do (`PAGE_LEAVING_CHANNEL`), since a navigation
 * the browser starts fires no `navigate` event in the page. Each is the
 * guest's own method, wrapped on this guest alone.
 */
function rememberGoing(guest: WebContents) {
  const going = (kind: Leaving["kind"], url: string, steps = 0) => {
    noteGoing(guest.id, { kind, steps, url });
  };
  const loadURL = guest.loadURL.bind(guest);
  const reload = guest.reload.bind(guest);
  const reloadIgnoringCache = guest.reloadIgnoringCache.bind(guest);
  guest.loadURL = (url, options) => {
    going("push", url);
    return loadURL(url, options);
  };
  guest.reload = () => {
    going("reload", guest.getURL());
    reload();
  };
  guest.reloadIgnoringCache = () => {
    going("reload", guest.getURL());
    reloadIgnoringCache();
  };
  const history = guest.navigationHistory;
  const goBack = history.goBack.bind(history);
  const goForward = history.goForward.bind(history);
  const goToIndex = history.goToIndex.bind(history);
  const goToOffset = history.goToOffset.bind(history);
  history.goBack = () => {
    going("traverse", "", -1);
    goBack();
  };
  history.goForward = () => {
    going("traverse", "", 1);
    goForward();
  };
  history.goToOffset = (offset) => {
    going("traverse", "", offset);
    goToOffset(offset);
  };
  history.goToIndex = (index) => {
    going("traverse", "", index - history.getActiveIndex());
    goToIndex(index);
  };
}

/** Guests whose `beforeunload` is being run for a close (`askBeforeClosingPage`). */
const closingChecks = new Set<number>();

/** How long a page's `beforeunload` may take to answer a close before the close goes ahead. */
const CLOSE_CHECK_MS = 3000;

/**
 * Whether closing the page could ask first, as Chromium's own check would:
 * a `beforeunload` handler on its window, in a page someone has used
 * (`navigator.userActivation.hasBeenActive`), since Chromium asks for no
 * other. Read through the guest's debugger, which the page cannot see. A
 * page that cannot be read asks nothing.
 */
export async function pageMayAskToLeave(guest: WebContents): Promise<boolean> {
  if (guest.isDestroyed() || !guest.debugger.isAttached()) {
    return false;
  }
  try {
    const { result } = PageWindowSchema.parse(
      await guest.debugger.sendCommand("Runtime.evaluate", {
        expression: "navigator.userActivation.hasBeenActive ? window : null",
      }),
    );
    if (!result.objectId) {
      return false;
    }
    try {
      if (await hasOnBeforeUnload(guest, result.objectId)) {
        return true;
      }
      const { listeners } = PageListenersSchema.parse(
        await guest.debugger.sendCommand("DOMDebugger.getEventListeners", {
          objectId: result.objectId,
        }),
      );
      return listeners.some(({ type }) => type === "beforeunload");
    } finally {
      void guest.debugger
        .sendCommand("Runtime.releaseObject", { objectId: result.objectId })
        .catch(() => {});
    }
  } catch (error) {
    log.info(`reading whether a page asks to leave failed: ${String(error)}`);
    return false;
  }
}

async function hasOnBeforeUnload(guest: WebContents, objectId: string) {
  const { result } = PageValueSchema.parse(
    await guest.debugger.sendCommand("Runtime.callFunctionOn", {
      functionDeclaration:
        "function () { return typeof this.onbeforeunload === 'function'; }",
      objectId,
      returnByValue: true,
    }),
  );
  return result.value === true;
}

const PageWindowSchema = z.object({
  result: z.object({ objectId: z.string().optional() }),
});
const PageValueSchema = z.object({ result: z.object({ value: z.unknown() }) });
const PageListenersSchema = z.object({
  listeners: z.array(z.object({ type: z.string() })),
});

/**
 * Runs a page's `beforeunload` for a close the person asked for and, when
 * the page asks, asks "Leave site?" in its tab, as Chromium does before it
 * closes a tab or a window. True to close. The close itself is left to the
 * caller: a guest's own close would go ahead whatever the page says, so it
 * is always called off here (`-before-unload-fired`, Electron's internal
 * word on the answer), and only the page's answer read from it.
 */
export function askBeforeClosingPage(
  guest: WebContents,
  entry: BrowserEntry,
  { dialogs }: { dialogs: PageDialogs },
): Promise<boolean> {
  const guestId = guest.id;
  if (guest.isDestroyed() || closingChecks.has(guestId)) {
    return Promise.resolve(true);
  }
  const events: NodeJS.EventEmitter = guest;
  const pageSaid = new Promise<boolean>((resolve) => {
    const settle = (proceed: boolean) => {
      clearTimeout(timer);
      events.off("-before-unload-fired", onFired);
      guest.off("destroyed", onGone);
      closingChecks.delete(guestId);
      resolve(proceed);
    };
    const onFired = (
      event: { preventDefault: () => void },
      proceed: boolean,
    ) => {
      event.preventDefault();
      settle(proceed);
    };
    const onGone = () => {
      settle(true);
    };
    const timer = setTimeout(() => {
      log.info(`a page's beforeunload did not answer a close guest=${guestId}`);
      settle(true);
    }, CLOSE_CHECK_MS);
    closingChecks.add(guestId);
    events.on("-before-unload-fired", onFired);
    guest.once("destroyed", onGone);
    guest.close({ waitForBeforeUnload: true });
  });
  return pageSaid.then(async (proceed) => {
    if (proceed || guest.isDestroyed()) {
      return true;
    }
    const { accept } = await ask({
      dialogs,
      dialog: {
        kind: "leave",
        message: "",
        site: siteOf(guest),
        targetId: entry.targetId,
      },
      entry,
      guest,
      // The person's close: theirs to answer, whoever else works in the tab.
      personUsedAt: Date.now(),
    });
    return accept;
  });
}

/** How long after an agent's `Page.navigate` or `Page.reload` a held navigation is taken as that one. */
const AGENT_LEAVING_MS = 2000;

/** When each guest's agent last asked to go somewhere itself, by guest. */
const agentLeaving = new Map<number, number>();

/**
 * An agent asked the guest to go somewhere (`Page.navigate`, `Page.reload`),
 * which a page's `beforeunload` does not hold up: the agent chose to leave,
 * as agent-browser's own answer to that question would, and the command it
 * sent ends with the page it asked for rather than an aborted load.
 */
export function noteAgentLeaving(guestId: number) {
  agentLeaving.set(guestId, Date.now());
}

/** Records where guest `guestId` is going, for the held navigation it starts to read. */
export function noteGoing(guestId: number, going: Omit<Leaving, "at">) {
  leavingByGuest.set(guestId, { ...going, at: Date.now() });
}

/** Goes where a page that was held up was going, past its `beforeunload` this once. */
function leave(guest: WebContents, going: Leaving | null) {
  leaveOnce.add(guest.id);
  if (!going) {
    // The page never said where: a reload is the one navigation that has
    // nowhere else to go.
    log.info(`leaving a page with no word on where guest=${guest.id}`);
    guest.reload();
    return;
  }
  if (going.kind === "reload") {
    guest.reload();
  } else if (going.kind === "traverse" && going.steps !== 0) {
    guest.navigationHistory.goToOffset(going.steps);
  } else {
    void guest.loadURL(going.url).catch((error: unknown) => {
      log.info(
        `leaving a page did not load guest=${guest.id} ${String(error)}`,
      );
    });
  }
}

/** The debugger's own word on a page's dialogs, which never reaches the agent: main tells it of each dialog it asks in the tab (`ask`). */
export function isDebuggerDialogEvent(method: string): boolean {
  return (
    method === "Page.javascriptDialogOpening" ||
    method === "Page.javascriptDialogClosed"
  );
}

/**
 * Puts a page's dialog over its tab and, while an agent is at work in the
 * tab and the person has not just used it, before the agent too, as the
 * browser's own dialog would be (`Page.javascriptDialogOpening`). Settles
 * with the first answer.
 */
async function ask({
  dialog,
  dialogs,
  entry,
  guest,
  onAsked,
  personUsedAt,
}: {
  dialog: Omit<PageDialog, "id">;
  dialogs: PageDialogs;
  entry: BrowserEntry;
  guest: WebContents;
  /** Told the dialog's id as it goes up. */
  onAsked?: (id: string) => void;
  personUsedAt: number | undefined;
}): Promise<PageDialogAnswer> {
  const byPerson =
    personUsedAt !== undefined && Date.now() - personUsedAt < PERSON_ASKED_MS;
  const toAgent =
    !byPerson &&
    (await isDrivenByWorkingAgent(entry.targetId).catch(() => false));
  return new Promise((resolve) => {
    const id = dialogs.add(dialog, guest.id, (answer) => {
      if (toAgent) {
        agentAsked.delete(entry);
        tellAgent(entry, "Page.javascriptDialogClosed", {
          result: answer.accept,
          userInput: answer.accept ? (answer.text ?? "") : "",
        });
      }
      resolve(answer);
    });
    onAsked?.(id);
    log.info(
      `page dialog kind=${dialog.kind} targetId=${entry.targetId} toAgent=${String(toAgent)}`,
    );
    if (toAgent) {
      agentAsked.set(entry, id);
      tellAgent(entry, "Page.javascriptDialogOpening", {
        ...(dialog.defaultValue === undefined
          ? {}
          : { defaultPrompt: dialog.defaultValue }),
        frameId: entry.targetId,
        hasBrowserHandler: true,
        message: dialog.message,
        type:
          dialog.kind === "leave" || dialog.kind === "reload"
            ? "beforeunload"
            : dialog.kind,
        url: guest.getURL(),
      });
    }
  });
}

const HandleDialogParamsSchema = z.object({
  accept: z.boolean().optional(),
  promptText: z.string().optional(),
});

/** The dialog each tab's agent was shown and has not answered, by tab. */
const agentAsked = new WeakMap<BrowserEntry, string>();

/**
 * The agent's answer to the dialog it was shown (`Page.handleJavaScriptDialog`).
 * Every dialog a tab's page opens is asked here, so with none shown to the
 * agent the command fails as Chromium's does, rather than reach a dialog the
 * guest's debugger holds behind the tab's card.
 */
export function answerAgentDialog(
  entry: BrowserEntry,
  params: unknown,
): object {
  const id = agentAsked.get(entry);
  if (id === undefined) {
    throw new Error("No dialog is showing");
  }
  const { accept, promptText } = HandleDialogParamsSchema.parse(params ?? {});
  pageDialogs.answer(
    id,
    accept === true
      ? {
          accept: true,
          ...(promptText === undefined ? {} : { text: promptText }),
        }
      : { accept: false },
  );
  return {};
}

function tellAgent(entry: BrowserEntry, method: string, params: object) {
  for (const listener of entry.eventListeners) {
    listener(method, params);
  }
}

/** The host a dialog names as asking, with its port when not the default. */
function siteOf(guest: WebContents): string {
  return URL.parse(guest.getURL())?.host || guest.getURL();
}
