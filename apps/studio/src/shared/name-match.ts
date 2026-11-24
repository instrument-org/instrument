/**
 * Which names a search finds, and in what order.
 *
 * A match has a step, lower being better, and a step means the same thing for
 * a chat title, a folder name and a page title, so results of different kinds
 * are ordered together by it:
 *
 * 0. The name is exactly the words.
 * 1. The words start the name ("wire" finds "wireframes").
 * 2. Each typed word starts a word of the name, in any order ("home tab"
 *    finds "tab-groups-home.html").
 * 3. The typed letters, read as one run without spaces, are the leading
 *    letters of two or more of the name's words, in the name's order ("tg"
 *    and "tabgr" find "Tab Groups"). Words of the name may be skipped ("th"
 *    finds "tab-groups-home").
 * 4. Every typed word is somewhere inside the name in one piece ("duck" finds
 *    "Cyberduck").
 * 5. One typed word of five letters or more is one wrong letter away from the
 *    start of a word of the name. Only when the caller asks for it.
 *
 * Letters scattered through the middle of words never match.
 *
 * A word of the name starts at the name's start, after a space or any
 * punctuation, at a capital inside a word, and where letters and digits meet.
 * Case and accents are ignored on both sides.
 *
 * A caller with many names folds each once (`foldName`) and the typed text
 * once per search (`foldWords`); `matchRank` then allocates nothing.
 */

export const MATCH_STEPS = {
  exact: 0,
  startsName: 1,
  startsWords: 2,
  initials: 3,
  inside: 4,
  wrongLetter: 5,
} as const;

/** What `matchRank` answers for a name the words do not find. */
export const NO_MATCH = -1;

/** A name ready to be matched. Made once per name by `foldName`. */
export type FoldedName = {
  /** The name as written. */
  name: string;
  /**
   * For each character of `text`, where the character it came from starts in
   * `name`, then `name.length`. Null when the two line up one to one.
   */
  offsets: null | number[];
  /** Where each word starts in `text`, in order. */
  starts: number[];
  /** The name with case and accents folded away. */
  text: string;
};

/** What the person typed, ready to be matched. Made by `foldWords`. */
export type FoldedWords = {
  /** The words with no spaces between them. */
  run: string;
  /** The words with one space between them. */
  text: string;
  words: string[];
};

/** What the ordering within a search reads of one match. */
export type Ranked = {
  /** The name as written. */
  name: string;
  /** The person pinned or bookmarked it. */
  pinned?: boolean;
  /** Where in the folded name the match starts. */
  position: number;
  /** The person picked it the last time they typed these letters. */
  remembered?: boolean;
  step: number;
  /** How often and how lately it was opened. Higher is first. */
  use?: number;
};

export type NameEntry = {
  id: string;
  name: FoldedName;
  pinned?: boolean;
  use?: number;
};

export type RankedName<T> = Ranked & {
  entry: T;
  /** Start and end pairs in the name as written, for `FuzzyHighlight`. */
  ranges: number[];
};

const SEPARATOR = 0;
const LOWER = 1;
const UPPER = 2;
const DIGIT = 3;
/** A letter with no case, such as a Chinese or Hebrew one. */
const OTHER = 4;
const APOSTROPHE = 5;
const MARK = 6;

const ASCII_KINDS = new Uint8Array(128);
for (let code = 48; code <= 57; code++) {
  ASCII_KINDS[code] = DIGIT;
}
for (let code = 65; code <= 90; code++) {
  ASCII_KINDS[code] = UPPER;
  ASCII_KINDS[code + 32] = LOWER;
}
ASCII_KINDS[39] = APOSTROPHE;

/**
 * The accents taken off a letter. Marks outside this block are part of how a
 * script spells a word (a Devanagari vowel, a Japanese voicing mark) and stay.
 */
const ACCENTS = /[\u0300-\u036f]/g;
const IS_UPPER = /\p{Lu}|\p{Lt}/u;
const IS_LOWER = /\p{Ll}/u;
const IS_LETTER = /\p{L}/u;
const IS_NUMBER = /\p{N}/u;
const IS_MARK = /\p{M}/u;
const IS_SPACE = /\s+/;

