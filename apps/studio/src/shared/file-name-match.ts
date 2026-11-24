/**
 * How well a file's name answers the words a person typed, lower being
 * better: the name is the words exactly, the name starts with them, each
 * word starts a word of the name, or each word is somewhere inside it.
 */
export type FileNameMatchRank = 0 | 1 | 2 | 3;

/**
 * Text as names are compared: composed the one way (a Mac's disk spells an
 * accented letter as two characters) and lowercased, so case and spelling
 * of accents never keep a name from being found.
 */
export function foldFileName(text: string): string {
  return text.normalize("NFC").toLowerCase();
}

/** The words a person typed, folded as names are, in the order typed. */
export function fileNameWords(typed: string): string[] {
  return foldFileName(typed)
    .split(/\s+/)
    .filter((word) => word !== "");
}

/**
 * The whole rule for which names a search finds and in what order, and the
 * one place to change it. `name` is a folded name (`foldFileName`) and
 * `words` are folded words (`fileNameWords`).
 *
 * Every word has to be in the name in one piece; letters scattered through
 * a name never match. Undefined where a word is missing, or no word was
 * typed.
 */
export function fileNameMatchRank(
  name: string,
  words: readonly string[],
): FileNameMatchRank | undefined {
  if (words.length === 0 || !words.every((word) => name.includes(word))) {
    return undefined;
  }
  const typed = words.join(" ");
  if (name === typed) {
    return 0;
  }
  if (name.startsWith(typed)) {
    return 1;
  }
  return words.every((word) => startsAWord(name, word)) ? 2 : 3;
}

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** Whether `word` is in `name` at the name's start or right after a separator. */
function startsAWord(name: string, word: string): boolean {
  for (
    let at = name.indexOf(word);
    at !== -1;
    at = name.indexOf(word, at + 1)
  ) {
    if (at === 0 || !LETTER_OR_DIGIT.test(name[at - 1] ?? "")) {
      return true;
    }
  }
  return false;
}
