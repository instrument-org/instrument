import { utf8Prefix, utf8Suffix } from "./utf8-byte-slice";

const TRUNCATE_MAX_LINES = 2000;

/**
 * Head + tail byte budgets for truncateMiddle.
 *
 * The two together are roughly 5,400 to 8,800 tokens, the range covering
 * ordinary command output through dense listings.
 */
export const TRUNCATE_HEAD_BYTES = 10 * 1024; // 10 KB
export const TRUNCATE_TAIL_BYTES = 10 * 1024; // 10 KB

interface TruncateMiddleResult {
  content: string;
  /** Bytes of `text` shown in the head and in the tail of `content`. */
  keptHeadBytes: number;
  keptTailBytes: number;
  /** Number of lines with nothing shown, out of the middle. */
  omittedLines: number;
  totalBytes: number;
  totalLines: number;
  truncated: boolean;
  truncatedBy: "bytes" | "lines" | null;
}

/**
 * Keep the first `headBytes` and last `tailBytes` of content, dropping the
 * middle. Also respects a total line cap — if the full content fits within
 * both the byte budgets and `maxLines`, it is returned unchanged.
 *
 * Each window keeps whole lines. When the line that does not fit is long and
 * the window is at most half full (one line of minified JSON, a progress bar
 * drawn with carriage returns), the window is filled with the start of that
 * line (head) or its end (tail), cut at a character boundary.
 *
 * The separator between the two halves is its own line,
 * `[... N lines omitted ...]`, when both windows end on whole lines, and
 * otherwise sits inside the cut line: `[... N bytes omitted ...]`.
 */
export function truncateMiddle(
  text: string,
  {
    headBytes = TRUNCATE_HEAD_BYTES,
    maxLines = TRUNCATE_MAX_LINES,
    tailBytes: tailBytesOpt = TRUNCATE_TAIL_BYTES,
  }: { headBytes?: number; maxLines?: number; tailBytes?: number } = {},
): TruncateMiddleResult {
  const totalBytes = Buffer.byteLength(text, "utf8");
  const lines = splitLines(text);
  const totalLines = lines.length;
  const whole = {
    content: text,
    keptHeadBytes: totalBytes,
    keptTailBytes: 0,
    omittedLines: 0,
    totalBytes,
    totalLines,
    truncated: false,
    truncatedBy: null,
  } satisfies TruncateMiddleResult;

  if (totalLines <= maxLines && totalBytes <= headBytes + tailBytesOpt) {
    return whole;
  }

  const lineBytes = lines.map((line) => Buffer.byteLength(line, "utf8"));

  // Head: whole lines from the start. `k` is the first line not kept whole.
  let k = 0;
  let headBytesUsed = 0;
  while (k < totalLines && k < maxLines) {
    const cost = (lineBytes[k] ?? 0) + (k > 0 ? 1 : 0);
    if (headBytesUsed + cost > headBytes) {
      break;
    }
    headBytesUsed += cost;
    k++;
  }
  const headFull = k >= maxLines;

  // Tail: whole lines from the end, never reaching into the head. `m` is the
  // last line not kept whole.
  let m = totalLines - 1;
  let tailBytesUsed = 0;
  let tailCount = 0;
  while (m >= k && tailCount < maxLines) {
    const cost = (lineBytes[m] ?? 0) + (tailCount > 0 ? 1 : 0);
    if (tailBytesUsed + cost > tailBytesOpt) {
      break;
    }
    tailBytesUsed += cost;
    tailCount++;
    m--;
  }
  const tailFull = tailCount >= maxLines;

  // The two windows meet: no middle to omit.
  if (m < k) {
    return whole;
  }

  // Fill a window that is at most half full with part of the long line it
  // stopped at (the line did not fit, so it is longer than what is left).
  const headLeft = headBytes - headBytesUsed - (k > 0 ? 1 : 0);
  let prefix =
    !headFull && headLeft > 0 && headLeft * 2 >= headBytes
      ? utf8Prefix(lines[k] ?? "", headLeft)
      : undefined;
  const tailLeft = tailBytesOpt - tailBytesUsed - (tailCount > 0 ? 1 : 0);
  let suffix =
    !tailFull && tailLeft > 0 && tailLeft * 2 >= tailBytesOpt
      ? utf8Suffix(lines[m] ?? "", tailLeft)
      : undefined;
  if (prefix === "") {
    prefix = undefined;
  }
  if (suffix === "") {
    suffix = undefined;
  }

  const prefixBytes = prefix === undefined ? 0 : Buffer.byteLength(prefix);
  const suffixBytes = suffix === undefined ? 0 : Buffer.byteLength(suffix);
  // One line cut from both ends, whose two parts cover all of it.
  if (k === m && prefixBytes + suffixBytes >= (lineBytes[k] ?? 0)) {
    return whole;
  }

  // Byte offsets of the omitted span in `text`.
  let kStart = 0;
  for (let i = 0; i < k; i++) {
    kStart += (lineBytes[i] ?? 0) + 1;
  }
  let mEnd = kStart;
  for (let i = k; i <= m; i++) {
    mEnd += (lineBytes[i] ?? 0) + (i > k ? 1 : 0);
  }
  const omittedBytes = mEnd - suffixBytes - (kStart + prefixBytes);

  const shownLines =
    (prefix === undefined ? 0 : 1) +
    (suffix === undefined || (k === m && prefix !== undefined) ? 0 : 1);
  const omittedLines = m - k + 1 - shownLines;

  let head = lines.slice(0, k).join("\n");
  if (prefix !== undefined) {
    head = k > 0 ? `${head}\n${prefix}` : prefix;
  }
  let tail = lines.slice(m + 1).join("\n");
  if (suffix !== undefined) {
    tail = m + 1 < totalLines ? `${suffix}\n${tail}` : suffix;
  }

  const cut = prefix !== undefined || suffix !== undefined;
  const separator = cut
    ? `[... ${omittedBytes} bytes omitted ...]`
    : `[... ${omittedLines} lines omitted ...]`;
  const content =
    (prefix === undefined && head !== "" ? `${head}\n` : head) +
    separator +
    (suffix === undefined && tail !== "" ? `\n${tail}` : tail);

  return {
    content,
    keptHeadBytes: Buffer.byteLength(head, "utf8"),
    keptTailBytes: Buffer.byteLength(tail, "utf8"),
    omittedLines,
    totalBytes,
    totalLines,
    truncated: true,
    truncatedBy: "bytes",
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function splitLines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  const lines = text.split("\n");
  // Don't count a trailing newline as an extra empty line
  if (lines.length > 1 && lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}