/** Longest run step 3 reads, so its reach fits the bits of a small integer. */
const MOST_RUN_LETTERS = 30;
/** Shortest typed word step 5 forgives a wrong letter in. */
const FEWEST_LETTERS_FOR_WRONG_ONE = 5;
const RANK_PER_STEP = 0x1_00_00;

/** The kinds of the characters of the name being folded, reused across calls. */
let kinds = new Uint8Array(256);

function kindOf(char: string, code: number): number {
  if (code < 128) {
    return ASCII_KINDS[code] ?? SEPARATOR;
  }
  if (code === 0x20_19) {
    return APOSTROPHE;
  }
  if (IS_UPPER.test(char)) {
    return UPPER;
  }
  if (IS_LOWER.test(char)) {
    return LOWER;
  }
  if (IS_LETTER.test(char)) {
    return OTHER;
  }
  if (IS_NUMBER.test(char)) {
    return DIGIT;
  }
  return IS_MARK.test(char) ? MARK : SEPARATOR;
}

/**
 * One character with case and accents folded away. Decomposing first is what
 * makes "é" typed as one character equal the two a Mac's disk spells it with,
 * and a full-width or ligature letter equal the plain one.
 */
function foldChar(char: string, code: number): string {
  return code < 128
    ? char.toLowerCase()
    : char.normalize("NFKD").replace(ACCENTS, "").toLowerCase();
}

function isPlain(text: string): boolean {
  for (let at = 0; at < text.length; at++) {
    if (text.charCodeAt(at) > 127) {
      return false;
    }
  }
  return true;
}

/** Text with case and accents folded away, as both sides are compared. */
export function foldText(text: string): string {
  if (isPlain(text)) {
    return text.toLowerCase();
  }
  let folded = "";
  for (const char of text) {
    folded += foldChar(char, char.codePointAt(0) ?? 0);
  }
  return folded;
}

/**
 * Where words start, from the kinds of a name's first `count` characters.
 * `places` says where each character is in the folded text, and is null when
 * that is where it is in the name.
 */
function wordStarts(count: number, places: null | number[]): number[] {
  const starts: number[] = [];
  let before = SEPARATOR;
  for (let at = 0; at < count; at++) {
    const kind = kinds[at] ?? SEPARATOR;
    if (kind === SEPARATOR) {
      before = SEPARATOR;
      continue;
    }
    const next = at + 1 < count ? (kinds[at + 1] ?? SEPARATOR) : SEPARATOR;
    if (kind === APOSTROPHE) {
      // Between two letters it is part of the word, so "don't" is one word.
      if (!isLetter(before) || !isLetter(next)) {
        before = SEPARATOR;
      }
      continue;
    }
    if (
      before === SEPARATOR ||
      caseless(kind) !== caseless(before) ||
      (kind === UPPER && (before === LOWER || next === LOWER))
    ) {
      starts.push(places ? (places[at] ?? 0) : at);
    }
    before = kind;
  }
  return starts;
}

function isLetter(kind: number): boolean {
  return kind === LOWER || kind === UPPER || kind === OTHER;
}

function caseless(kind: number): number {
  return kind === UPPER ? LOWER : kind;
}

/** A name ready to be matched: folded, with where its words start. */
export function foldName(name: string): FoldedName {
  const size = name.length;
  if (kinds.length < size) {
    kinds = new Uint8Array(size * 2);
  }
  let plain = true;
  for (let at = 0; at < size; at++) {
    const code = name.charCodeAt(at);
    if (code > 127) {
      plain = false;
      break;
    }
    kinds[at] = ASCII_KINDS[code] ?? SEPARATOR;
  }
  if (plain) {
    return {
      name,
      offsets: null,
      starts: wordStarts(size, null),
      text: name.toLowerCase(),
    };
  }
  let text = "";
  let at = 0;
  let count = 0;
  let aligned = true;
  const offsets: number[] = [];
  const places: number[] = [];
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    const kind = kindOf(char, code);
    const folded = foldChar(char, code);
    if (kind !== MARK && folded !== "") {
      kinds[count] = kind;
      places.push(text.length);
      count += 1;
    }
    for (let unit = 0; unit < folded.length; unit++) {
      aligned &&= offsets.length === at;
      offsets.push(at);
    }
    text += folded;
    at += char.length;
  }
  aligned &&= offsets.length === size;
  offsets.push(size);
  return {
    name,
    offsets: aligned ? null : offsets,
    starts: wordStarts(count, places),
    text,
  };
}

