import path from "node:path";

import { utf8Prefix } from "./utf8-byte-slice";

/** Under the 255-byte name limit of APFS, ext4 and NTFS, with room for a `-1` and the extension. */
const MAX_FILENAME_BASE_BYTES = 200;

/** Names Windows reserves for devices, with or without an extension. */
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com\d|lpt\d)$/i;

/**
 * A name for a file the person sent that every system can store and the
 * agent can type: their own name, in any script, without what a path or
 * Windows refuses.
 */
export function sanitizeFilename(filename: string): string {
  // The name after the last separator, `/` or `\`, whichever system sent it.
  const name = filename.slice(
    Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\")) + 1,
  );
  // `9.47.51 AM` has no extension, though `extname` reads `.51 AM` as one.
  const dotted = path.extname(name);
  const ext = /\s/.test(dotted) ? "" : dotted;
  const base = name.slice(0, name.length - ext.length);

  const sanitizedBase = utf8Prefix(
    sanitizeCharacters(base).replaceAll(/\s+/g, " ").replaceAll(/-{2,}/g, "-"),
    MAX_FILENAME_BASE_BYTES,
  )
    .trim()
    // Windows drops a trailing dot or space from a name.
    .replace(/[. ]+$/, "");

  const named = sanitizedBase || "file";
  return `${WINDOWS_DEVICE_NAME.test(named) ? `${named}_` : named}${sanitizeCharacters(ext)}`;
}

function sanitizeCharacters(str: string): string {
  return (
    str
      // One spelling of each letter, as the agent types it (macOS stores
      // names decomposed, é as e and a combining accent).
      .normalize("NFC")
      // Unicode whitespace (the narrow no-break space in a macOS screenshot's
      // name) as a regular space.
      .replaceAll(/[^\S ]/g, " ")
      // Control and invisible format characters (direction overrides,
      // zero-width spaces, but not the joiner inside an emoji), path
      // separators, and what Windows refuses in a name.
      .replaceAll(/(?!\u200D)[\p{Cc}\p{Cf}/\\<>:"|?*]/gu, "")
  );
}
