/**
 * How a text file's bytes become text, and which of them the app can write
 * back. A byte-order mark names UTF-8 or UTF-16 outright, and bytes that are
 * all valid UTF-8 are UTF-8. Anything else is in an older encoding that
 * nothing in the file names, so it is read in the one its characters fit
 * best (`guessLegacyEncoding`), and never written: the guess can be wrong,
 * and `TextEncoder` writes only UTF-8.
 */

/** The encodings a file's text is written back in. */
export type SaveableEncoding = "utf-16be" | "utf-16le" | "utf-8";

export interface FileText {
  encoding: string;
  /** Whether writing `text` back in `encoding` gives the file's own bytes. */
  saveable: boolean;
  /** The text, with any byte-order mark kept as a leading U+FEFF. */
  text: string;
}

const BOM = "\uFEFF";

/** How much of a file the guess at an older encoding reads. */
const GUESS_BYTES = 64 * 1024;

/**
 * `cut` says the bytes are only the start of the file, so a character the
 * cut splits is left out rather than read as a byte no encoding has.
 */
export function decodeFileText(bytes: Uint8Array, cut = false): FileText {
  const utf16 =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? "utf-16le"
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? "utf-16be"
        : null;
  const encoding = utf16 ?? "utf-8";
  const strict = decodeStrict(encoding, bytes, cut);
  if (strict !== null) {
    return { encoding, saveable: true, text: strict };
  }
  if (utf16) {
    return { encoding, saveable: false, text: decodeLoose(utf16, bytes) };
  }
  const legacy = guessLegacyEncoding(bytes.subarray(0, GUESS_BYTES));
  return {
    encoding: legacy,
    saveable: false,
    text: decodeLoose(legacy, bytes),
  };
}

/** A file's text for a view that only shows it: no byte-order mark. */
export function textToShow(bytes: Uint8Array, cut = false): string {
  const { text } = decodeFileText(bytes, cut);
  return text.startsWith(BOM) ? text.slice(1) : text;
}

/** A file's bytes for its text, in the encoding it was read in. */
export function encodeFileText(
  text: string,
  encoding: SaveableEncoding,
): Uint8Array {
  if (encoding === "utf-8") {
    return new TextEncoder().encode(text);
  }
  // A UTF-16 file is only ever read from one with a byte-order mark.
  const units = text.startsWith(BOM) ? text : BOM + text;
  const bytes = new Uint8Array(units.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < units.length; i++) {
    view.setUint16(i * 2, units.charCodeAt(i), encoding === "utf-16le");
  }
  return bytes;
}

export function isSaveableEncoding(
  encoding: string,
): encoding is SaveableEncoding {
  return (
    encoding === "utf-8" || encoding === "utf-16le" || encoding === "utf-16be"
  );
}

/**
 * The older encoding bytes that are not UTF-8 read best in: Japanese,
 * Korean or Chinese when the text comes out in that script's own characters,
 * Cyrillic when it comes out in whole Cyrillic words, and Windows-1252
 * (Western European) otherwise, which reads any byte.
 */
function guessLegacyEncoding(bytes: Uint8Array): string {
  // Japanese is written mostly in kana, which Chinese text read as Japanese
  // has almost none of.
  for (const encoding of ["shift_jis", "euc-jp"]) {
    const text = decodeStrict(encoding, bytes, true);
    if (text !== null && fits(text, isKana, 0.3)) {
      return encoding;
    }
  }
  const korean = decodeStrict("euc-kr", bytes, true);
  if (korean !== null && fits(korean, isHangul, 0.8)) {
    return "euc-kr";
  }
  // Big5 text read as GB18030 lands outside GB2312's rows, where the
  // characters people write are.
  const chinese = decodeStrict("gb18030", bytes, true);
  if (chinese !== null && fits(chinese, isHan, 0.9) && inGb2312(bytes)) {
    return "gb18030";
  }
  const traditional = decodeStrict("big5", bytes, true);
  if (traditional !== null && fits(traditional, isHan, 0.9)) {
    return "big5";
  }
  const cyrillic = decodeStrict("windows-1251", bytes, true);
  if (
    cyrillic !== null &&
    fits(cyrillic, isCyrillic, 0.8) &&
    meanHighRun(bytes) >= 3
  ) {
    return "windows-1251";
  }
  return "windows-1252";
}

function decodeStrict(encoding: string, bytes: Uint8Array, stream = false) {
  try {
    // `stream` lets a character cut off where a sample ends go unread.
    return new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(
      bytes,
      { stream },
    );
  } catch {
    return null;
  }
}

function decodeLoose(encoding: string, bytes: Uint8Array) {
  return new TextDecoder(encoding, { ignoreBOM: true }).decode(bytes);
}

/**
 * Whether at least `share` of the text's characters past ASCII pass `test`,
 * and few sit inside a Latin word: an accented letter in Western text, read
 * in a two-byte encoding, takes the letter after it into a character of the
 * script, between two ASCII letters where that script's text never puts one.
 */
function fits(text: string, test: (code: number) => boolean, share: number) {
  const chars = Array.from(text);
  let wide = 0;
  let passing = 0;
  let inWord = 0;
  chars.forEach((char, i) => {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) {
      return;
    }
    wide++;
    if (test(code)) {
      passing++;
    }
    if (isLetter(chars[i - 1]) && isLetter(chars[i + 1])) {
      inWord++;
    }
  });
  return wide > 0 && passing / wide >= share && inWord / wide < 0.2;
}

function isLetter(char: string | undefined) {
  return char !== undefined && /^[A-Za-z]$/.test(char);
}

function isKana(code: number) {
  return code >= 0x30_40 && code <= 0x30_ff;
}

function isHangul(code: number) {
  return code >= 0xac_00 && code <= 0xd7_a3;
}

/** Ideographs, and the punctuation and full-width forms written with them. */
function isHan(code: number) {
  return (
    (code >= 0x4e_00 && code <= 0x9f_ff) ||
    (code >= 0x30_00 && code <= 0x30_3f) ||
    (code >= 0xff_00 && code <= 0xff_60)
  );
}

function isCyrillic(code: number) {
  return code >= 0x04_00 && code <= 0x04_ff;
}

/** Whether nearly every two-byte character is in GB2312's rows, A1-F7 by A1-FE. */
function inGb2312(bytes: Uint8Array) {
  let pairs = 0;
  let inRows = 0;
  for (let i = 0; i < bytes.length; i++) {
    const lead = bytes[i] ?? 0;
    if (lead < 0x81) {
      continue;
    }
    const trail = bytes[i + 1] ?? 0;
    pairs++;
    if (lead >= 0xa1 && lead <= 0xf7 && trail >= 0xa1 && trail <= 0xfe) {
      inRows++;
    }
    i++;
  }
  return pairs > 0 && inRows / pairs >= 0.95;
}

/**
 * How long a run of bytes past ASCII is on average: a whole word in a
 * Cyrillic encoding, one accented letter at a time in a Western one.
 */
function meanHighRun(bytes: Uint8Array) {
  let runs = 0;
  let total = 0;
  let run = 0;
  for (let i = 0; i <= bytes.length; i++) {
    if ((bytes[i] ?? 0) >= 0x80) {
      run++;
    } else if (run > 0) {
      runs++;
      total += run;
      run = 0;
    }
  }
  return runs === 0 ? 0 : total / runs;
}