/** What the person typed, folded and split at its spaces. */
export function foldWords(typed: string): FoldedWords {
  const words = foldText(typed)
    .split(IS_SPACE)
    .filter((word) => word !== "");
  return { run: words.join(""), text: words.join(" "), words };
}

/**
 * How well the words find the name, as one number that is lower for a better
 * match: the step, then where the match starts. `NO_MATCH` when they do not.
 * `stepOf` and `positionOf` read it. Step 5 is tried only with `wrongLetter`.
 */
export function matchRank(
  name: FoldedName,
  words: FoldedWords,
  wrongLetter = false,
): number {
  const list = words.words;
  if (list.length === 0) {
    return NO_MATCH;
  }
  const { text } = name;
  let position = text.length;
  let everyWordStarts = true;
  let absent = 0;
  let absentWord = "";
  for (const word of list) {
    const first = text.indexOf(word);
    if (first === -1) {
      absent += 1;
      absentWord = word;
      if (!wrongLetter) {
        break;
      }
      continue;
    }
    const start = wordStartOf(name, word, first);
    if (start === -1) {
      everyWordStarts = false;
    }
    position = Math.min(position, start === -1 ? first : start);
  }
  if (absent === 0) {
    const end = leadEnd(name, list, 0);
    if (end !== -1) {
      return end === text.length ? MATCH_STEPS.exact : RANK_PER_STEP;
    }
    const firstStart = name.starts[0] ?? 0;
    if (firstStart > 0 && leadEnd(name, list, firstStart) !== -1) {
      return rankOf(MATCH_STEPS.startsName, firstStart);
    }
    if (everyWordStarts) {
      return rankOf(MATCH_STEPS.startsWords, position);
    }
  }
  const runStart = runIndex(name, words.run);
  if (runStart !== -1) {
    return rankOf(MATCH_STEPS.initials, runStart);
  }
  if (absent === 0) {
    return rankOf(MATCH_STEPS.inside, position);
  }
  if (wrongLetter && absent === 1) {
    const near = nearStart(name, absentWord);
    if (near !== -1) {
      return rankOf(MATCH_STEPS.wrongLetter, Math.min(position, near));
    }
  }
  return NO_MATCH;
}

function rankOf(step: number, position: number): number {
  return step * RANK_PER_STEP + Math.min(position, RANK_PER_STEP - 1);
}

/** The step of a rank `matchRank` answered. */
export function stepOf(rank: number): number {
  return Math.floor(rank / RANK_PER_STEP);
}

/** Where in the folded name the match of a rank starts. */
export function positionOf(rank: number): number {
  return rank % RANK_PER_STEP;
}

/** The first place at or after `from` where the word starts a word, or -1. */
function wordStartOf(name: FoldedName, word: string, from: number): number {
  const { starts, text } = name;
  for (let index = 0; index < starts.length; index++) {
    const start = starts[index] ?? 0;
    if (start >= from && text.startsWith(word, start)) {
      return start;
    }
  }
  return -1;
}

/**
 * Where the words end when they are how the name reads from `from`: each
 * word in turn, with only separators (or a capital's word start) between one
 * and the next, so "tab groups" starts "tab-groups-home". -1 otherwise.
 */
function leadEnd(name: FoldedName, list: string[], from: number): number {
  const { starts, text } = name;
  let at = from;
  for (let index = 0; index < list.length; index++) {
    const word = list[index] ?? "";
    if (index > 0) {
      let next = -1;
      for (let nth = 0; nth < starts.length; nth++) {
        const start = starts[nth] ?? 0;
        if (start >= at) {
          next = start;
          break;
        }
      }
      if (next === -1 || !isGap(name, at, next)) {
        return -1;
      }
      at = next;
    }
    if (!text.startsWith(word, at)) {
      return -1;
    }
    at += word.length;
  }
  return at;
}

/** Whether the folded text from `from` to `to` is separators alone. */
function isGap(name: FoldedName, from: number, to: number): boolean {
  for (let at = from; at < to; at++) {
    const place = name.offsets ? (name.offsets[at] ?? 0) : at;
    const code = name.name.codePointAt(place) ?? 0;
    const kind = kindOf(code < 128 ? "" : String.fromCodePoint(code), code);
    if (kind === LOWER || kind === UPPER || kind === DIGIT || kind === OTHER) {
      return false;
    }
  }
  return true;
}

