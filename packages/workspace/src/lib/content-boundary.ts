import { randomBytes } from "node:crypto";

/**
 * 128 bits, hex-encoded. The number an attacker has to guess to end the block
 * early, so it is sized like a secret rather than like an identifier.
 */
const NONCE_BYTES = 16;

/**
 * How many times a colliding nonce is redrawn before we give up. Reaching the
 * limit means 8 independent 128-bit draws all appeared in the content, which
 * cannot happen; the bound exists so the loop is obviously finite.
 */
const NONCE_ATTEMPTS = 8;

export interface BoundedContent {
  /** The marked-up block, ready to concatenate into tool output. */
  block: string;
  /** The nonce that opened and closed it, for guidance text to cite. */
  nonce: string;
}

/**
 * Wrap content nothing here authored in a boundary it cannot close.
 *
 * The delimiters carry a per-call nonce, so the only way to end the block early
 * is to guess 128 bits. A fixed marker -- `<skill_content>`, `[UNTRUSTED
 * CONTENT END]` -- is published in our own output on every previous call, so
 * anything that can read one transcript can forge the next one's structure.
 *
 * The content itself is passed through byte for byte. Escaping it would be the
 * other way to make forgery impossible, but the things we wrap are read for
 * their meaning: a SKILL.md that arrives with `&lt;div&gt;` in its examples is
 * intact as a string and wrong as instructions. The boundary constrains where
 * the content ends, not what it may say inside.
 *
 * Attribute values are JSON-quoted, which is escaping metadata rather than
 * content: they are short, we produce them, and keeping the header on one line
 * is what lets the closing marker be recognized by shape.
 */
export function boundContent({
  attributes = {},
  content,
  label,
}: {
  attributes?: Record<string, string | undefined>;
  content: string;
  label: string;
}): BoundedContent {
  const nonce = drawNonce(content);
  const header = Object.entries(attributes)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([key, value]) => ` ${key}=${JSON.stringify(value)}`)
    .join("");

  return {
    block: [
      `--- BEGIN_${label} nonce=${nonce}${header} ---`,
      content,
      `--- END_${label} nonce=${nonce} ---`,
    ].join("\n"),
    nonce,
  };
}

/**
 * A nonce the content does not already contain.
 *
 * The content is fixed on disk before the draw, so a collision is chance rather
 * than choice and redrawing settles it. Checking at all is what makes "only a
 * line carrying this nonce ends the block" true of every input rather than of
 * every input we expect.
 */
function drawNonce(content: string): string {
  for (let attempt = 0; attempt < NONCE_ATTEMPTS; attempt += 1) {
    const nonce = randomBytes(NONCE_BYTES).toString("hex");
    if (!content.includes(nonce)) {
      return nonce;
    }
  }
  throw new Error("Could not draw a content boundary nonce");
}
