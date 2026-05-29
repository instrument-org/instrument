export const TRUNCATE_MAX_LINES = 2000;
export const TRUNCATE_MAX_BYTES = 50 * 1024; // 50 KB

export interface TruncateResult {
  content: string;
  totalBytes: number;
  totalLines: number;
  truncated: boolean;
  truncatedBy: "bytes" | "lines" | null;
}

/**
 * Truncate from the head (keep first N lines/bytes).
 * Never splits a line. Returns empty content with firstLineExceedsLimit=true
 * if the very first line is already over the byte cap.
 */
export function truncateHead(
  text: string,
  {
    maxBytes = TRUNCATE_MAX_BYTES,
    maxLines = TRUNCATE_MAX_LINES,
  }: { maxBytes?: number; maxLines?: number } = {},
): TruncateResult & { firstLineExceedsLimit: boolean } {
  const totalBytes = Buffer.byteLength(text, "utf8");
  const lines = splitLines(text);
  const totalLines = lines.length;

  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return {
      content: text,
      firstLineExceedsLimit: false,
      totalBytes,
      totalLines,
      truncated: false,
      truncatedBy: null,
    };
  }

  const firstLine = lines[0] ?? "";
  const firstLineBytes =
    lines.length > 0 ? Buffer.byteLength(firstLine, "utf8") : 0;
  if (firstLineBytes > maxBytes) {
    return {
      content: "",
      firstLineExceedsLimit: true,
      totalBytes,
      totalLines,
      truncated: true,
      truncatedBy: "bytes",
    };
  }

  const kept: string[] = [];
  let keptBytes = 0;
  let truncatedBy: "bytes" | "lines" = "lines";

  for (let i = 0; i < lines.length && i < maxLines; i++) {
    const line = lines[i] ?? "";
    const lineBytes = Buffer.byteLength(line, "utf8") + (i > 0 ? 1 : 0);
    if (keptBytes + lineBytes > maxBytes) {
      truncatedBy = "bytes";
      break;
    }
    kept.push(line);
    keptBytes += lineBytes;
  }

  return {
    content: kept.join("\n"),
    firstLineExceedsLimit: false,
    totalBytes,
    totalLines,
    truncated: true,
    truncatedBy,
  };
}

/**
 * Truncate from the tail (keep last N lines/bytes).
 * Suitable for bash output where errors appear at the end.
 * Never splits a line unless one line alone exceeds the byte cap.
 */
export function truncateTail(
  text: string,
  {
    maxBytes = TRUNCATE_MAX_BYTES,
    maxLines = TRUNCATE_MAX_LINES,
  }: { maxBytes?: number; maxLines?: number } = {},
): TruncateResult {
  const totalBytes = Buffer.byteLength(text, "utf8");
  const lines = splitLines(text);
  const totalLines = lines.length;

  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return {
      content: text,
      totalBytes,
      totalLines,
      truncated: false,
      truncatedBy: null,
    };
  }

  const kept: string[] = [];
  let keptBytes = 0;
  let truncatedBy: "bytes" | "lines" = "lines";

  for (let i = lines.length - 1; i >= 0 && kept.length < maxLines; i--) {
    const line = lines[i] ?? "";
    const lineBytes =
      Buffer.byteLength(line, "utf8") + (kept.length > 0 ? 1 : 0);
    if (keptBytes + lineBytes > maxBytes) {
      truncatedBy = "bytes";
      // Edge case: single line exceeds the cap — take its tail bytes
      if (kept.length === 0) {
        const tail = tailBytes(line, maxBytes);
        kept.unshift(tail);
        keptBytes = Buffer.byteLength(tail, "utf8");
      }
      break;
    }
    kept.unshift(line);
    keptBytes += lineBytes;
  }

  return {
    content: kept.join("\n"),
    totalBytes,
    totalLines,
    truncated: true,
    truncatedBy,
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

/** Returns the last `maxBytes` UTF-8 bytes of `str`, aligned to a code-point boundary. */
function tailBytes(str: string, maxBytes: number): string {
  const buf = Buffer.from(str, "utf8");
  if (buf.length <= maxBytes) {
    return str;
  }
  let start = buf.length - maxBytes;
  // Walk forward to the start of a UTF-8 sequence
  while (start < buf.length && ((buf.at(start) ?? 0) & 0xc0) === 0x80) {
    start++;
  }
  return buf.subarray(start).toString("utf8");
}