/** How many letters of the run from `at` the word at `start` begins with. */
function sharedLength(
  text: string,
  start: number,
  limit: number,
  run: string,
  at: number,
): number {
  let length = 0;
  while (
    length < limit &&
    at + length < run.length &&
    text.charCodeAt(start + length) === run.charCodeAt(at + length)
  ) {
    length += 1;
  }
  return length;
}

/**
 * Step 3. Where the first word used starts when the run is the leading
 * letters of two or more of the name's words in order, each word giving one
 * letter or more from its start; -1 otherwise. So the first typed letter
 * starts a word, and each later one either goes on with that word or starts
 * a later one.
 *
 * Read from the last word back. Bit `n` of `none`, `one` and `more` says the
 * run from its letter `n` on is spelled by no, one, or two and more of the
 * words read so far.
 */
function runIndex(name: FoldedName, run: string): number {
  const { starts, text } = name;
  const size = run.length;
  if (
    size < 2 ||
    size > MOST_RUN_LETTERS ||
    starts.length < 2 ||
    !runFits(name, run)
  ) {
    return -1;
  }
  const none = 1 << size;
  let one = 0;
  let more = 0;
  let found = -1;
  let end = text.length;
  for (let index = starts.length - 1; index >= 0; index--) {
    const start = starts[index] ?? 0;
    const code = text.charCodeAt(start);
    let addOne = 0;
    let addMore = 0;
    for (let at = 0; at < size; at++) {
      if (run.charCodeAt(at) !== code) {
        continue;
      }
      const length = sharedLength(text, start, end - start, run, at);
      const reach = ((1 << length) - 1) << (at + 1);
      if (none & reach) {
        addOne |= 1 << at;
      }
      if ((one | more) & reach) {
        addMore |= 1 << at;
      }
    }
    one |= addOne;
    more |= addMore;
    if (addMore & 1) {
      found = start;
    }
    end = start;
  }
  return found;
}

/**
 * Whether step 3 finds the name, read from the first word on so that a name
 * it does not find costs one comparison a word. Bit `n` of `one` and `more`
 * says the run up to its letter `n` is spelled by one, or two and more, of
 * the words read so far.
 */
function runFits(name: FoldedName, run: string): boolean {
  const { starts, text } = name;
  const size = run.length;
  const whole = 1 << size;
  let one = 0;
  let more = 0;
  for (let index = 0; index < starts.length; index++) {
    const start = starts[index] ?? 0;
    const code = text.charCodeAt(start);
    const limit = (starts[index + 1] ?? text.length) - start;
    let addOne = 0;
    let addMore = 0;
    let left = (1 | one | more) & (whole - 1);
    while (left !== 0) {
      const at = 31 - Math.clz32(left);
      left ^= 1 << at;
      if (run.charCodeAt(at) !== code) {
        continue;
      }
      const length = sharedLength(text, start, limit, run, at);
      const reach = ((1 << length) - 1) << (at + 1);
      if (at === 0) {
        addOne |= reach;
      }
      if ((one | more) & (1 << at)) {
        addMore |= reach;
      }
    }
    one |= addOne;
    more |= addMore;
    if (more & whole) {
      return true;
    }
  }
  return false;
}

/**
 * The pieces of the name step 3 matched, as pairs in the folded text: the
 * earliest words that work, each giving as many letters as it can.
 */
