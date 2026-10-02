import { app, type Session, type WebContents, webFrameMain } from "electron";

/** A frame as the main process names one: its renderer process and its routing id there. */
interface FrameId {
  processId: number;
  routingId: number;
}

type TrackedContents = Pick<WebContents, "id" | "on" | "once">;

/**
 * The address of the document each frame loaded, per web contents, as of its
 * last cross-document navigation.
 *
 * A frame's own `url` is not that: `history.pushState` and
 * `history.replaceState` rewrite it to any address of the same origin without
 * loading anything, and every `file://` page shares one origin. So a page
 * could name itself `/etc/z.html` and be judged as though it sat in `/etc`.
 * What is recorded here moves only when a frame commits a new document
 * (`did-frame-navigate`); a same-document change (`did-navigate-in-page`)
 * leaves it where it was.
 */
const documents = new Map<number, Map<string, FrameId & { url: string }>>();

const trackedSessions = new WeakSet<Session>();
let listening = false;

const keyOf = ({ processId, routingId }: FrameId) =>
  `${processId}:${routingId}`;

/** The document `frame` of contents `webContentsId` last loaded, when one was recorded. */
export function committedDocumentOf(
  webContentsId: number | undefined,
  frame: FrameId | null | undefined,
): string | undefined {
  if (webContentsId === undefined || !frame) {
    return;
  }
  return documents.get(webContentsId)?.get(keyOf(frame))?.url;
}

export function trackFrameDocuments(contents: TrackedContents) {
  const { id } = contents;
  const frames = new Map<string, FrameId & { url: string }>();
  documents.set(id, frames);
  contents.on(
    "did-frame-navigate",
    (_event, url, _code, _status, _isMainFrame, processId, routingId) => {
      forgetGoneFrames(frames);
      frames.set(keyOf({ processId, routingId }), {
        processId,
        routingId,
        url,
      });
    },
  );
  contents.once("destroyed", () => {
    documents.delete(id);
  });
}

/**
 * Records the documents of every web contents created in `session` from now
 * on. Call it before the session's first contents exist: a contents made
 * earlier has no record, and its frames read nothing that needs one.
 */
export function trackFrameDocumentsIn(session: Session) {
  trackedSessions.add(session);
  if (listening) {
    return;
  }
  listening = true;
  app.on("web-contents-created", (_event, contents) => {
    if (trackedSessions.has(contents.session)) {
      trackFrameDocuments(contents);
    }
  });
}

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
