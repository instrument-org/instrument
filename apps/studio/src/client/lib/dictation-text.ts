/**
 * Puts dictated words at the end of what is already written, after a space
 * on the same line, so several takes in a row read as one run of sentences.
 * Nothing already written is replaced: trailing spaces on the last line give
 * way to the one space, and a box that ends on a fresh line is written on.
 */
export function appendDictatedText(existing: string, dictated: string): string {
  const words = dictated.trim();
  if (!words) {
    return existing;
  }
  const base = existing.replace(/[ \t]+$/, "");
  if (!base.trim()) {
    return words;
  }
  return base.endsWith("\n") ? base + words : `${base} ${words}`;
}

/**
 * {@link appendDictatedText} for a box that holds at most `maxLength`
 * characters: what fits of the dictated words, ending on a whole word where
 * there is one, and whether any had to be left out.
 */
export function appendDictatedTextWithin(
  existing: string,
  dictated: string,
  maxLength: number,
): { text: string; trimmed: boolean } {
  const whole = appendDictatedText(existing, dictated);
  if (whole.length <= maxLength) {
    return { text: whole, trimmed: false };
  }
  // How long what is there gets once it makes room for the words.
  const lead = appendDictatedText(existing, "x").length - 1;
  const words = dictated.trim();
  const room = maxLength - lead;
  if (room <= 0) {
    return { text: existing, trimmed: true };
  }
  const cut = words.slice(0, room);
  const atWord = /\s/.test(words[room] ?? " ")
    ? cut
    : cut.replace(/\s+\S*$/, "") || cut;
  return { text: appendDictatedText(existing, atWord), trimmed: true };
}
