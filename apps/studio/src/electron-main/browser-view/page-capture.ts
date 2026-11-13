import { publisher } from "@/electron-main/rpc/publisher";
import {
  getSiteCaptureStore,
  type SiteCapture,
} from "@/electron-main/stores/workspace/site-capture";
import {
  type CaptureDevices,
  type GuestCapture,
  type SiteCaptureSetting,
} from "@/shared/browser";
import {
  PAGE_CAPTURE_CHANNEL,
  PAGE_CAPTURE_DEVICES_CHANNEL,
  PAGE_CAPTURE_PAUSE_CHANNEL,
  PAGE_CAPTURE_STOP_CHANNEL,
} from "@/shared/page-editor-channels";
import { type BrowserTargetId } from "@instrument-org/workspace/electron";
import {
  app,
  BrowserWindow,
  ipcMain,
  systemPreferences,
  type WebContents,
  webContents as allWebContents,
} from "electron";

import { guests } from "./guest-registry";
import { log } from "./log";
import { mediaDecision } from "./media-capture-policy";

type MediaType = "audio" | "video";

/**
 * Where each tab's page stands with the microphone and camera, by its guest:
 * the origin let have them in that guest, the ask waiting on the person, what
 * the page is using now (as its preload reports from the page's own tracks)
 * and whether that is paused, and what it was refused and why. Main reads it
 * to keep a page in a call from sleeping, closing or restarting under the
 * person, and the window draws it at the omnibar's end and on the tab.
 */
interface PageCapture {
  ask: null | {
    answers: ((allowed: boolean) => void)[];
    origin: string;
    types: Set<MediaType>;
  };
  blocked: CaptureDevices | null;
  granted: string;
  paused: boolean;
  refused: (CaptureDevices & { origin: string }) | null;
  system: GuestCapture["system"];
  using: CaptureDevices;
}

const NONE: CaptureDevices = { audio: false, video: false };

const pages = new Map<number, PageCapture>();

function changed() {
  publisher.publish("browser.capture-changed", null);
}

const devicesOf = (types: Iterable<MediaType>): CaptureDevices => {
  const all = [...types];
  return { audio: all.includes("audio"), video: all.includes("video") };
};

/** Answers a waiting ask's requests, and lets it go. */
function settleAsk(state: PageCapture, allowed: boolean) {
  const ask = state.ask;
  state.ask = null;
  for (const answer of ask?.answers ?? []) {
    answer(allowed);
  }
}