function runSpans(name: FoldedName, run: string): number[] {
  const { starts, text } = name;
  const size = run.length;
  if (size < 2 || size > MOST_RUN_LETTERS || starts.length < 2) {
    return [];
  }
  // What the words after each word spell, as in `runIndex`.
  const oneAfter: number[] = [];
  const moreAfter: number[] = [];
  const none = 1 << size;
  let one = 0;
  let more = 0;
  for (let index = starts.length - 1; index >= 0; index--) {
    oneAfter[index] = one;
    moreAfter[index] = more;
    const start = starts[index] ?? 0;
    const limit = (starts[index + 1] ?? text.length) - start;
    let addOne = 0;
    let addMore = 0;
    for (let at = 0; at < size; at++) {
      const length = sharedLength(text, start, limit, run, at);
      const reach = ((1 << length) - 1) << (at + 1);
      if (none & reach) {
        addOne |= 1 << at;
      }
      if ((one | more) & reach) {
        addMore |= 1 << at;
      }
    }
    one |= addOne;
    more |= addMore;
  }
  const spans: number[] = [];
  let at = 0;
  for (let index = 0; index < starts.length && at < size; index++) {
    const start = starts[index] ?? 0;
    const limit = (starts[index + 1] ?? text.length) - start;
    const later = (oneAfter[index] ?? 0) | (moreAfter[index] ?? 0);
    // A second word has to follow the first one used.
    const rest = spans.length === 0 ? later : later | none;
    for (
      let length = sharedLength(text, start, limit, run, at);
      length > 0;
      length--
    ) {
      if (rest & (1 << (at + length))) {
        spans.push(start, start + length);
        at += length;
        break;
      }
    }
  }
  return at === size ? spans : [];
}

function sameLetters(
  text: string,
  textAt: number,
  word: string,
  wordAt: number,
  length: number,
): boolean {
  if (textAt + length > text.length) {
    return false;
  }
  for (let index = 0; index < length; index++) {
    if (text.charCodeAt(textAt + index) !== word.charCodeAt(wordAt + index)) {
      return false;
    }
  }
  return true;
}

/**
 * How much of the name from `from` the word is one wrong letter away from:
 * one letter typed for another, two neighbors swapped, one letter too many,
 * or one left out. -1 when it is further off than that.
 */
function nearLength(text: string, from: number, word: string): number {
  const size = word.length;
  let same = 0;
  while (
    same < size &&
    text.charCodeAt(from + same) === word.charCodeAt(same)
  ) {
    same += 1;
  }
  if (same === size) {
    return size;
  }
  const after = size - same - 1;
  if (sameLetters(text, from + same + 1, word, same + 1, after)) {
    return size;
  }
  if (
    after > 0 &&
    text.charCodeAt(from + same) === word.charCodeAt(same + 1) &&
    text.charCodeAt(from + same + 1) === word.charCodeAt(same) &&
    sameLetters(text, from + same + 2, word, same + 2, after - 1)
  ) {
    return size;
  }
  if (sameLetters(text, from + same, word, same + 1, after)) {
    return size - 1;
  }
  if (sameLetters(text, from + same + 1, word, same, after + 1)) {
    return size + 1;
  }
  return -1;
}

/** Step 5. The first word start the word is one wrong letter from, or -1. */
function nearStart(name: FoldedName, word: string): number {
  if (word.length < FEWEST_LETTERS_FOR_WRONG_ONE) {
    return -1;
  }
  const { starts, text } = name;
  for (let index = 0; index < starts.length; index++) {
    const start = starts[index] ?? 0;
    if (nearLength(text, start, word) !== -1) {
      return start;
    }
  }
  return -1;
}

/**
 * What to draw as matched for a name `matchRank` found at `step`: start and
 * end pairs in the name as written, in order, the shape `FuzzyHighlight`
 * takes.
 */
export function matchRanges(
  name: FoldedName,
  words: FoldedWords,
  step: number,
): number[] {
  const { text } = name;
  const spans: number[] = [];
  if (step === MATCH_STEPS.exact || step === MATCH_STEPS.startsName) {
    const from =
      leadEnd(name, words.words, 0) === -1 ? (name.starts[0] ?? 0) : 0;
    const end = leadEnd(name, words.words, from);
    if (end !== -1) {
      spans.push(from, end);
    }
  } else if (step === MATCH_STEPS.initials) {
    spans.push(...runSpans(name, words.run));
  } else {
    for (const word of words.words) {
      const first = text.indexOf(word);
      if (first !== -1) {
        const start = wordStartOf(name, word, first);
        const at = start === -1 ? first : start;
        spans.push(at, at + word.length);
        continue;
      }
      const near = nearStart(name, word);
      if (near !== -1) {
        spans.push(
          near,
          Math.min(text.length, near + nearLength(text, near, word)),
        );
      }
    }
  }
  return inName(name, joined(spans));
}

