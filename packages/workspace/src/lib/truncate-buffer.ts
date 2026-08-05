const TRUNCATE_MAX_LINES = 2000;

/** Head + tail byte budgets for truncateMiddle. */
export const TRUNCATE_HEAD_BYTES = 10 * 1024; // 10 KB
export const TRUNCATE_TAIL_BYTES = 10 * 1024; // 10 KB

interface TruncateMiddleResult {
  content: string;
  /** Number of lines omitted from the middle. */
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
 * The separator between the two halves is a single line:
 *   `[... N lines omitted ...]`
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

  if (totalLines <= maxLines && totalBytes <= headBytes + tailBytesOpt) {
    return {
      content: text,
      omittedLines: 0,
      totalBytes,
      totalLines,
      truncated: false,
      truncatedBy: null,
    };
  }

  // Collect head lines
  const headLines: string[] = [];
  let headBytesUsed = 0;
  for (let i = 0; i < lines.length && headLines.length < maxLines; i++) {
    const line = lines[i] ?? "";
    const lineBytes =
      Buffer.byteLength(line, "utf8") + (headLines.length > 0 ? 1 : 0);
    if (headBytesUsed + lineBytes > headBytes) {
      break;
    }
    headLines.push(line);
    headBytesUsed += lineBytes;
  }

  // Collect tail lines (walking backwards)
  const tailLines: string[] = [];
  let tailBytesUsed = 0;
  for (
    let i = lines.length - 1;
    i >= headLines.length && tailLines.length < maxLines;
    i--
  ) {
    const line = lines[i] ?? "";
    const lineBytes =
      Buffer.byteLength(line, "utf8") + (tailLines.length > 0 ? 1 : 0);
    if (tailBytesUsed + lineBytes > tailBytesOpt) {
      break;
    }
    tailLines.unshift(line);
    tailBytesUsed += lineBytes;
  }

  const omittedLines = totalLines - headLines.length - tailLines.length;

  // If the two windows overlap or cover everything, no middle to omit
  if (omittedLines <= 0) {
    return {
      content: text,
      omittedLines: 0,
      totalBytes,
      totalLines,
      truncated: false,
      truncatedBy: null,
    };
  }

  const separator = `[... ${omittedLines} lines omitted ...]`;
  const content = [...headLines, separator, ...tailLines].join("\n");

  return {
    content,
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
