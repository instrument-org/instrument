import { isDrivenByWorkingAgent } from "@instrument-org/workspace/electron";
import type { WebContents, WebFrameMain } from "electron";
import { z } from "zod";

import { guests } from "./guest-registry";
import { log } from "./log";

/** How recent an agent's command keeps its tab as it is, as another window's take does. */
const AGENT_RECENT_MS = 30_000;

/** How long one frame may take to say whether it has unsaved input before it counts as having some. */
const FRAME_CHECK_MS = 1000;

/**
 * The schemes `<all_urls>` reaches here. Not `file:`: an extension runs in a
 * file's page only with file access, which Chrome leaves off until the
 * person turns it on and the store loads every extension without.
 */
const ALL_URLS_SCHEMES = new Set(["ftp:", "http:", "https:", "ws:", "wss:"]);

/** The schemes a `*` scheme in a pattern reaches. */
const ANY_SCHEME = new Set(["http:", "https:", "ws:", "wss:"]);

const ContentScriptsSchema = z.object({
  content_scripts: z
    .array(z.object({ matches: z.array(z.string()).catch([]) }))
    .catch([]),
});

/** The pages an extension's manifest content scripts run in, as match patterns. */
export function contentScriptMatches(manifest: unknown): string[] {
  const parsed = ContentScriptsSchema.safeParse(manifest);
  return parsed.success
    ? parsed.data.content_scripts.flatMap(({ matches }) => matches)
    : [];
}

/**
 * Whether an address is one a Chrome match pattern names
 * (`<all_urls>`, `*://*.example.com/*`), in a page an extension can run in.
 */
export function matchesPattern(url: string, pattern: string): boolean {
  let address: URL;
  try {
    address = new URL(url);
  } catch {
    return false;
  }
  if (pattern === "<all_urls>") {
    return ALL_URLS_SCHEMES.has(address.protocol);
  }
  const parts = /^(\*|[a-z][a-z0-9+.-]*):\/\/([^/]*)(\/.*)$/i.exec(pattern);
  if (!parts) {
    return false;
  }
  const [, scheme = "", host = "", path = ""] = parts;
  if (
    scheme === "*"
      ? !ANY_SCHEME.has(address.protocol)
      : address.protocol !== `${scheme.toLowerCase()}:`
  ) {
    return false;
  }
  if (address.protocol === "file:" || !hostMatches(address.hostname, host)) {
    return false;
  }
  return globMatches(`${address.pathname}${address.search}`, path);
}

function hostMatches(hostname: string, pattern: string): boolean {
  const name = pattern.toLowerCase();
  if (name === "*") {
    return true;
  }
  if (name.startsWith("*.")) {
    const base = name.slice(2);
    return hostname === base || hostname.endsWith(`.${base}`);
  }
  return hostname === name;
}

