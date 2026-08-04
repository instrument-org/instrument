import { APP_NAME_SLUG } from "@instrument-org/shared";
import { dedent } from "radashi";

const NOTE_TAG = `${APP_NAME_SLUG}-system-note`;

/** The note's own tag, opening or closing, wherever it appears in a value. */
const NOTE_TAG_PATTERN = new RegExp(`<(/?)(${NOTE_TAG})>`, "g");

/**
 * Wrap our own prose in the tag the model reads as coming from the harness.
 *
 * The literal parts of the template are ours. The interpolated parts are not:
 * callers pass a page title, a folder name, a changed file's path, a project's
 * instructions. A value carrying this note's own tag would otherwise close the
 * note and open another, so everything after it reads as a second note the
 * harness wrote -- which is the most useful thing on this surface to forge,
 * because a system note is exactly where "the user approved this" would be
 * believed.
 *
 * Only the tag itself is neutralized, and only inside a value. This is markup
 * we introduced, in metadata short enough that showing it as `&lt;...&gt;`
 * costs nothing -- unlike a skill body or a retrieved page, which are read for
 * their meaning and get a nonce boundary instead (`lib/content-boundary.ts`).
 */
export function systemNote(
  strings: TemplateStringsArray,
  ...values: unknown[]
) {
  const content = dedent(
    strings,
    ...values.map((value) =>
      typeof value === "string" ? neutralizeNoteTags(value) : value,
    ),
  );
  return dedent`

    <${NOTE_TAG}>
    ${content}
    </${NOTE_TAG}>
  `;
}

/**
 * The prose inside a system note, for showing the note to a person.
 *
 * The tag is addressed to the model: it is how the model tells harness text
 * apart from everything else in the turn. A reader gets that from the label on
 * the card the note is drawn in, so the markup is two lines of noise wrapped
 * around the one line worth reading. Tags neutralized inside a value stay as
 * they were sent, because this is a view of what the model received.
 */
export function systemNoteBody(text: string) {
  return text.replaceAll(NOTE_TAG_PATTERN, "").trim();
}

function neutralizeNoteTags(value: string) {
  return value.replaceAll(NOTE_TAG_PATTERN, "&lt;$1$2&gt;");
}
