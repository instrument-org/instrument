// Padded to 4 digits because a 250k source file (the size limit) can have
// roughly 5,000 lines.
export const LINE_NUMBER_PAD_WIDTH = 4;

// Single non-content character that separates the right-padded line number from
// the actual file content. Exported so tool descriptions can reference it
// directly instead of describing it in prose (which goes out of date).
export const LINE_NUMBER_SEPARATOR = "→";

export function addLineNumbers(content: string, offset = 0): string {
  return content
    .split(/\r?\n/)
    .map(
      (line, i) =>
        `${(i + 1 + offset).toString().padStart(LINE_NUMBER_PAD_WIDTH, " ")}${LINE_NUMBER_SEPARATOR}${line}`,
    )
    .join("\n");
}
