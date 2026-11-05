import { type ScreenView } from "@/client/atoms/window";
import { type SettingsTab } from "@/client/atoms/settings-modal";
import { recordWindowAction, type WindowAction } from "@/client/lib/actions";
import { type ChatId } from "@instrument-org/workspace/client";
import { useEffect, useState } from "react";

import { matchScreen } from "./window-href";

/**
 * How long a screen stays in front before the action log hears of it. The
 * Files address moves with every selection and every key typed in its
 * search, so what counts is where the person stopped.
 */
export const SCREEN_SETTLE_MS = 1500;

/**
 * The screen in front as the action log keeps it: Settings while it is
 * open, then what the tab in view says it shows (a folder and what is
 * selected in it, Apps, Tasks), then what its address names (a chat, an
 * app's page). Nothing for a file or a page, which the app's history
 * records as they are opened, a new tab, or a screen not listed here.
 */
export function screenActionOf({
  appName,
  chatTitle,
  folderPath,
  href,
  settingsTab,
  view,
}: {
  appName: (slug: string) => string | undefined;
  chatTitle: (chat: ChatId) => string | undefined;
  /** The folder on screen by its path on this computer, when the tab in view says. */
  folderPath?: string;
  href: string;
  /** The page Settings is at, while it is open. */
  settingsTab?: SettingsTab;
  view: null | ScreenView;
}): null | WindowAction {
  if (settingsTab) {
    return { kind: "screen", name: `Settings › ${settingsTab}` };
  }
  if (view?.file) {
    return null;
  }
  if (view?.folder) {
    const { selected } = view.folder;
    return {
      kind: "folder",
      path: folderPath ?? view.folder.display,
      ...(selected.length > 0 ? { selected } : {}),
    };
  }
  if (view?.screen === "apps") {
    return {
      kind: "screen",
      name: view.app ? `Apps › ${view.app.name}` : "Apps",
    };
  }
  if (view?.screen === "task" && view.task) {
    return { kind: "screen", name: `Tasks › ${view.task.title}` };
  }
  const screen = matchScreen(href);
  switch (screen.kind) {
    case "app": {
      return {
        kind: "screen",
        name: `Apps › ${appName(screen.slug) ?? screen.slug}`,
      };
    }
    case "apps": {
      return { kind: "screen", name: "Apps" };
    }
    case "chat": {
      // Its title is waited for, so the line names the chat as the person
      // knows it.
      const title = chatTitle(screen.chat);
      return title === undefined
        ? null
        : { id: screen.chat, kind: "chat", title };
    }
    case "task":
    case "tasks": {
      return { kind: "screen", name: "Tasks" };
    }
    default: {
      return null;
    }
  }
}

/**
 * Hands on what has stayed in front for `delayMs`, once: what was in front
 * for less is passed over, and the same thing settling again with nothing
 * else settled between is not handed on twice. Nothing settling (a new tab,
 * a page) counts as something else, so coming back from it is handed on.
 */
export function createScreenSettler<T>({
  delayMs,
  onSettled,
}: {
  delayMs: number;
  onSettled: (value: T) => void;
}) {
  let shown: string | undefined;
  let settled: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const keyOf = (value: null | T) =>
    value === null ? "" : JSON.stringify(value);
  return {
    /** What is in front now, null for nothing the log keeps. */
    see(value: null | T) {
      const key = keyOf(value);
      if (key === shown) {
        return;
      }
      shown = key;
      clearTimeout(timer);
      timer = undefined;
      if (key === settled) {
        return;
      }
      timer = setTimeout(() => {
        timer = undefined;
        settled = key;
        if (value !== null) {
          onSettled(value);
        }
      }, delayMs);
    },
    stop() {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}

/** Tells the action log the screen in front, once it has settled. */
export function useRecordScreen(action: null | WindowAction) {
  const [settler] = useState(() =>
    createScreenSettler<WindowAction>({
      delayMs: SCREEN_SETTLE_MS,
      onSettled: recordWindowAction,
    }),
  );
  useEffect(() => {
    settler.see(action);
  }, [action, settler]);
  useEffect(
    () => () => {
      settler.stop();
    },
    [settler],
  );
}
