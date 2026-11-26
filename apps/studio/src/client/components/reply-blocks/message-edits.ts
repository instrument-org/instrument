/**
 * Text earlier in a chat that a message the agent wrote may be a new version
 * of: what the person sent, which also holds what they asked for, or the body
 * of a message the agent wrote before.
 */
export interface EditSource {
  from: "draft" | "person";
  /** A draft's subject, when it had one. */
  subject?: string;
  text: string;
}

/** A stretch of a revised message: words it kept, or new words and what they replaced. */
export type EditStretch =
  | { kind: "kept"; text: string }
  | {
      kind: "new";
      text: string;
      /** The original's words in their place; empty where nothing was. */
      was: string;
    };

/** A message found to be a new version of earlier text, and what changed. */
export interface MessageEdit {
  original: { body: string; subject?: string };
  /**
   * The revised body, whole, as kept and new stretches. Absent when most of
   * its words are new, a rewrite, where marking them would mark everything.
   */
  stretches?: readonly EditStretch[];
}

interface Word {
  end: number;
  /** What two words are compared by: lowercase, without the punctuation around them. */
  key: string;
  start: number;
  text: string;
}

/** Of the revised words, the share that must sit in shared runs of {@link RUN} or more. */
const IN_RUNS = 0.15;
/** Of the revised words, the share that must match at all. */
const MATCHED = 0.35;
/** The shortest run of shared words that says one text was made from another. */
const RUN = 3;
/** Past this share of new words, a revision is a rewrite and shows no marks. */
const REWRITE = 0.6;
/** Comparisons past this many word pairs are skipped rather than paid for. */
const MAX_CELLS = 2_000_000;

