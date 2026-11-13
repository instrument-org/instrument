import { publisher } from "@/electron-main/rpc/publisher";
import { type CaptureDevices, type GuestCapture } from "@/shared/browser";
import {
  PAGE_CAPTURE_CHANNEL,
  PAGE_CAPTURE_STOP_CHANNEL,
} from "@/shared/page-editor-channels";
import { type BrowserTargetId } from "@instrument-org/workspace/electron";
import {
  app,
  ipcMain,
  systemPreferences,
  type WebContents,
  webContents as allWebContents,
} from "electron";

import { guests } from "./guest-registry";
import { log } from "./log";

/**
 * Where each tab's page stands with the microphone and camera, by its guest:
 * the origin granted them in that guest, what the page is using now (as its
 * preload reports from the page's own tracks), what it asked for and was
 * refused for want of a person's click, and which the system refused the
 * app. Main reads it to keep a page in a call from sleeping, closing or
 * restarting under the person, and the window draws it at the omnibar's end
 * and on the tab.
 */
interface PageCapture {
  granted: string;
  refused: (CaptureDevices & { origin: string }) | null;
  system: GuestCapture["system"];
  using: CaptureDevices;
}

const NONE: CaptureDevices = { audio: false, video: false };

const pages = new Map<number, PageCapture>();

function changed() {
  publisher.publish("browser.capture-changed", null);
}

/** The guest's state, made and watched for its end the first time it is asked for. */
function stateOf(contents: WebContents): PageCapture {
  let state = pages.get(contents.id);
  if (!state) {
    state = { granted: "", refused: null, system: null, using: NONE };
    pages.set(contents.id, state);
    const id = contents.id;
    contents.once("destroyed", () => {
      pages.delete(id);
      changed();
    });
    // A new document has no tracks, and the page it replaced asked for
    // nothing more; a grant lasts while the tab stays on its origin.
    contents.on("did-navigate", (_event, url) => {
      const page = pages.get(id);
      if (!page) {
        return;
      }
      page.using = NONE;
      page.refused = null;
      page.system = null;
      if (page.granted !== originOf(url)) {
        page.granted = "";
      }
      changed();
    });
  }
  return state;
}

/** A URL's origin, or "" for one that has none to compare. */
export function originOf(url: string | undefined): string {
  if (!URL.canParse(url ?? "")) {
    return "";
  }
  const { origin } = new URL(url ?? "");
  return origin === "null" ? "" : origin;
}

/** Whether the guest let this origin use the microphone or camera. */
export function grantedTo(contents: WebContents, origin: string): boolean {
  return !!origin && pages.get(contents.id)?.granted === origin;
}

/** The page's origin was let use what it asked for. */
export function noteGranted(contents: WebContents, origin: string) {
  const state = stateOf(contents);
  state.granted = origin;
  state.refused = null;
  state.system = null;
  changed();
}

/** The page asked with no click of a person's to go on, which the person may answer from the omnibar. */
export function noteRefused(
  contents: WebContents,
  origin: string,
  mediaTypes: readonly ("audio" | "video")[],
) {
  if (!origin || mediaTypes.length === 0) {
    return;
  }
  const state = stateOf(contents);
  state.refused = {
    audio: mediaTypes.includes("audio"),
    origin,
    video: mediaTypes.includes("video"),
  };
  changed();
}

/** The system refused the app what the page asked for. */
export function noteSystemRefused(
  contents: WebContents,
  device: "camera" | "microphone",
) {
  stateOf(contents).system = device;
  changed();
}

/** Whether a page is using the microphone or camera right now. */
export function isCapturing(contents: WebContents | null | undefined) {
  const using = contents ? pages.get(contents.id)?.using : undefined;
  return !!using && (using.audio || using.video);
}

/** Whether any page is using the microphone or camera, which a restart would cut off. */
export function anyPageCapturing() {
  return [...pages.values()].some(({ using }) => using.audio || using.video);
}

