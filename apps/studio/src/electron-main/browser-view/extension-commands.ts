import {
  type Chord,
  parseAccelerator,
} from "@/electron-main/menus/match-accelerator";
import { formatAcceleratorTextFor } from "@/shared/format-accelerator";
import { type Os } from "@/shared/os-conventions";
import { z } from "zod";

/**
 * The commands that press the extension's button rather than reaching its
 * `chrome.commands.onCommand` listener: Manifest V3's action and V2's two.
 */
export const ACTION_COMMANDS: ReadonlySet<string> = new Set([
  "_execute_action",
  "_execute_browser_action",
  "_execute_page_action",
]);

/** The keys a shortcut may end in besides a letter or digit, as Electron names them. */
const NAMED_KEYS: Record<string, string> = {
  Comma: ",",
  Delete: "Delete",
  Down: "Down",
  End: "End",
  Home: "Home",
  Insert: "Insert",
  Left: "Left",
  PageDown: "PageDown",
  PageUp: "PageUp",
  Period: ".",
  Right: "Right",
  Space: "Space",
  Up: "Up",
};

/** The media keys, which Chrome takes only alone. */
const MEDIA_KEYS: Record<string, string> = {
  MediaNextTrack: "MediaNextTrack",
  MediaPlayPause: "MediaPlayPause",
  MediaPrevTrack: "MediaPreviousTrack",
  MediaStop: "MediaStop",
};

/** The order an accelerator is written in, which `format-accelerator.ts` reorders for display anyway. */
const MODIFIER_ORDER = ["Command", "Control", "Alt", "Shift"];

/**
 * A shortcut as a manifest's `suggested_key` writes it (`Ctrl+Shift+Y`,
 * `MacCtrl+Space`, `MediaPlayPause`), as the Electron accelerator it stands
 * for on `os`, or null for one Chrome would refuse: a modifier the system
 * has not, none of Ctrl, Alt, Command or MacCtrl, Ctrl with Alt (which is
 * AltGr), a media key with anything held, or a key outside Chrome's list.
 * `Ctrl` is Command on a Mac, as in Chrome.
 */
export function acceleratorOfShortcut(shortcut: string, os: Os): null | string {
  const parts = shortcut.split("+").map((part) => part.trim());
  const key = parts.pop() ?? "";
  const media = MEDIA_KEYS[key];
  if (media) {
    return parts.length === 0 ? media : null;
  }
  const held = new Set<string>();
  let hasCtrl = false;
  for (const part of parts) {
    const modifier =
      part === "Ctrl"
        ? os === "mac"
          ? "Command"
          : "Control"
        : part === "Command" && os === "mac"
          ? "Command"
          : part === "MacCtrl" && os === "mac"
            ? "Control"
            : part === "Alt" || part === "Shift"
              ? part
              : null;
    if (!modifier || held.has(modifier)) {
      return null;
    }
    hasCtrl ||= part === "Ctrl";
    held.add(modifier);
  }
  if (
    !["Alt", "Command", "Control"].some((modifier) => held.has(modifier)) ||
    (hasCtrl && held.has("Alt"))
  ) {
    return null;
  }
  const end = /^[A-Za-z0-9]$/.test(key) ? key.toUpperCase() : NAMED_KEYS[key];
  if (!end) {
    return null;
  }
  return [...MODIFIER_ORDER.filter((modifier) => held.has(modifier)), end].join(
    "+",
  );
}

const CommandSchema = z.object({
  description: z.string().catch(""),
  suggested_key: z
    .union([z.string(), z.record(z.string(), z.unknown())])
    .optional()
    .catch(undefined),
});

const CommandsManifestSchema = z.object({
  commands: z.record(z.string(), z.unknown()).catch({}),
});

/** One of an extension's commands, with the key that runs it here, if any. */
export type ExtensionCommand = {
  /** The Electron accelerator, or null for a command with no key here. */
  accelerator: null | string;
  description: string;
  extensionId: string;
  name: string;
};

/**
 * Every command of the extensions given, in the order they loaded, each with
 * its suggested key on `os` (the system's own entry, which Chrome names as `Os` does, else `default`) unless
 * an extension loaded before already took that chord, which is how Chrome
 * settles two asking for one. A key the person picks themselves, as Chrome's
 * shortcuts page lets them, has nowhere to be set yet, so a command with no
 * suggested key has none. A command's `global` flag is not honored: its key
 * runs it only while a page in the in-app browser has the keyboard.
 */
export function assignCommands(
  extensions: readonly { id: string; manifest: unknown }[],
  os: Os,
): ExtensionCommand[] {
  const isMac = os === "mac";
  const taken: Chord[] = [];
  const assigned: ExtensionCommand[] = [];
  for (const { id, manifest } of extensions) {
    const { commands } = CommandsManifestSchema.catch({ commands: {} }).parse(
      manifest,
    );
    for (const [name, value] of Object.entries(commands)) {
      const parsed = CommandSchema.safeParse(value);
      if (!parsed.success) {
        continue;
      }
      const suggested = parsed.data.suggested_key;
      const shortcut =
        typeof suggested === "string"
          ? suggested
          : [suggested?.[os], suggested?.["default"]].find(
              (candidate): candidate is string => typeof candidate === "string",
            );
      const accelerator =
        shortcut === undefined ? null : acceleratorOfShortcut(shortcut, os);
      const chord =
        accelerator === null ? null : parseAccelerator(accelerator, { isMac });
      const isFree =
        chord !== null && !taken.some((other) => isSameChord(other, chord));
      if (chord && isFree) {
        taken.push(chord);
      }
      assigned.push({
        accelerator: isFree ? accelerator : null,
        description: parsed.data.description,
        extensionId: id,
        name,
      });
    }
  }
  return assigned;
}

/** Whether two chords are pressed the same way. */
export function isSameChord(a: Chord, b: Chord): boolean {
  return (
    a.alt === b.alt &&
    a.control === b.control &&
    a.meta === b.meta &&
    a.on === b.on &&
    a.value === b.value &&
    (a.shift === b.shift || !a.comparesShift || !b.comparesShift)
  );
}

/** Whether an accelerator is pressed the same way as any of `others`. */
export function collidesWith(
  accelerator: string,
  others: readonly string[],
  os: Os,
): boolean {
  const isMac = os === "mac";
  const chord = parseAccelerator(accelerator, { isMac });
  return (
    chord !== null &&
    others.some((other) => {
      const parsed = parseAccelerator(other, { isMac });
      return parsed !== null && isSameChord(chord, parsed);
    })
  );
}

/**
 * A command as `chrome.commands.getAll` reports it: its shortcut written the
 * way the system writes keys (`⇧⌘Y`, `Ctrl+Shift+Y`), empty when it has none.
 */
export function reportedCommand(
  command: ExtensionCommand,
  os: Os,
): { description: string; name: string; shortcut: string } {
  return {
    description: command.description,
    name: command.name,
    shortcut:
      command.accelerator === null
        ? ""
        : formatAcceleratorTextFor({ accelerator: command.accelerator, os }),
  };
}