/** The guest's state, made and watched for its end the first time it is asked for. */
function stateOf(contents: WebContents): PageCapture {
  let state = pages.get(contents.id);
  if (!state) {
    state = {
      ask: null,
      blocked: null,
      granted: "",
      paused: false,
      refused: null,
      system: null,
      using: NONE,
    };
    pages.set(contents.id, state);
    const id = contents.id;
    contents.once("destroyed", () => {
      const page = pages.get(id);
      if (page) {
        settleAsk(page, false);
      }
      pages.delete(id);
      changed();
    });
    // A new document has no tracks, and the page it replaced asks for
    // nothing more; a grant lasts while the tab stays on its origin.
    contents.on("did-navigate", (_event, url) => {
      const page = pages.get(id);
      if (!page) {
        return;
      }
      settleAsk(page, false);
      page.using = NONE;
      page.paused = false;
      page.refused = null;
      page.blocked = null;
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

/** What the person told the browser about a site. */
function siteOf(origin: string): SiteCapture {
  return getSiteCaptureStore().get("sites")[origin] ?? {};
}

function settingOf(site: SiteCapture, type: MediaType): SiteCaptureSetting {
  return site[type] ?? "ask";
}

/** Whether the guest let this origin use the microphone or camera, this visit or always. */
export function grantedTo(contents: WebContents, origin: string): boolean {
  if (!origin) {
    return false;
  }
  if (pages.get(contents.id)?.granted === origin) {
    return true;
  }
  const site = siteOf(origin);
  return site.audio === "allow" || site.video === "allow";
}

/**
 * Hands the page's preload the devices picked for its site, before the
 * request it is for is answered, so the page's own wrapper can swap a
 * default device for the picked one as the stream arrives.
 */
function sendDevices(contents: WebContents, origin: string) {
  const site = siteOf(origin);
  contents.send(
    PAGE_CAPTURE_DEVICES_CHANNEL,
    JSON.stringify({
      audio: site.audioDevice ?? "",
      video: site.videoDevice ?? "",
    }),
  );
}

/** Lets the page have what it asked for once the system lets the app, and answers. */
function grant(
  contents: WebContents,
  origin: string,
  types: readonly MediaType[],
  answer: (allowed: boolean) => void,
) {
  systemRefusal(types).then(
    (refused) => {
      log.info(`media system=${refused ?? "allowed"} guest=${contents.id}`);
      if (contents.isDestroyed()) {
        answer(false);
        return;
      }
      const state = stateOf(contents);
      if (refused) {
        state.system = refused;
      } else {
        state.granted = origin;
        state.refused = null;
        state.blocked = null;
        state.system = null;
        sendDevices(contents, origin);
      }
      changed();
      answer(!refused);
    },
    () => {
      answer(false);
    },
  );
}

/**
 * A page's request for the microphone or camera (`media`), decided by
 * `mediaDecision`: refused outright for a site told never, let through for
 * one told always or already let have them in this guest, put to the person
 * when they just clicked in the tab (the window draws the ask at the
 * omnibar's mark), and otherwise refused with a mark the person can allow
 * from. A second request while the ask is up joins it, so it is asked once.
 */
export function handleMediaRequest(
  contents: WebContents,
  details: { mediaTypes?: MediaType[]; securityOrigin?: string },
  answer: (allowed: boolean) => void,
) {
  const origin = originOf(details.securityOrigin);
  const types = details.mediaTypes ?? [];
  const record = guests.get(contents.id);
  const host = contents.hostWebContents;
  const site = siteOf(origin);
  const asked = {
    grantedBefore: !!origin && pages.get(contents.id)?.granted === origin,
    record,
    settings: types.map((type) => settingOf(site, type)),
    shown: record?.entry?.shown ?? false,
    windowFocused:
      !!host &&
      !host.isDestroyed() &&
      !!BrowserWindow.fromWebContents(host)?.isFocused(),
  };
  const decision =
    !origin || types.length === 0 ? "refuse" : mediaDecision(asked);
  log.info(
    `media ${decision} guest=${contents.id} types=${types.join("+") || "none"} origin=${origin || "none"} grantedBefore=${String(asked.grantedBefore)} settings=${asked.settings.join("+")} shown=${String(asked.shown)} windowFocused=${String(asked.windowFocused)} inputAgoMs=${record?.userInputAt ? Date.now() - record.userInputAt : "never"}`,
  );
  if (decision === "allow") {
    grant(contents, origin, types, answer);
    return;
  }
  if (decision === "ask") {
    const state = stateOf(contents);
    if (state.ask?.origin === origin) {
      for (const type of types) {
        state.ask.types.add(type);
      }
      state.ask.answers.push(answer);
    } else {
      settleAsk(state, false);
      state.ask = { answers: [answer], origin, types: new Set(types) };
    }
    changed();
    return;
  }
  // A tab's page, which the person can allow or unblock from its omnibar; a
  // popup has none.
  if (record?.role === "webview" && origin) {
    const state = stateOf(contents);
    const devices = { ...devicesOf(types), origin };
    if (decision === "blocked") {
      state.blocked = devicesOf(types);
    } else {
      state.refused = devices;
    }
    changed();
  }
  answer(false);
}

/**
 * The person's answer to the ask: always or never for the site, which is
 * kept, this visit only, or the ask put away (no for now). The devices they
 * picked are kept for the site with any yes.
 */
export function answerAsk(
  targetId: BrowserTargetId,
  {
    answer,
    devices,
  }: {
    answer: "always" | "dismiss" | "never" | "once";
    devices: { audio?: string | undefined; video?: string | undefined };
  },
) {
  const contents = contentsOf(targetId);
  const state = contents ? pages.get(contents.id) : undefined;
  const ask = state?.ask;
  if (!contents || !state || !ask) {
    return;
  }
  const types = [...ask.types];
  log.info(`media answer=${answer} guest=${contents.id}`);
  if (answer !== "dismiss") {
    const store = getSiteCaptureStore();
    const sites = store.get("sites");
    const site: SiteCapture = { ...sites[ask.origin] };
    for (const type of types) {
      if (answer === "always") {
        site[type] = "allow";
      } else if (answer === "never") {
        site[type] = "block";
      }
      const device = devices[type];
      if (answer !== "never" && device) {
        site[type === "audio" ? "audioDevice" : "videoDevice"] = device;
      }
    }
    store.set("sites", { ...sites, [ask.origin]: site });
  }
  if (answer === "dismiss" || answer === "never") {
    if (answer === "never") {
      state.blocked = devicesOf(types);
    }
    settleAsk(state, false);
    changed();
    return;
  }
  const answers = ask.answers;
  state.ask = null;
  changed();
  grant(contents, ask.origin, types, (allowed) => {
    for (const each of answers) {
      each(allowed);
    }
  });
}

/** What the person set for one device on the page's site from its mark, kept for the next ask. */
export function setSiteCapture(
  targetId: BrowserTargetId,
  type: MediaType,
  setting: SiteCaptureSetting,
) {
  const contents = contentsOf(targetId);
  const origin = originOf(contents?.getURL());
  if (!contents || !origin) {
    return;
  }
  const store = getSiteCaptureStore();
  const sites = store.get("sites");
  const site: SiteCapture = { ...sites[origin] };
  if (setting === "ask") {
    delete site[type];
  } else {
    site[type] = setting;
  }
  store.set("sites", { ...sites, [origin]: site });
  if (setting === "block" && stateOf(contents).granted === origin) {
    stateOf(contents).granted = "";
  }
  changed();
}

/** Forgets every site's answers, as clearing a browser's site data does. */
export function forgetSiteCapture() {
  getSiteCaptureStore().set("sites", {});
  for (const state of pages.values()) {
    state.granted = "";
  }
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
        !state.ask &&
        !state.refused &&
        !state.blocked &&
        !state.system)
    ) {
      return [];
    }
    const contents = allWebContents.fromId(id);
    const url = contents?.getURL() ?? "";
    const origin = originOf(url);
    const site = siteOf(origin);
    return [
      {
        ask: state.ask ? devicesOf(state.ask.types) : null,
        blocked: state.blocked,
        devices: { audio: site.audioDevice, video: site.videoDevice },
        origin,
        paused: state.paused,
        refused: state.refused
          ? { audio: state.refused.audio, video: state.refused.video }
          : null,
        settings: {
          audio: settingOf(site, "audio"),
          video: settingOf(site, "video"),
        },
        site: URL.parse(url)?.host ?? "",
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
 * click to have them again unless its site was told always.
 */
export function stopCapture(targetId: BrowserTargetId) {
  const contents = contentsOf(targetId);
  if (!contents) {
    return;
  }
  const state = stateOf(contents);
  state.granted = "";
  state.paused = false;
  contents.send(PAGE_CAPTURE_STOP_CHANNEL);
  log.info(`media stopped guest=${contents.id}`);
}

/** Pause sends silence and a black picture on the page's tracks without ending them; resume turns them back on. */
export function pauseCapture(targetId: BrowserTargetId, paused: boolean) {
  const contents = contentsOf(targetId);
  if (!contents) {
    return;
  }
  stateOf(contents).paused = paused;
  contents.send(PAGE_CAPTURE_PAUSE_CHANNEL, paused);
  log.info(`media paused=${String(paused)} guest=${contents.id}`);
  changed();
}

/**
 * The person allowed what the page asked for without a click: the grant is
 * the page's origin's for this visit, and the page loads again to ask for it
 * once more.
 */
export function allowCapture(targetId: BrowserTargetId) {
  const contents = contentsOf(targetId);
  const refused = contents ? pages.get(contents.id)?.refused : null;
  if (!contents || !refused || refused.origin !== originOf(contents.getURL())) {
    return;
  }
  const state = stateOf(contents);
  state.granted = refused.origin;
  state.refused = null;
  changed();
  log.info(`media allowed from the omnibar guest=${contents.id}`);
  contents.reload();
}

/** Reload on a page its site's settings refused, once the person changed them. */
export function reloadCapturePage(targetId: BrowserTargetId) {
  contentsOf(targetId)?.reload();
}

/**
 * Whether the system lets the app use what a page asked for, asking it first
 * when nobody has answered: the device it refused, or null. macOS keeps a
 * switch per app for each; elsewhere there is nothing to ask here. A fake
 * capture device (Chromium's `--use-fake-device-for-media-stream`, for a
 * development run) needs no permission.
 */
export async function systemRefusal(
  mediaTypes: readonly MediaType[],
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
    if (!using.audio && !using.video) {
      state.paused = false;
    }
    log.info(
      `media using guest=${contents.id} audio=${String(using.audio)} video=${String(using.video)}`,
    );
    changed();
  });
}
