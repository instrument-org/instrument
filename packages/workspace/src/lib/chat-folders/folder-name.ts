import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { UNTITLED_CHAT_TITLE } from "../../constants";

/**
 * What a folder a person opens is called, in `Chats/` or in any other of the
 * six: the name it is for, spelled so that every system and every sync engine
 * can carry it, with a number on the end where the name is already taken.
 *
 * The rules are the ones a name has to keep to travel: iCloud Drive, Dropbox
 * and OneDrive each carry a folder to Windows, which refuses the characters
 * below and a handful of device names, and a deep path inside the folder has
 * to fit under Windows' own limit, which is what the length cap leaves room
 * for.
 */

/**
 * What a name may not hold: the characters Windows refuses, the control
 * characters, and `$`, which no system minds. The `$` is ours. A chat called
 * "Quiet dishwashers under $900" would otherwise name a folder the shell
 * expands, and the agent reaches that folder by running commands over it.
 */
// oxlint-disable-next-line no-control-regex -- the characters a name may not hold
const ILLEGAL = /["$*/:<>?\\|\u0000-\u001F]/g;

/**
 * The device names Windows keeps, which it refuses as a name whatever
 * follows the first dot (`NUL.txt` is `NUL`).
 */
const RESERVED = /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i;

/**
 * How long a folder's name may run, and with it the title the folder is named
 * from. Short enough that the deepest path a chat's own files reach inside it
 * still fits in the 260 characters Windows allows a path, under a synced
 * folder of the person's own choosing.
 */
const MAX_LENGTH = 80;

/**
 * The name with a number on the end, the way the Finder numbers a copy:
 * `Dinner 2`, then `Dinner 3`. The words are cut back to leave room for the
 * number, so a numbered name is still under the cap.
 */
export function numberedName(base: string, suffix: number): string {
  const tail = ` ${suffix.toString()}`;
  return `${trimmed(base.slice(0, MAX_LENGTH - tail.length))}${tail}`;
}

/**
 * A title as a name a folder may carry, before anything is asked about what
 * is already there: refused characters out, leading dots gone, nothing
 * trailing that a system would drop on its own, and the words cut at the
 * length cap on a space where there is one near the end.
 *
 * Normalized to the composed form, so a name written here and a name read
 * back from a folder listing compare equal on a system that stores the
 * decomposed one.
 */
export function safeName(title: string | undefined): string {
  const spelled = trimmed(
    (title ?? "")
      .normalize("NFC")
      .replaceAll(ILLEGAL, " ")
      .replaceAll(/\s+/g, " ")
      .replace(/^\.+/, "")
      .trim(),
  );
  if (spelled === "") {
    return UNTITLED_CHAT_TITLE;
  }
  const cut = trimmed(atWordBoundary(spelled, MAX_LENGTH));
  // A name a system keeps for a device is not one a folder may have, and a
  // trailing underscore is the shortest thing that makes it a name again.
  return cut === "" || RESERVED.test(cut) ? `${cut}_` : cut;
}

/**
 * A chat's title, held to the same length its folder's name is. The folder is
 * named from the title, so a title that ran past the cap would leave the app
 * and the disk calling the chat two different things.
 *
 * Cut rather than refused, and cut at a word where one is near the end, as a
 * name is: someone who types two hundred characters keeps the first eighty.
 */
export function cappedTitle(title: string): string {
  return atWordBoundary(title, MAX_LENGTH);
}

/**
 * Makes a folder in `parentDir` under a free name from `base` and answers
 * with it. The name is taken by the act of making the folder, which the
 * system does in one step: a candidate another folder already holds fails,
 * and the next number is tried.
 *
 * Rather than listing what is there and picking what is free, because two
 * folders claiming one name at the same moment would both see it free and
 * share the folder they made.
 */
export async function claimFolderNamed(
  parentDir: string,
  base: string,
): Promise<{ name: string; path: string }> {
  await fs.mkdir(parentDir, { recursive: true });
  for (let suffix = 1; ; suffix += 1) {
    const name = suffix === 1 ? base : numberedName(base, suffix);
    const made = path.join(parentDir, name);
    try {
      await fs.mkdir(made);
      return { name, path: made };
    } catch (error) {
      if (!isTakenError(error)) {
        throw error;
      }
    }
  }
}

/**
 * {@link claimFolderNamed} without awaiting, for a caller that cannot: the
 * drafts the windows keep are written on a timer and again as the app quits,
 * and a quit runs no promise to its end.
 */
export function claimFolderNamedSync(
  parentDir: string,
  base: string,
): { name: string; path: string } {
  fsSync.mkdirSync(parentDir, { recursive: true });
  for (let suffix = 1; ; suffix += 1) {
    const name = suffix === 1 ? base : numberedName(base, suffix);
    const made = path.join(parentDir, name);
    try {
      fsSync.mkdirSync(made);
      return { name, path: made };
    } catch (error) {
      if (!isTakenError(error)) {
        throw error;
      }
    }
  }
}

/** Whether making the folder failed because something is already there. */
function isTakenError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "EEXIST" || error.code === "ENOTEMPTY")
  );
}

/**
 * The text cut to `maxLength`, at the last space before the cap where that
 * leaves most of the words, so a name ends on a word rather than mid-word.
 */
function atWordBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  const cut = text.slice(0, maxLength);
  const space = cut.lastIndexOf(" ");
  return space >= maxLength / 2 ? cut.slice(0, space) : cut;
}

/** The name without what a system drops from the end of one: dots and spaces. */
function trimmed(name: string): string {
  return name.replace(/[\s.]+$/, "");
}
