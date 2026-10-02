// `ignoreBOM` keeps a leading byte-order mark in the text, as `readFile(path, "utf8")`
// does, so an editor that writes one back still sees it.
const strict = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * A file's bytes as text when they are UTF-8, or null when they are not.
 * A file in another encoding (a Windows-1252 note, a Latin-1 page) decodes
 * leniently into replacement characters, and writing that text back would
 * replace every byte it could not read, so an editor that saves must know.
 */
export function utf8Text(bytes: Uint8Array): null | string {
  try {
    return strict.decode(bytes);
  } catch {
    return null;
  }
}
