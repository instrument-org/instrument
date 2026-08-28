import {
  type SkillMentionSegment,
  splitSkillMention,
} from "@instrument-org/shared/skill-mention";

import { type LinkTextSegment, splitLinks } from "./link-text";

/** A sent message's segments: the skill references, plus the links. */
export type MessageTextSegment =
  | Exclude<LinkTextSegment, { type: "text" }>
  | SkillTextSegment;

export type SkillTextSegment =
  | SkillMentionSegment
  | { name: string; type: "slash" };

// A bare `/name`, typed or pasted rather than picked from the composer's menu.
// Anchored to the start of the line or to whitespace so a path segment
// (`src/lib`) and the tail of a URL never read as one, and bounded by the
// characters a skill name may hold so trailing punctuation ("use /release.")
// stays text.
const SLASH_COMMAND_PATTERN = /(^|\s)\/([\w:-]+)/g;

/**
 * The same split, plus the links the line carries.
 *
 * Apart from `splitSkillText` because that one also builds the composer's
 * tokens, and a URL turning into a chip under the caret while it is still being
 * typed is not something anyone asked for. A sent message is read rather than
 * edited, so it is the only one that gets links.
 *
 * Links are taken before slash commands, so a destination is never re-split by
 * a pass that has no idea it is inside one.
 */
export function splitMessageText(line: string): MessageTextSegment[] {
  return splitSkillMention(line).flatMap((segment) =>
    segment.type === "text" ? splitLinksAndCommands(segment.text) : [segment],
  );
}

/**
 * Split one line into the skill references it carries and the text around them.
 *
 * A `skill` segment is the composer's own token, so it already names a skill the
 * user picked from the menu. A `slash` segment is only a candidate: nothing has
 * checked that a skill by that name exists, which is the caller's job before it
 * shows one as a link.
 */
export function splitSkillText(line: string): SkillTextSegment[] {
  return splitSkillMention(line).flatMap((segment) =>
    segment.type === "text" ? splitSlashCommands(segment.text) : [segment],
  );
}

function splitLinksAndCommands(text: string): MessageTextSegment[] {
  return splitLinks(text).flatMap((segment): MessageTextSegment[] =>
    segment.type === "text" ? splitSlashCommands(segment.text) : [segment],
  );
}

function splitSlashCommands(text: string): SkillTextSegment[] {
  const segments: SkillTextSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(SLASH_COMMAND_PATTERN)) {
    const name = match[2];
    if (!name) {
      continue;
    }
    // The leading whitespace is only an anchor, so it belongs to the text
    // before the command rather than to the command itself.
    const start = match.index + (match[1]?.length ?? 0);
    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start), type: "text" });
    }
    segments.push({ name, type: "slash" });
    cursor = start + name.length + 1;
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), type: "text" });
  }

  return segments;
}
