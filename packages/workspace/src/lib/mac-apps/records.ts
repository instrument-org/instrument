/** What the app's scripts separate fields and records with: ASCII's unit and record separators. */
const UNIT = "\u001f";
const RECORD = "\u001e";

/** A list as the scripts' `takeList` reads it: its length, then its items. */
export function listArgs(values: string[]): string[] {
  return [String(values.length), ...values];
}

/** A script's answer as its records, each a list of fields. */
export function parseRecords(output: string): string[][] {
  return output
    .split(RECORD)
    .filter((record) => record.trim() !== "")
    .map((record) => record.split(UNIT));
}

/**
 * A script's answer that is one record whose last field is free text, such
 * as a message's body, which may hold anything: the first `count - 1` fields,
 * and everything after them as the last.
 */
export function parseRecordWithText(output: string, count: number): string[] {
  const fields = output.split(UNIT);
  return [...fields.slice(0, count - 1), fields.slice(count - 1).join(UNIT)];
}

/**
 * A local time as a script writes it (`2026-10-14T09:05:03`), with this
 * computer's offset from UTC added, as the helper writes its times; null for
 * an empty one.
 */
export function localIso(text: string): string | null {
  const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)$/.exec(text);
  if (!match) {
    return null;
  }
  const [year = 0, month = 1, day = 1, hours = 0, minutes = 0, seconds = 0] =
    match.slice(1).map(Number);
  const offset = -new Date(
    year,
    month - 1,
    day,
    hours,
    minutes,
    seconds,
  ).getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const pad = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, "0");
  return `${text}${sign}${pad(offset / 60)}:${pad(offset % 60)}`;
}

const ESCAPED: Record<string, string> = {
  '"': "&quot;",
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};

function escapeHtml(text: string): string {
  return text.replaceAll(/["&<>]/g, (char) => ESCAPED[char] ?? char);
}

/**
 * Plain text as the HTML a note's body is written in: the title as a
 * heading, and each line as a line of the note, an empty one kept as a gap.
 */
export function noteHtml(text: string, title?: string): string {
  const lines = text === "" ? [] : text.replaceAll(/\r\n?/g, "\n").split("\n");
  return [
    ...(title ? [`<div><h1>${escapeHtml(title)}</h1></div>`] : []),
    ...lines.map((line) => `<div>${line ? escapeHtml(line) : "<br>"}</div>`),
  ].join("");
}
