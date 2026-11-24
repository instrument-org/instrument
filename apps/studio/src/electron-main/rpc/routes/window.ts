import { base } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";
import { getCallingWindow } from "@/electron-main/windows/calling-window";
import {
  mergeAllWindows,
  openNewAppWindow,
  otherAppWindows,
  canReopenClosedAppWindow,
  reopenClosedAppWindow,
  showInOtherWindow as showElsewhere,
  tabShown as noteTabShown,
  takeLaunchSweep as takeSweep,
  takePendingAppWindowAsks,
} from "@/electron-main/windows/app-window";
import {
  endTabCarry as endCarry,
  moveTabNow,
  noteTabCarry as noteCarry,
  placeTabCarry as placeCarry,
  startTabCarry as startCarry,
  tabCarryViewOf,
} from "@/electron-main/windows/tab-carry";
import {
  TabMoveDestinationSchema,
  TabSchema,
  TabStandingSchema,
} from "@/shared/tabs";
import { liveRead } from "@instrument-org/workspace/electron";
import { Menu } from "electron";
import { z } from "zod";

const PointSchema = z.object({ x: z.number(), y: z.number() });

const AskSchema = z.discriminatedUnion("type", [
  z.object({ hostPath: z.string(), type: z.literal("openFile") }),
  z.object({ href: z.string(), type: z.literal("openScreen") }),
  z.object({
    folder: z.string().optional(),
    name: z.string(),
    type: z.literal("missingFile"),
  }),
  z.object({ count: z.number(), type: z.literal("notOpened") }),
  z.object({
    host: z.string(),
    type: z.literal("pageNotOpened"),
    why: z.enum(["noAnswer", "notKept"]),
  }),
  z.object({ type: z.literal("linkNotOpened") }),
  z.object({
    project: z.string().optional(),
    type: z.literal("newChat"),
    words: z.string(),
  }),
  z.object({ type: z.literal("openNewChat") }),
  z.object({ type: z.literal("openSettings") }),
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

/** A window of its own, opening on the inbox, or on a tab given it. */
const openNew = base
  .input(z.object({ tabs: z.array(TabSchema).optional() }).optional())
  .handler(({ input }) => {
    openNewAppWindow(input?.tabs);
  });

/** Whether a window closed lately can come back. */
const canReopenClosed = base.handler(() => canReopenClosedAppWindow());

/**
 * A window closed lately, as it was, where one can come back; with `after`,
 * only one closed later than that. Answers whether one came back.
 */
const reopenClosed = base
  .input(z.object({ after: z.number().optional() }).optional())
  .handler(({ input }) => reopenClosedAppWindow({ after: input?.after }));

/**
 * Brings forward another open window's tab showing what an address shows,
 * with that window once it says it has the tab; false where none does, for
 * the asking window to open it itself.
 */
const showInOtherWindow = base
  .input(z.object({ href: z.string() }))
  .output(z.boolean())
  .handler(({ context, input }) =>
    showElsewhere(input.href, context.webContentsId),
  );

/** This window's answer to a `showTab` command: whether it had the tab and brought it up. */
const tabShown = base
  .input(z.object({ requestId: z.string(), shown: z.boolean() }))
  .handler(({ input }) => {
    noteTabShown(input.requestId, input.shown);
  });

/** Whether this window is the one to clear what the launch left over. */
const takeLaunchSweep = base
  .output(z.boolean())
  .handler(({ context }) => takeSweep(context.webContentsId));

/** A tab moved from a menu, the way a drag let go there would move it: see `windows/tab-carry.ts`. */
const moveTab = base
  .input(
    z.object({
      isOnlyTab: z.boolean(),
      moving: TabStandingSchema,
      to: TabMoveDestinationSchema,
    }),
  )
  .handler(({ context, input }) =>
    moveTabNow({ ...input, webContentsId: context.webContentsId }),
  );

/** Every other window's tabs into the one in front. */
const mergeAll = base.input(z.void()).handler(() => {
  mergeAllWindows();
});

/** Starts carrying a tab: see `windows/tab-carry.ts`. */
const startTabCarry = base
  .input(
    z.object({
      at: PointSchema,
      grab: PointSchema,
      isOffRow: z.boolean(),
      isOnlyTab: z.boolean(),
      moving: TabStandingSchema,
      pointInTab: z.number(),
    }),
  )
  .handler(({ context, input }) =>
    startCarry({ ...input, webContentsId: context.webContentsId }),
  );

const noteTabCarry = base
  .input(PointSchema.extend({ isOffRow: z.boolean() }))
  .handler(({ input }) => {
    noteCarry(input);
  });

/** Where the tab stands in the strip it is held over, from the window showing it. */
const placeTabCarry = base
  .input(z.object({ index: z.number() }))
  .handler(({ context, input }) => {
    placeCarry(context.webContentsId, input.index);
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
const endTabCarry = base
  .input(
    z.object({
      canceled: z.boolean(),
      point: PointSchema.optional(),
    }),
  )
  .handler(({ input }) => endCarry(input));

export const window = {
  canReopenClosed,
  endTabCarry,
  events,
  live: { others },
  mergeAll,
  moveTab,
  noteTabCarry,
  placeTabCarry,
  openNew,
  reopenClosed,
  showAppMenu,
  showInOtherWindow,
  startTabCarry,
  tabShown,
  takeLaunchSweep,
  takePending,
};
