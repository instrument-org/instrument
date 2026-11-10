import { appTabsAtom } from "@/client/components/window/app-tabs";
import { matchScreen } from "@/client/components/window/window-href";
import { zoomAtom } from "@/client/atoms/zoom";
import { type Capture, type CaptureContext } from "@/shared/captures";
import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { atom, getDefaultStore, useAtomValue } from "jotai";

/** The newest capture, shown in the corner until it is put away. */
export const captureThumbnailAtom = atom<Capture | null>(null);

/** The capture open in the editor. */
export const captureEditorAtom = atom<Capture | null>(null);

/**
 * Bumped whenever a capture is taken, edited or reverted. The list is read
 * under it, since the strip, the editor and Send feedback can each sit under
 * a query client of their own.
 */
const capturesVersionAtom = atom(0);

export function capturesChanged() {
  const store = getDefaultStore();
  store.set(capturesVersionAtom, store.get(capturesVersionAtom) + 1);
}

/** The captures in the folder, newest first, read again whenever one changes. */
export function useCaptures() {
  const version = useAtomValue(capturesVersionAtom);
  const { data = [] } = useQuery({
    ...rpcClient.captures.list.queryOptions(),
    queryKey: [...rpcClient.captures.list.queryKey(), version],
  });
  return data;
}

/** Bumped to ask the window's capture layer for a capture. */
export const captureRequestAtom = atom(0);

/** Takes a capture of this window as it is drawn now. */
export function requestCapture() {
  const store = getDefaultStore();
  store.set(captureRequestAtom, store.get(captureRequestAtom) + 1);
}

export function openCaptureEditor(capture: Capture) {
  getDefaultStore().set(captureEditorAtom, capture);
}

/** Marks what the capture UI draws, so a capture's elements leave it out. */
export const CAPTURE_UI_ATTRIBUTE = "data-capture-ui";

/** The most elements a capture records. */
const MAX_ELEMENTS = 3000;
/** The smallest side an element needs to be worth snapping a crop to. */
const MIN_SIDE = 12;

const SCREEN_NAMES: Record<string, string> = {
  activity: "Activity",
  app: "App",
  apps: "Apps",
  browser: "Browser",
  chat: "Chat",
  chatLink: "Chat",
  chatOfSession: "Chat",
  computer: "Files",
  debug: "Debug",
  extensions: "Extensions",
  inbox: "Chats",
  memory: "Memory",
  namedScreen: "Screen",
  newTab: "New tab",
  releaseNotes: "Release notes",
  setting: "Settings",
  site: "Browser",
  skill: "Skill",
  task: "Task",
};

/** What an element is called in a capture: its label, its role, or its tag and first words. */
function elementLabel(element: Element) {
  const aria = element.getAttribute("aria-label");
  if (aria) {
    return aria.slice(0, 80);
  }
  const role = element.getAttribute("role");
  const slot = element.getAttribute("data-slot");
  const words = (element.textContent ?? "").replaceAll(/\s+/g, " ").trim();
  const kind = role ?? slot ?? element.tagName.toLowerCase();
  return words ? `${kind}: ${words.slice(0, 60)}` : kind;
}

/** Every sizable element on screen, outermost first, in on-screen pixels. */
function elementsOnScreen(): CaptureContext["elements"] {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const found: CaptureContext["elements"] = [];
  for (const element of document.body.querySelectorAll("*")) {
    if (found.length >= MAX_ELEMENTS) {
      break;
    }
    if (element.closest(`[${CAPTURE_UI_ATTRIBUTE}]`)) {
      continue;
    }
    const rect = element.getBoundingClientRect();
    if (
      rect.width < MIN_SIDE ||
      rect.height < MIN_SIDE ||
      rect.right <= 0 ||
      rect.bottom <= 0 ||
      rect.left >= width ||
      rect.top >= height
    ) {
      continue;
    }
    const x = Math.max(0, rect.left);
    const y = Math.max(0, rect.top);
    found.push({
      h: Math.min(height, rect.bottom) - y,
      label: elementLabel(element),
      w: Math.min(width, rect.right) - x,
      x,
      y,
    });
  }
  return found;
}

/** What the window says about itself for a capture taken now. */
export function captureContext({
  theme,
  workspace,
}: {
  theme: "dark" | "light";
  workspace?: string;
}): CaptureContext {
  const store = getDefaultStore();
  const tabs = store.get(appTabsAtom);
  const tab = tabs.tabs.find((each) => each.id === tabs.selectedId);
  const screen = tab ? matchScreen(tab.pathname) : undefined;
  const chatId = screen?.kind === "chat" ? screen.chat : undefined;
  return {
    ...(chatId && { chatId }),
    elements: elementsOnScreen(),
    screen: (screen && SCREEN_NAMES[screen.kind]) ?? "Window",
    theme,
    viewport: { height: window.innerHeight, width: window.innerWidth },
    ...(workspace && { workspace }),
    zoom: store.get(zoomAtom),
  };
}

/** Waits for the window to draw what was just changed. */
export function nextPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}
