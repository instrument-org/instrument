import type { TaskId } from "@instrument-org/workspace/electron";

import { app, type Session, type WebContents, webFrameMain } from "electron";

import type { BrowserEntry } from "./entry";

/**
 * What a web contents in one of the app's browser sessions is: a tab's guest
 * (`webview`), a window a guest's page opened (`popup`), or a window that
 * draws a file for its picture and is never seen (`picture`).
 */
export type GuestRole = "picture" | "popup" | "webview";

/** A frame as the main process names one: its renderer process and its routing id there. */
export interface FrameId {
  processId: number;
  routingId: number;
}

/**
 * A page's file shown ready to edit in its guest; `page-editor/sessions.ts`
 * owns its lifetime.
 */
interface PageEdit {
  /** Which load this is: a stop names the one it ends, so a late stop never ends a later Edit. */
  generation: number;
  /** The file on this computer the guest shows. */
  path: string;
  /** The text the stamped copy was made from. */
  src: string;
  /** The copy the guest is handed: `src` with an id on every element. */
  stamped: string;
  /** What the editor handed over when it asked to be reloaded: its undo stack, selection, scroll. */
  state: unknown;
  /**
   * The exact address the stamped copy was loaded at, its nonce included.
   * Only a document at this address is this edit. A `file` protocol request
   * names no contents, so the nonce in the address is the one way the
   * session's handler can tell which guest's copy is asked for.
   */
  url: string;
  version: string;
}

export interface GuestRecord {
  /** The contents itself, for the hooks that act on it. */
  readonly contents: WebContents;
  /** The page being edited in place, when the guest shows one. */
  edit: null | PageEdit;
  /** The tab's entry a `webview` is bound to, from `did-attach-webview` on: its target, task and download authorization. */
  entry: BrowserEntry | null;
  /**
   * The document each frame last loaded, by `processId:routingId`, as of its
   * last cross-document navigation. A frame's own `url` is not that:
   * `history.pushState` and `history.replaceState` rewrite it to any address
   * of the same origin without loading anything, and every `file://` page
   * shares one origin, so a page could name itself `/etc/z.html` and be
   * judged as though it sat in `/etc`. This moves only when a frame commits a
   * new document (`did-frame-navigate`).
   */
  readonly frames: Map<string, FrameId & { url: string }>;
  readonly id: number;
  readonly role: GuestRole;
}

const keyOf = ({ processId, routingId }: FrameId) =>
  `${processId}:${routingId}`;

/**
 * Every web contents in the app's browser sessions, by its webContents id.
 *
 * All of a workspace's guests share one session, so a request, a download or
 * an IPC message names only the contents it came from. Every hook on the
 * session reads that contents' record here: which tab and task it belongs to,
 * whether it is a guest or a popup, what each frame loaded, the page it is
 * editing, and whether its task turned ad blocking off. A record comes into
 * being with its contents and goes with it.
 */
export function createGuestRegistry() {
  const records = new Map<number, GuestRecord>();
  const roleOfSession = new Map<
    Session,
    {
      onTracked?: (record: GuestRecord) => void;
      roleOf: (contents: WebContents) => GuestRole;
    }
  >();
  const unblockedTasks = new Set<TaskId>();
  let listening = false;

  function track(contents: WebContents, role: GuestRole): GuestRecord {
    const { id } = contents;
    const record: GuestRecord = {
      contents,
      edit: null,
      entry: null,
      frames: new Map(),
      id,
      role,
    };
    records.set(id, record);
    contents.on(
      "did-frame-navigate",
      (_event, url, _code, _status, _isMainFrame, processId, routingId) => {
        forgetGoneFrames(record.frames);
        record.frames.set(keyOf({ processId, routingId }), {
          processId,
          routingId,
          url,
        });
      },
    );
    contents.once("destroyed", () => {
      if (records.get(id) === record) {
        records.delete(id);
      }
    });
    return record;
  }

  return {
    /** The guest bound to a tab's entry, from `did-attach-webview` on. */
    bind(id: number, entry: BrowserEntry) {
      const record = records.get(id);
      if (record) {
        record.entry = entry;
      }
    },
    /** The document `frame` of contents `id` last loaded, when one was recorded. */
    documentOf(
      id: number | undefined,
      frame: FrameId | null | undefined,
    ): string | undefined {
      if (id === undefined || !frame) {
        return;
      }
      return records.get(id)?.frames.get(keyOf(frame))?.url;
    },
    /** The tab's entry for a guest, when the contents is one bound to a tab. */
    entryOf(id: number): BrowserEntry | undefined {
      return records.get(id)?.entry ?? undefined;
    },
    get(id: number): GuestRecord | undefined {
      return records.get(id);
    },
    /** Whether the contents' task turned ad blocking off for its own tabs. */
    isAdBlockExempt(id: number): boolean {
      const task = records.get(id)?.entry?.id;
      return task !== undefined && unblockedTasks.has(task);
    },
    records(): IterableIterator<GuestRecord> {
      return records.values();
    },
    /**
     * Turns ad blocking off (`false`) or on (`true`) for a task's own tabs,
     * or with `undefined` only asks; answers whether it blocks for them.
     */
    setAdBlocking(task: TaskId, blocking: boolean | undefined): boolean {
      if (blocking === false) {
        unblockedTasks.add(task);
      } else if (blocking === true) {
        unblockedTasks.delete(task);
      }
      return !unblockedTasks.has(task);
    },
    /** Records one contents directly; the app's sessions go through {@link watchSession}. */
    track,
    /**
     * Records every web contents created in `session` from now on, in the
     * role `roleOf` gives it, and hands each record to `onTracked`. Call it
     * before the session's first contents exists: one made earlier has no
     * record, and its frames read nothing.
     */
    watchSession(
      session: Session,
      roleOf: (contents: WebContents) => GuestRole,
      onTracked?: (record: GuestRecord) => void,
    ) {
      roleOfSession.set(session, { onTracked, roleOf });
      if (listening) {
        return;
      }
      listening = true;
      app.on("web-contents-created", (_event, contents) => {
        const watched = roleOfSession.get(contents.session);
        if (watched) {
          watched.onTracked?.(track(contents, watched.roleOf(contents)));
        }
      });
    },
  };
}

export type GuestRegistry = ReturnType<typeof createGuestRegistry>;

/** The app's one registry, which every browser session hook reads. */
export const guests = createGuestRegistry();

/**
 * Drops the frames that no longer exist, so a long-lived guest's record holds
 * only what it has. A frame kept for Back (the back/forward cache) still
 * exists, and keeps its entry.
 */
function forgetGoneFrames(frames: Map<string, FrameId>) {
  for (const [key, { processId, routingId }] of frames) {
    if (!webFrameMain.fromId(processId, routingId)) {
      frames.delete(key);
    }
  }
}
