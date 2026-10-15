import { UNTITLED_CHAT_TITLE } from "../../constants";

/**
 * What a chat's folder in `Chats/` is called: the chat's title, spelled so
 * that every system and every sync engine can carry the name, with a number
 * on the end where the name is already taken.
 *
 * The rules are the ones a name has to keep to travel: iCloud Drive, Dropbox
 * and OneDrive each carry a folder to Windows, which refuses the characters
 * below and a handful of device names, and a deep path inside the folder has
 * to fit under Windows' own limit, which is what the length cap leaves room
 * for.
 */

/** What Windows refuses in a name, with the control characters. */
// oxlint-disable-next-line no-control-regex -- the characters a name may not hold
const ILLEGAL = /["*/:<>?\\|\u0000-\u001F]/g;

/**
 * The device names Windows keeps, which it refuses as a name whatever
 * follows the first dot (`NUL.txt` is `NUL`).
 */
const RESERVED = /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i;

/**
 * How long a folder's name may run. Short enough that the deepest path a
 * chat's own files reach inside it still fits in the 260 characters Windows
 * allows a path, under a synced folder of the person's own choosing.
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