/** Every tab's page with something to show about the microphone or camera. */
export function listCaptures(): GuestCapture[] {
  return [...pages].flatMap(([id, state]) => {
    const targetId = guests.get(id)?.entry?.targetId;
    if (
      !targetId ||
      (!state.using.audio &&
        !state.using.video &&
        !state.refused &&
        !state.system)
    ) {
      return [];
    }
    const contents = allWebContents.fromId(id);
    return [
      {
        refused: state.refused
          ? { audio: state.refused.audio, video: state.refused.video }
          : null,
        site: URL.parse(contents?.getURL() ?? "")?.host ?? "",
        system: state.system,
        targetId,
        using: state.using,
      },
    ];
  });
}

function contentsOf(targetId: BrowserTargetId): WebContents | null {
  for (const id of pages.keys()) {
    if (guests.get(id)?.entry?.targetId === targetId) {
      const contents = allWebContents.fromId(id);
      return contents && !contents.isDestroyed() ? contents : null;
    }
  }
  return null;
}

/**
 * Ends what the page is capturing, the way the person's Stop asks: the
 * tracks end as though the device went away, and the page needs a fresh
 * click to have them again.
 */
export function stopCapture(targetId: BrowserTargetId) {
  const contents = contentsOf(targetId);
  if (!contents) {
    return;
  }
  const state = stateOf(contents);
  state.granted = "";
  contents.send(PAGE_CAPTURE_STOP_CHANNEL);
  log.info(`media stopped guest=${contents.id}`);
}

/**
 * The person allowed what the page asked for without a click: the grant is
 * the page's origin's, and the page loads again to ask for it once more.
 */
export function allowCapture(targetId: BrowserTargetId) {
  const contents = contentsOf(targetId);
  const refused = contents ? pages.get(contents.id)?.refused : null;
  if (!contents || !refused || refused.origin !== originOf(contents.getURL())) {
    return;
  }
  noteGranted(contents, refused.origin);
  log.info(`media allowed from the omnibar guest=${contents.id}`);
  contents.reload();
}

/**
 * Whether the system lets the app use what a page asked for, asking it first
 * when nobody has answered: the device it refused, or null. macOS keeps a
 * switch per app for each; elsewhere there is nothing to ask here. A fake
 * capture device (Chromium's `--use-fake-device-for-media-stream`, for a
 * development run) needs no permission.
 */
export async function systemRefusal(
  mediaTypes: readonly ("audio" | "video")[],
): Promise<"camera" | "microphone" | null> {
  if (
    process.platform !== "darwin" ||
    app.commandLine.hasSwitch("use-fake-device-for-media-stream")
  ) {
    return null;
  }
  for (const type of mediaTypes) {
    const device = type === "audio" ? "microphone" : "camera";
    if (systemPreferences.getMediaAccessStatus(device) === "not-determined") {
      await systemPreferences.askForMediaAccess(device);
    }
    if (systemPreferences.getMediaAccessStatus(device) !== "granted") {
      return device;
    }
  }
  return null;
}

/**
 * Takes what a guest's preload says its page is capturing. A page's own
 * scripts can raise the same event the preload listens for, so a report
 * counts only from a page whose origin was granted in that guest: otherwise
 * it could only be a page claiming a call it cannot have.
 */
export function listenForPageCapture() {
  ipcMain.on(PAGE_CAPTURE_CHANNEL, (event, kinds: unknown) => {
    const contents = event.sender;
    if (typeof kinds !== "string" || !guests.get(contents.id)) {
      return;
    }
    const using = {
      audio: kinds.split(",").includes("audio"),
      video: kinds.split(",").includes("video"),
    };
    if (
      (using.audio || using.video) &&
      !grantedTo(contents, originOf(contents.getURL()))
    ) {
      return;
    }
    const state = stateOf(contents);
    if (
      state.using.audio === using.audio &&
      state.using.video === using.video
    ) {
      return;
    }
    state.using = using;
    log.info(
      `media using guest=${contents.id} audio=${String(using.audio)} video=${String(using.video)}`,
    );
    changed();
  });
}