const SENTENCE_END = /[.!?:]["'”’)\]]*$/;
const ASKS = /[?:]["'”’)\]]*$/;

/**
 * The text a revised message body replaces, from `sources`, newest first: the
 * first one it shares enough words with, in long enough runs, to have been
 * made from it. From what the person sent, only the part the message was made
 * from is taken, so what they asked for around it is left out. Undefined when
 * nothing qualifies, or when the body is the text unchanged.
 */
export function findMessageEdit(
  revised: string,
  sources: readonly EditSource[],
): MessageEdit | undefined {
  const words = wordsOf(revised);
  if (words.length < RUN) {
    return undefined;
  }
  for (const source of sources) {
    const theirs = wordsOf(source.text);
    const pairs = sharedWords(words, theirs, (word) => word.key);
    if (!pairs || !madeFrom(pairs, words.length)) {
      continue;
    }
    const body =
      source.from === "draft"
        ? source.text.trim()
        : spanMadeFrom(source.text, theirs, pairs);
    if (body === revised.trim()) {
      return undefined;
    }
    return {
      original: {
        body,
        ...(source.subject !== undefined && { subject: source.subject }),
      },
      ...stretchesOf(revised, words, body),
    };
  }
  return undefined;
}

/**
 * The words of a text, with where each sits. Curly apostrophes compare as
 * straight ones, so a model's `don’t` keeps the person's `don't`.
 */
function wordsOf(text: string): Word[] {
  return [...text.matchAll(/\S+/g)].map((match) => {
    const word = match[0].replaceAll("’", "'");
    const bare = word
      .toLowerCase()
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    return {
      end: match.index + match[0].length,
      key: bare || word,
      start: match.index,
      text: word,
    };
  });
}

/**
 * The most words two texts share in the same order (their longest common
 * subsequence), as index pairs, or undefined when the texts are too long to
 * compare.
 */
function sharedWords(
  a: readonly Word[],
  b: readonly Word[],
  compareBy: (word: Word) => string,
): [number, number][] | undefined {
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_CELLS) {
    return undefined;
  }
  const left = a.map(compareBy);
  const right = b.map(compareBy);
  // How many words the texts share from each pair of positions on.
  const width = m + 1;
  const after = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      after[i * width + j] =
        left[i] === right[j]
          ? (after[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(
              after[(i + 1) * width + j] ?? 0,
              after[i * width + j + 1] ?? 0,
            );
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (
      (after[(i + 1) * width + j] ?? 0) >= (after[i * width + j + 1] ?? 0)
    ) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

/** The pairs in runs, each a stretch both texts have word for word. */
function runsOf(pairs: readonly [number, number][]): [number, number][][] {
  const runs: [number, number][][] = [];
  for (const pair of pairs) {
    const run = runs.at(-1);
    const last = run?.at(-1);
    if (run && last && pair[0] === last[0] + 1 && pair[1] === last[1] + 1) {
      run.push(pair);
    } else {
      runs.push([pair]);
    }
  }
  return runs;
}

/**
 * Whether the shared words say the revision was made from the text: enough
 * of its words match, and enough of them in runs too long to share by chance.
 * A reply to a pasted email shares words but almost never a run.
 */
function madeFrom(pairs: readonly [number, number][], count: number): boolean {
  const inRuns = runsOf(pairs)
    .filter((run) => run.length >= RUN)
    .reduce((sum, run) => sum + run.length, 0);
  return pairs.length / count >= MATCHED && inRuns / count >= IN_RUNS;
}

/**
 * The part of what the person sent that the revision was made from: the
 * lines holding its long runs and those between them, with a line next to
 * them that is mostly matched words (a greeting, a sign-off), and less any
 * question or lead-in ("Can you tighten this?", "Shorter:") sharing a line
 * with it.
 */
function spanMadeFrom(
  text: string,
  words: readonly Word[],
  pairs: readonly [number, number][],
): string {
  const matched = new Set(pairs.map(([, at]) => at));
  const mostlyMatched = (indexes: readonly number[]) =>
    indexes.filter((index) => matched.has(index)).length >= indexes.length / 2;
  const lines = linesOf(text, words);
  const lineOf = new Map(
    lines.flatMap((line, at) => line.map((index) => [index, at] as const)),
  );
  const anchors = runsOf(pairs)
    .filter((run) => run.length >= RUN)
    .flat()
    .map(([, at]) => lineOf.get(at) ?? 0);
  let first = Math.min(...anchors);
  let last = Math.max(...anchors);
  while (first > 0 && mostlyMatched(lines[first - 1] ?? [])) {
    first--;
  }
  while (last < lines.length - 1 && mostlyMatched(lines[last + 1] ?? [])) {
    last++;
  }
  const isAsk = (sentence: readonly number[]) =>
    ASKS.test(words[sentence.at(-1) ?? 0]?.text ?? "") &&
    !mostlyMatched(sentence);
  const firstSentences = sentencesOf(words, lines[first] ?? []);
  while (firstSentences.length > 1 && isAsk(firstSentences[0] ?? [])) {
    firstSentences.shift();
  }
  const lastSentences =
    first === last ? firstSentences : sentencesOf(words, lines[last] ?? []);
  while (lastSentences.length > 1 && isAsk(lastSentences.at(-1) ?? [])) {
    lastSentences.pop();
  }
  const start = words[firstSentences[0]?.[0] ?? 0]?.start ?? 0;
  const end = words[lastSentences.at(-1)?.at(-1) ?? 0]?.end ?? text.length;
  return text.slice(start, end);
}

/** A text's words by the line they are on, as word indexes; blank lines have none. */
function linesOf(text: string, words: readonly Word[]): number[][] {
  const lines: number[][] = [];
  words.forEach((word, index) => {
    const before = words[index - 1];
    const line = lines.at(-1);
    if (!line || !before || text.slice(before.end, word.start).includes("\n")) {
      lines.push([index]);
    } else {
      line.push(index);
    }
  });
  return lines;
}

/** A line's words split into sentences, as word indexes. */
function sentencesOf(
  words: readonly Word[],
  line: readonly number[],
): number[][] {
  const sentences: number[][] = [[]];
  for (const index of line) {
    sentences.at(-1)?.push(index);
    if (SENTENCE_END.test(words[index]?.text ?? "")) {
      sentences.push([]);
    }
  }
  return sentences.filter((sentence) => sentence.length > 0);
}

/**
 * The revised body as kept and new stretches against the original, or none
 * for a rewrite. A word the original has alone, with new words beside it,
 * reads as one of them, so an odd "the" left standing in a rewritten sentence
 * is not a gap in its tint; at either end it stays, as a sign-off's name does. Words cut with nothing in their place leave no
 * stretch.
 */
function stretchesOf(
  revised: string,
  words: readonly Word[],
  original: string,
): { stretches?: EditStretch[] } {
  const theirs = wordsOf(original);
  const pairs = sharedWords(words, theirs, (word) => word.text) ?? [];
  const shared = new Set(pairs.map(([mine]) => mine));
  const isNew = (at: number) => at >= 0 && at < words.length && !shared.has(at);
  const partner = new Map<number, number>();
  for (const run of runsOf(pairs)) {
    const [[at] = [-1]] = run;
    const atEnd = at === 0 || at === words.length - 1;
    if (run.length > 1 || atEnd || !(isNew(at - 1) || isNew(at + 1))) {
      for (const [mine, other] of run) {
        partner.set(mine, other);
      }
    }
  }
  if ((words.length - partner.size) / words.length > REWRITE) {
    return {};
  }
  const stretches: EditStretch[] = [];
  const keep = (text: string) => {
    const last = stretches.at(-1);
    if (last?.kind === "kept") {
      last.text += text;
    } else if (text !== "") {
      stretches.push({ kind: "kept", text });
    }
  };
  let at = 0;
  let index = 0;
  while (index < words.length) {
    if (partner.has(index)) {
      index++;
      continue;
    }
    const from = index;
    while (index < words.length && !partner.has(index)) {
      index++;
    }
    const before = partner.get(from - 1) ?? -1;
    const after = partner.get(index) ?? theirs.length;
    const start = words[from]?.start ?? 0;
    const end = words[index - 1]?.end ?? start;
    keep(revised.slice(at, start));
    stretches.push({
      kind: "new",
      text: revised.slice(start, end),
      was:
        after - before > 1
          ? original.slice(
              theirs[before + 1]?.start ?? 0,
              theirs[after - 1]?.end ?? 0,
            )
          : "",
    });
    at = end;
  }
  keep(revised.slice(at));
  return { stretches };
}
