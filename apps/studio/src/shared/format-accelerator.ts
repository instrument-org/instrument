/**
 * Electron accelerators written the way a given system writes keys, for any
 * process: the windows read theirs through `client/lib/format-accelerator.ts`,
 * and the page editor's guest page through the system its boot names.
 */
import { type Os, OS_CONVENTIONS } from "@/shared/os-conventions";
import {
  resolveAccelerator,
  type ShortcutAccelerator,
} from "@/shared/shortcuts";

type ModifierKind = "alt" | "command" | "control" | "shift";

// Electron modifier names, mapped to the kind each one means. `CmdOrCtrl` is
// the one that depends on the platform, so it's resolved separately.
const MODIFIERS: Record<string, ModifierKind | undefined> = {
  Alt: "alt",
  Cmd: "command",
  Command: "command",
  Control: "control",
  Ctrl: "control",
  Meta: "command",
  Option: "alt",
  Shift: "shift",
  Super: "command",
};

// Every platform reads control-ish first and the command key last, so one
// order covers ⌃⌥⇧⌘ and Ctrl+Alt+Shift+Win alike.
const MODIFIER_ORDER: ModifierKind[] = ["control", "alt", "shift", "command"];

// Only keys whose Electron name isn't what a user should read. Symbols are kept
// to the arrows, the modifiers, and a Mac's Return: a guide is read, not
// decoded, so `Tab` and `Esc` stay words. Return is the system's
// (`os-conventions.ts`).
const KEY_LABELS: Record<string, string | undefined> = {
  Down: "↓",
  Esc: "Esc",
  Escape: "Esc",
  Left: "←",
  Plus: "+",
  Right: "→",
  Space: "Space",
  Up: "↑",
};

/**
 * Splits an Electron accelerator into the keys to draw, in the order `os`
 * writes them: `CmdOrCtrl+Shift+T` is `["⇧", "⌘", "T"]` on macOS and
 * `["Ctrl", "Shift", "T"]` everywhere else. One token per `<Kbd>`.
 */
export function formatAcceleratorFor({
  accelerator,
  os,
}: {
  accelerator: ShortcutAccelerator;
  os: Os;
}): string[] {
  const isMac = os === "mac";
  const parts = resolveAccelerator(accelerator, { isMac }).split("+");
  const modifiers: ModifierKind[] = [];
  const keys: string[] = [];

  const { modifierKeys, returnKey } = OS_CONVENTIONS[os];
  for (const part of parts) {
    const modifier = modifierKind(part, isMac);
    if (modifier && !modifiers.includes(modifier)) {
      modifiers.push(modifier);
      continue;
    }
    keys.push(
      part === "Enter" || part === "Return"
        ? returnKey
        : (KEY_LABELS[part] ?? formatKey(part)),
    );
  }

  const modifierLabels = MODIFIER_ORDER.filter((kind) =>
    modifiers.includes(kind),
  ).map((kind) => modifierKeys[kind]);

  return [...modifierLabels, ...keys];
}

/**
 * The accelerator as one string for running text: `⇧⌘T` on macOS, where the
 * symbols run together, and `Ctrl+Shift+T` everywhere else, where words need
 * the plus between them.
 */
export function formatAcceleratorTextFor({
  accelerator,
  os,
}: {
  accelerator: ShortcutAccelerator;
  os: Os;
}) {
  return formatAcceleratorFor({ accelerator, os }).join(
    OS_CONVENTIONS[os].keyJoiner,
  );
}

// Letters read as capitals (`⌘T`), and anything longer keeps the name Electron
// gave it (`F11`).
function formatKey(key: string) {
  return key.length === 1 ? key.toUpperCase() : key;
}

function modifierKind(part: string, isMac: boolean): ModifierKind | undefined {
  if (part === "CmdOrCtrl" || part === "CommandOrControl") {
    return isMac ? "command" : "control";
  }
  return MODIFIERS[part];
}
