/**
 * A heading as the rest of a sentence: "Tracing the login flow" reads as
 * "while tracing the login flow", and "Stopped at the step limit" as "was
 * stopped at the step limit". A heading that opens on an acronym keeps its
 * case, since "PDF" lowercased is a different word.
 */
export function asClause(heading: string): string {
  const [first = "", second = ""] = heading;
  return second === second.toLowerCase()
    ? `${first.toLowerCase()}${heading.slice(1)}`
    : heading;
}