function globMatches(value: string, glob: string): boolean {
  const source = glob
    .split("*")
    .map((piece) => piece.replaceAll(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`).test(value);
}

/** What one open tab is doing, for whether a reload would take something from it. */
interface OpenTabState {
  /** When an agent last sent it a command, in ms, or 0. */
  agentCommandAt: number;
  /** Whether an agent with a turn running drives it. */
  driven: boolean;
  /** Whether a page edit is open in it. */
  editing: boolean;
  /** Whether its page is in HTML full screen. */
  fullScreen: boolean;
  /** Whether its page is playing sound. */
  playing: boolean;
  /** The address it is at. */
  url: string;
}

/**
 * Why a reload would take something from an open tab an extension's content
 * scripts would run in, or null when the tab can reload for it: the page is
 * one the extension reaches, no agent is at work in it, it is not playing,
 * in full screen or being edited. Unsaved input in its fields is checked in
 * the page itself (`hasUnsavedInput`), and a page that asks before it is left
 * (`beforeunload`) keeps itself, since nothing here answers its ask.
 */
function keepsOpenTab(
  tab: OpenTabState,
  matches: readonly string[],
  now: number,
): null | string {
  if (!matches.some((pattern) => matchesPattern(tab.url, pattern))) {
    return "not a page the extension reaches";
  }
  if (tab.driven || now - tab.agentCommandAt < AGENT_RECENT_MS) {
    return "an agent is at work in it";
  }
  if (tab.playing) {
    return "it is playing";
  }
  if (tab.fullScreen) {
    return "it is in full screen";
  }
  if (tab.editing) {
    return "it is being edited";
  }
  return null;
}

/**
 * Whether a frame has input a reload would lose: a field, box or choice
 * changed from what the page loaded with, or an editable element focused.
 */
const UNSAVED_INPUT = `(() => {
  for (const field of document.querySelectorAll("input, textarea, select")) {
    if (field instanceof HTMLSelectElement) {
      if ([...field.options].some((option) => option.selected !== option.defaultSelected)) return true;
    } else if (field.type === "checkbox" || field.type === "radio") {
      if (field.checked !== field.defaultChecked) return true;
    } else if (!["button", "hidden", "image", "reset", "submit"].includes(field.type) && field.value !== field.defaultValue) {
      return true;
    }
  }
  return document.activeElement instanceof HTMLElement && document.activeElement.isContentEditable;
})()`;

async function frameHasUnsavedInput(frame: WebFrameMain): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return await Promise.race([
    Promise.resolve()
      // Cast: Electron types the script's answer as `any`.
      .then(() => frame.executeJavaScript(UNSAVED_INPUT) as Promise<unknown>)
      .then((answer) => answer !== false)
      // A frame that cannot answer may be holding anything.
      .catch(() => true),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => {
        resolve(true);
      }, FRAME_CHECK_MS);
    }),
  ]).finally(() => {
    clearTimeout(timer);
  });
}

/** Whether any frame of a tab's page has input a reload would lose. */
async function hasUnsavedInput(contents: WebContents): Promise<boolean> {
  const answers = await Promise.all(
    contents.mainFrame.framesInSubtree.map(frameHasUnsavedInput),
  );
  return answers.includes(true);
}

/**
 * Reloads the open tabs a newly installed extension's content scripts would
 * run in, so it works there without the person reloading them. Chrome itself
 * injects manifest content scripts only into pages loaded after the install;
 * an extension that wants the tabs already open injects into them itself
 * (`chrome.scripting`), which many, 1Password among them, do not. A reload is
 * what the person would otherwise have to do, so it is done only where it
 * takes nothing (`keepsOpenTab`, `hasUnsavedInput`), and the rest are left
 * as they are, to pick the extension up on their next load.
 */
export async function reloadOpenTabsFor(extension: {
  id: string;
  manifest: unknown;
  name: string;
}): Promise<void> {
  const matches = contentScriptMatches(extension.manifest);
  if (matches.length === 0) {
    return;
  }
  const now = Date.now();
  const kept: string[] = [];
  let reloaded = 0;
  for (const record of guests.records()) {
    const { contents, entry } = record;
    if (record.role !== "webview" || !entry || contents.isDestroyed()) {
      continue;
    }
    const reason =
      keepsOpenTab(
        {
          agentCommandAt: entry.lastAgentCommandAt,
          driven: await isDrivenByWorkingAgent(entry.targetId).catch(
            () => true,
          ),
          editing: record.edit !== null,
          fullScreen: record.htmlFullScreen,
          playing: contents.isCurrentlyAudible(),
          url: contents.getURL(),
        },
        matches,
        now,
      ) ?? ((await hasUnsavedInput(contents)) ? "it has unsaved input" : null);
    if (reason !== null) {
      kept.push(`${entry.targetId} (${reason})`);
      continue;
    }
    if (!contents.isDestroyed()) {
      contents.reload();
      reloaded += 1;
    }
  }
  log.info(
    `extension ${extension.name} id=${extension.id} installed: reloaded ${reloaded} open tabs${kept.length > 0 ? `, left ${kept.join(", ")}` : ""}`,
  );
}
