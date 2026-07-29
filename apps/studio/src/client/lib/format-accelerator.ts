import { isMacOS } from "@/client/lib/utils";
import {
  resolveAccelerator,
  type ShortcutAccelerator,
} from "@/shared/shortcuts";

type ModifierKind = "alt" | "cmd" | "ctrl" | "shift";

// Electron modifier names, mapped to the kind each one means. `CmdOrCtrl` is
// the one that depends on the platform, so it's resolved separately.
const MODIFIERS: Record<string, ModifierKind | undefined> = {
  Alt: "alt",
  Cmd: "cmd",
  Command: "cmd",
  Control: "ctrl",
  Ctrl: "ctrl",
  Meta: "cmd",
  Option: "alt",
  Shift: "shift",
  Super: "cmd",
};

// Both platforms read control-ish first and the command key last, so one order
// covers ⌃⌥⇧⌘ and Ctrl+Alt+Shift+Win alike.
const MODIFIER_ORDER: ModifierKind[] = ["ctrl", "alt", "shift", "cmd"];

const MAC_MODIFIER_SYMBOLS: Record<ModifierKind, string> = {
  alt: "⌥",
  cmd: "⌘",
  ctrl: "⌃",
  shift: "⇧",
};

const OTHER_MODIFIER_LABELS: Record<ModifierKind, string> = {
  alt: "Alt",
  cmd: "Win",
  ctrl: "Ctrl",
  shift: "Shift",
};

// Only keys whose Electron name isn't what a user should read. Symbols are kept
// to the arrows and the modifiers: a guide is read, not decoded, so `Tab` and
// `Esc` stay words.
const KEY_LABELS: Record<string, string | undefined> = {
  Down: "↓",
  Enter: "Enter",
  Esc: "Esc",
  Escape: "Esc",
  Left: "←",
  Plus: "+",
  Return: "Enter",
  Right: "→",
  Space: "Space",
  Up: "↑",
};

/**
 * Splits an Electron accelerator into the keys to draw, in the order the
 * platform writes them: `CmdOrCtrl+Shift+T` is `["⇧", "⌘", "T"]` on macOS and
 * `["Ctrl", "Shift", "T"]` everywhere else. One token per `<Kbd>`.
 */
export function formatAccelerator(accelerator: ShortcutAccelerator): string[] {
  return formatAcceleratorFor({ accelerator, isMac: isMacOS() });
}

// Platform is a parameter so the mapping is testable off a real window.
export function formatAcceleratorFor({
  accelerator,
  isMac,
}: {
  accelerator: ShortcutAccelerator;
  isMac: boolean;
}): string[] {
  const parts = resolveAccelerator(accelerator, { isMac }).split("+");
  const modifiers: ModifierKind[] = [];
  const keys: string[] = [];

  for (const part of parts) {
    const modifier = modifierKind(part, isMac);
    if (modifier && !modifiers.includes(modifier)) {
      modifiers.push(modifier);
      continue;
    }
    keys.push(KEY_LABELS[part] ?? formatKey(part));
  }

  const modifierLabels = MODIFIER_ORDER.filter((kind) =>
    modifiers.includes(kind),
  ).map((kind) =>
    isMac ? MAC_MODIFIER_SYMBOLS[kind] : OTHER_MODIFIER_LABELS[kind],
  );

  return [...modifierLabels, ...keys];
}

// Letters read as capitals (`⌘T`), and anything longer keeps the name Electron
// gave it (`F11`).
function formatKey(key: string) {
  return key.length === 1 ? key.toUpperCase() : key;
}

function modifierKind(part: string, isMac: boolean): ModifierKind | undefined {
  if (part === "CmdOrCtrl" || part === "CommandOrControl") {
    return isMac ? "cmd" : "ctrl";
  }
  return MODIFIERS[part];
}
