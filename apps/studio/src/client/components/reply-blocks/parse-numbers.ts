import { plainTextOf } from "./plain-text";

export interface Figure {
  /**
   * Whether the value is words more than a figure ("about $0.19 per kWh
   * every month"), which reads at the text's size rather than a figure's.
   */
  isWords?: boolean;
  label: string;
  note?: string;
  value: string;
}

/** Longer than this, a value is a phrase however much of it is numbers. */
const FIGURE_MAX_LENGTH = 14;

/**
 * Whether a value reads as words: longer than a figure, three words or more,
 * or two words and no number ("In unit").
 */
export const isWordsValue = (value: string) => {
  const text = plainTextOf(value);
  const words = text.split(/\s+/).filter((word) => /^\p{L}{2,}/u.test(word));
  return (
    text.length > FIGURE_MAX_LENGTH ||
    words.length >= 3 ||
    (words.length >= 2 && !/\d/.test(text))
  );
};

// `Revenue: $48,200 (up 12% from Q2)`. The label may be bold and the line a
// bullet; the colon may sit inside the bold.
const FIGURE =
  /^(?:[-*+]\s+|\d+[.)]\s+)?(\*\*|__)?(?<label>[^:*_]+?)(?::\1|\1:|:)\s+(?<value>.+?)(?:\s+\((?<note>[^()]+)\)|\s+[—–-]\s+(?<dash>.+))?$/u;

// A minus written as a hyphen, or with a space after it, in front of an
// amount, which a figure's size shows as the minus sign it means: `-$1,240`
// and `− $45` are `−$1,240` and `−$45`.
const NEGATIVE_SIGN = /^[-−]\s*(?=[$€£¥\d.])/u;

/**
 * Reads a numbers block: one figure per line. A line that is not one is kept
 * in order, to be drawn as Markdown under the figures.
 */
export function parseNumbers(body: string): {
  figures: Figure[];
  rest: string[];
} {
  const figures: Figure[] = [];
  const rest: string[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (line === "") {
      continue;
    }
    const groups = FIGURE.exec(line)?.groups;
    if (!groups?.label || !groups.value) {
      rest.push(line);
      continue;
    }
    const note = groups.note ?? groups.dash;
    const value = groups.value
      .replace(/^(\*\*|__)(.*)\1$/, "$2")
      .trim()
      .replace(NEGATIVE_SIGN, "−");
    figures.push({
      label: groups.label.trim(),
      value,
      ...(note ? { note: note.trim() } : {}),
      ...(isWordsValue(value) ? { isWords: true } : {}),
    });
  }
  return { figures, rest };
}
