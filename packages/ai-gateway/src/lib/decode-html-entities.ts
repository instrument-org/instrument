const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: "\u00A0",
  quot: '"',
};

const MAX_CODE_POINT = 0x10_ff_ff;

function decodeHtmlEntitiesOnce(input: string) {
  let out = input.replaceAll(/&#x([\da-f]{1,8});/gi, (full, hex: string) => {
    const cp = Number.parseInt(hex, 16);
    return cp >= 0 && cp <= MAX_CODE_POINT ? String.fromCodePoint(cp) : full;
  });
  out = out.replaceAll(/&#(\d{1,8});/g, (full, dec: string) => {
    const cp = Number.parseInt(dec, 10);
    return cp >= 0 && cp <= MAX_CODE_POINT ? String.fromCodePoint(cp) : full;
  });
  out = out.replaceAll(/&([a-z][\da-z]*);/gi, (full, name: string) => {
    const decoded = NAMED_ENTITIES[name.toLowerCase()];
    return decoded ?? full;
  });
  return out;
}

const MAX_DECODE_PASSES = 5;

/**
 * Decodes common HTML character references in model output (named + numeric).
 * Runs multiple passes so double-encoded sequences like `&amp;lt;` become `<`.
 */
export function decodeHtmlEntities(input: string) {
  let prev = input;
  for (let i = 0; i < MAX_DECODE_PASSES; i++) {
    const next = decodeHtmlEntitiesOnce(prev);
    if (next === prev) {
      return next;
    }
    prev = next;
  }
  return prev;
}
