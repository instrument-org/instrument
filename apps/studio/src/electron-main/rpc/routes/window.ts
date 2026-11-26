import { noteDrawn as noteLoadDrawn } from "@/electron-main/lib/load-note";
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
  tabGroupsByWindow as groupsByWindow,
  tabGroupsInOtherWindows,
  phoneChatListed as notePhoneChatListed,
  tabShown as noteTabShown,
  takeLaunchSweep as takeSweep,
  takePendingAppWindowAsks,
} from "@/electron-main/windows/app-window";
import {
  endTabCarry as endCarry,
  moveTabNow,
  noteTabCarry as noteCarry,
  placeGroupTabCarry as placeGroupCarry,
  placeTabCarry as placeCarry,
  startTabCarry as startCarry,
  tabCarryPictured,
  tabCarryViewOf,
} from "@/electron-main/windows/tab-carry";
import {
  GroupTabLandingSchema,
  TabMoveDestinationSchema,
  TabSchema,
  TabStandingSchema,
} from "@/shared/tabs";
import {
  getKeptState,
  setKeptState,
} from "@/electron-main/stores/workspace/kept-state";
import { RECENT_CHATS_KEY } from "@/shared/kept-state";
import {
  ChatIdSchema,
  distinct,
  liveRead,
} from "@instrument-org/workspace/electron";
import { Menu } from "electron";
import { z } from "zod";

const PointSchema = z.object({ x: z.number(), y: z.number() });

const AskSchema = z.discriminatedUnion("type", [
  z.object({ hostPath: z.string(), type: z.literal("openFile") }),
  z.object({ href: z.string(), type: z.literal("openScreen") }),
  z.object({
    group: z.string().optional(),
    hrefs: z.array(z.string()),
    type: z.literal("openGroup"),
  }),
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

/** The tab groups the other open windows have open, as they change. */
const tabGroupsElsewhere = base.handler(async function* ({ context, signal }) {
  // Every tab change in any window says the groups changed; only a change to
  // which groups are open elsewhere goes out.
  yield* distinct(
    liveRead({
      changes: [
        publisher.subscribe("windows.changed", { signal }),
        publisher.subscribe("window.tab-groups-changed", { signal }),
      ],
      read: () => tabGroupsInOtherWindows(context.webContentsId),
    }),
  );
});

/**
 * Every open window's tab groups, the one in front first: each window's in
 * its own order, the group it shows, and whether it is the window asking.
 */
const tabGroupsByWindow = base
  .output(
    z.array(
      z.object({
        groups: z.array(z.string()),
        isThisWindow: z.boolean(),
        shown: z.string().optional(),
      }),
    ),
  )
  .handler(({ context }) => groupsByWindow(context.webContentsId));

/**
 * A window of its own, opening on the inbox, or on a tab given it. One an
 * agent opens comes up behind the app the person is in, where that is
 * another. Answers whether one opened.
 */
const openNew = base
  .input(
    z
      .object({
        byAgent: z.boolean().optional(),
        tabs: z.array(TabSchema).optional(),
      })
      .optional(),
  )
  .handler(
    ({ input }) =>
      openNewAppWindow(input?.tabs, {
        behindOtherApps: input?.byAgent === true,
      }) !== null,
  );

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

/** How many groups the calling window draws and screens it keeps, for the load line. */
const noteDrawn = base
  .input(
    z.object({
      drawnGroups: z.number().int().nonnegative(),
      keptScreens: z.number().int().nonnegative(),
    }),
  )
  .handler(({ context, input }) => {
    noteLoadDrawn(context.webContentsId, input);
  });

/** This window's answer to a `listChat` command: the chat is in a tab group. */
const phoneChatListed = base
  .input(z.object({ chat: ChatIdSchema }))
  .handler(({ input }) => {
    notePhoneChatListed(input.chat);
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
      grab: PointSchema,
      isOffRow: z.boolean(),
      isOnlyTab: z.boolean(),
      moving: TabStandingSchema,
      page: PointSchema.extend({
        height: z.number(),
        width: z.number(),
      }).optional(),
      pointInTab: z.number(),
    }),
  )
  // Answered once the window has been read for the picture that goes with
  // the pointer, so what the window shows next is never what is pictured.
  .handler(async ({ context, input }) => {
    const started = startCarry({
      ...input,
      webContentsId: context.webContentsId,
    });
    await tabCarryPictured();
    return started;
  });

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

/** The asking window in front of the others, as a tab group shown on an agent's ask comes up. */
const bringForward = base.handler(({ context }) => {
  const window = getCallingWindow(context.webContentsId);
  if (!window || window.isDestroyed()) {
    return;
  }
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
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

/** Where a tab group's tab held over this window lands here, from the window: none where it lands nowhere. */
const placeGroupTabCarry = base
  .input(z.object({ landing: GroupTabLandingSchema.nullable() }))
  .handler(({ context, input }) => {
    placeGroupCarry(context.webContentsId, input.landing ?? undefined);
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

/** Whether the asking window is the one to open the person's recent chats as tab groups: the first ever to ask in this workspace. */
const takeRecentChats = base.output(z.boolean()).handler(() => {
  if (getKeptState("groups", RECENT_CHATS_KEY) !== undefined) {
    return false;
  }
  setKeptState("groups", RECENT_CHATS_KEY, true);
  return true;
});

export const window = {
  bringForward,
  canReopenClosed,
  endTabCarry,
  events,
  live: { others, tabGroupsElsewhere },
  mergeAll,
  moveTab,
  noteDrawn,
  noteTabCarry,
  placeGroupTabCarry,
  placeTabCarry,
  openNew,
  reopenClosed,
  tabGroupsByWindow,
  showAppMenu,
  showInOtherWindow,
  startTabCarry,
  phoneChatListed,
  tabShown,
  takeLaunchSweep,
  takePending,
  takeRecentChats,
};
