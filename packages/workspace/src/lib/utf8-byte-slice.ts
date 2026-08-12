export function utf8Prefix(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= maxBytes) {
    return text;
  }

  let end = Math.max(0, maxBytes);
  while (end > 0 && ((buffer.at(end) ?? 0) & 0xc0) === 0x80) {
    end--;
  }
  return buffer.subarray(0, end).toString("utf8");
}

export function utf8Suffix(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= maxBytes) {
    return text;
  }

  let start = Math.max(0, buffer.length - maxBytes);
  while (start < buffer.length && ((buffer.at(start) ?? 0) & 0xc0) === 0x80) {
    start++;
  }
  return buffer.subarray(start).toString("utf8");
}
