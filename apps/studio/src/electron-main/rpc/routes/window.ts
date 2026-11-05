import { base } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";
import { getCallingWindow } from "@/electron-main/windows/calling-window";
import {
  closeEmptiedWindow,
  mergeAllWindows,
  moveTabToWindow,
  openNewAppWindow,
  otherAppWindows,
  reopenClosedAppWindow,
  takePendingAppWindowAsks,
} from "@/electron-main/windows/app-window";
import {
  endTabCarry,
  moveTabCarry,
  moveTabNow,
  placeHeldTab,
  startTabCarry,
  tabCarryViewOf,
} from "@/electron-main/windows/tab-drag";
import { getBrowserViewManager } from "@/electron-main/browser-view/manager";
import { TabSchema } from "@/shared/tabs";
import {
  BrowserTargetIdSchema,
  liveRead,
} from "@instrument-org/workspace/electron";
import { Menu } from "electron";
import { z } from "zod";

const PointSchema = z.object({ x: z.number(), y: z.number() });

/** A tab as another window would take it: see `tabStanding`. */
const MovingSchema = z.object({
  neighborPages: z.array(BrowserTargetIdSchema),
  pages: z.array(BrowserTargetIdSchema),
  tab: TabSchema,
});

const AskSchema = z.discriminatedUnion("type", [
  z.object({ hostPath: z.string(), type: z.literal("openFile") }),
  z.object({ href: z.string(), type: z.literal("openScreen") }),
  z.object({
    project: z.string().optional(),
    type: z.literal("newChat"),
    words: z.string(),
  }),
]);

const events = {
  /** What a swipe, a thumb button, a menu chord, or a link from outside asked of the window. */
  command: base.handler(async function* ({ context, signal }) {
    for await (const { command, webContentsId } of publisher.subscribe(
      "window.command",
      { signal },
    )) {
      if (webContentsId === context.webContentsId) {
        yield command;
      }
    }
  }),
  /** Open Link or Open Link in New Tab, picked from the window's native menu over a link in text being edited. */
  openMenuLink: base.handler(async function* ({ context, signal }) {
    for await (const { newTab, webContentsId } of publisher.subscribe(
      "window.open-menu-link",
      { signal },
    )) {
      if (webContentsId === context.webContentsId) {
        yield { newTab };
      }
    }
  }),
  /** What this window's strip shows of a tab held by the pointer. */
  tabCarry: base.handler(async function* ({ context, signal }) {
    const now = tabCarryViewOf(context.webContentsId);
    if (now) {
      yield now;
    }
    for await (const { view, webContentsId } of publisher.subscribe(
      "window.tab-carry",
      { signal },
    )) {
      if (webContentsId === context.webContentsId) {
        yield view;
      }
    }
  }),
};

/**
 * What links and files from outside the app asked for while this window was
 * still opening, which the command stream could not carry to it. Asked once,
 * as the window comes up. Nothing while setup is up: what waits for it goes
 * out over the command stream once it is done.
 */
const takePending = base
  .output(z.array(AskSchema))
  .handler(({ context }) => takePendingAppWindowAsks(context.webContentsId));

/** The other windows, for what a tab's menu can move it to. */
const others = base.handler(async function* ({ context, signal }) {
  yield* liveRead({
    changes: [publisher.subscribe("windows.changed", { signal })],
    read: () => otherAppWindows(context.webContentsId),
  });
});

/** A window of its own, opening on the inbox. */
const openNew = base.input(z.void()).handler(() => {
  openNewAppWindow();
});

/** A window closed lately, as it was. False when none can come back. */
const reopenClosed = base.input(z.void()).handler(() => ({
  reopened: reopenClosedAppWindow(),
}));

const WindowToMoveToSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new") }),
  z.object({ id: z.string(), kind: z.literal("window") }),
]);

/** A tab moved from a menu, the way a drag let go there would move it: see `windows/tab-drag.ts`. */
const moveTab = base
  .input(
    z.object({
      isOnlyTab: z.boolean(),
      moving: MovingSchema,
      to: WindowToMoveToSchema,
    }),
  )
  .handler(({ context, input }) =>
    moveTabNow({ ...input, webContentsId: context.webContentsId }),
  );

/**
 * A tab that opens afresh in another window, with its history: a new window
 * beside this one, or one already open. The pages it shows go with it in the
 * same step. A page another tab here shows is not among them.
 */
const sendTab = base
  .input(
    z.object({
      pages: z.array(BrowserTargetIdSchema),
      tab: TabSchema,
      to: WindowToMoveToSchema,
    }),
  )
  .handler(({ context, input }) => {
    const manager = getBrowserViewManager();
    const { destination, moved } = moveTabToWindow(input.tab, input.to);
    if (destination) {
      for (const page of input.pages) {
        if (manager.isHostOf(context.webContentsId, page)) {
          void manager.handOffGuest(page, destination.webContents.id);
        }
      }
    }
    return { moved };
  });

/** Closes the asking window, every tab of which has gone to another. */
const closeEmptied = base.input(z.void()).handler(({ context }) => {
  const window = getCallingWindow(context.webContentsId);
  if (window) {
    closeEmptiedWindow(window);
  }
});

/** Every other window's tabs into the one in front. */
const mergeAll = base.input(z.void()).handler(() => {
  mergeAllWindows();
});

/** Starts carrying a tab: see `windows/tab-drag.ts`. */
const startTabDrag = base
  .input(
    z.object({
      at: PointSchema,
      grab: PointSchema,
      isOffRow: z.boolean(),
      isOnlyTab: z.boolean(),
      moving: MovingSchema,
    }),
  )
  .handler(({ context, input }) =>
    startTabCarry({ ...input, webContentsId: context.webContentsId }),
  );

const moveTabDrag = base
  .input(PointSchema.extend({ isOffRow: z.boolean() }))
  .handler(({ input }) => {
    moveTabCarry(input);
  });

/** Where the tab stands in the strip it is held over, from the window showing it. */
const placeTabDrag = base
  .input(z.object({ index: z.number() }))
  .handler(({ input }) => {
    placeHeldTab(input.index);
  });

/** The window's menu, drawn by the system at a point of the window, where no bar of the system's shows it. */
const showAppMenu = base.input(PointSchema).handler(({ context, input }) => {
  const window = getCallingWindow(context.webContentsId);
  if (window) {
    Menu.getApplicationMenu()?.popup({
      window,
      x: Math.round(input.x),
      y: Math.round(input.y),
    });
  }
});

/** Lets the tab go, and says where it lands. */
const endTabDrag = base
  .input(
    z.object({
      canceled: z.boolean(),
      point: PointSchema.optional(),
    }),
  )
  .handler(({ input }) => endTabCarry(input));

export const window = {
  closeEmptied,
  endTabDrag,
  events,
  live: { others },
  mergeAll,
  moveTab,
  moveTabDrag,
  placeTabDrag,
  openNew,
  reopenClosed,
  sendTab,
  showAppMenu,
  startTabDrag,
  takePending,
};