/** Pairs in order, with the ones that touch or overlap made one. */
function joined(spans: number[]): number[] {
  const pairs: [number, number][] = [];
  for (let index = 0; index + 1 < spans.length; index += 2) {
    pairs.push([spans[index] ?? 0, spans[index + 1] ?? 0]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  const out: number[] = [];
  for (const [start, end] of pairs) {
    const last = out.at(-1);
    if (last !== undefined && start <= last) {
      out[out.length - 1] = Math.max(last, end);
    } else {
      out.push(start, end);
    }
  }
  return out;
}

/**
 * Pairs in the folded text as pairs in the name as written. An end takes in
 * the whole character the last matched one came from and its accents.
 */
function inName(name: FoldedName, spans: number[]): number[] {
  const { offsets, text } = name;
  if (!offsets) {
    return spans;
  }
  const out: number[] = [];
  for (let index = 0; index + 1 < spans.length; index += 2) {
    const start = spans[index] ?? 0;
    let end = spans[index + 1] ?? 0;
    const last = offsets[end - 1] ?? 0;
    while (end < text.length && offsets[end] === last) {
      end += 1;
    }
    out.push(offsets[start] ?? 0, offsets[end] ?? name.name.length);
  }
  return joined(out);
}

/**
 * One name against the words: its step, where the match starts and what to
 * draw as matched, or null. For a handful of names; a long list goes through
 * `rankNames`, or `matchRank` over names folded once.
 */
export function matchName(
  name: FoldedName | string,
  words: FoldedWords,
  wrongLetter = false,
): null | { position: number; ranges: number[]; step: number } {
  const folded = typeof name === "string" ? foldName(name) : name;
  const rank = matchRank(folded, words, wrongLetter);
  if (rank === NO_MATCH) {
    return null;
  }
  const step = stepOf(rank);
  return {
    position: positionOf(rank),
    ranges: matchRanges(folded, words, step),
    step,
  };
}

/**
 * The order of two matches in one list of results, whatever their kinds: the
 * remembered pick, then the step, then what the person pinned, then what they
 * use most, then the earlier match, then the shorter name, then the name.
 */
export function compareMatches(a: Ranked, b: Ranked): number {
  return (
    Number(b.remembered ?? false) - Number(a.remembered ?? false) ||
    a.step - b.step ||
    Number(b.pinned ?? false) - Number(a.pinned ?? false) ||
    (b.use ?? 0) - (a.use ?? 0) ||
    a.position - b.position ||
    a.name.length - b.name.length ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  );
}

/**
 * The entries the words find, best first, each with what to draw as matched.
 * `remembered` is the id of what the person picked the last time they typed
 * these letters (`rememberedPick`), which goes first if it matches at all.
 * With `limit`, only that many come back, and only the steps needed to fill
 * it are sorted.
 */
export function rankNames<T extends NameEntry>(
  entries: readonly T[],
  words: FoldedWords,
  options: { limit?: number; remembered?: string; wrongLetter?: boolean } = {},
): RankedName<T>[] {
  const { limit = entries.length, remembered, wrongLetter = false } = options;
  const ranks = new Int32Array(entries.length);
  const perStep = [0, 0, 0, 0, 0, 0];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const rank = entry ? matchRank(entry.name, words, wrongLetter) : NO_MATCH;
    ranks[index] = rank;
    if (rank !== NO_MATCH) {
      perStep[stepOf(rank)] = (perStep[stepOf(rank)] ?? 0) + 1;
    }
  }
  // The last step needed to fill the limit, so later steps are never sorted.
  let lastStep = 0;
  for (let step = 0, total = 0; step < perStep.length; step++) {
    lastStep = step;
    total += perStep[step] ?? 0;
    if (total >= limit) {
      break;
    }
  }
  const found: RankedName<T>[] = [];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const rank = ranks[index] ?? NO_MATCH;
    if (!entry || rank === NO_MATCH) {
      continue;
    }
    const isRemembered = remembered !== undefined && entry.id === remembered;
    if (stepOf(rank) > lastStep && !isRemembered) {
      continue;
    }
    found.push({
      entry,
      name: entry.name.name,
      pinned: entry.pinned,
      position: positionOf(rank),
      ranges: [],
      remembered: isRemembered,
      step: stepOf(rank),
      use: entry.use,
    });
  }
  const shown = found.toSorted(compareMatches).slice(0, limit);
  for (const match of shown) {
    match.ranges = matchRanges(match.entry.name, words, match.step);
  }
  return shown;
}
