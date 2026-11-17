import { suggestionsFrom } from "../chat/next-message";

/** The longest idea kept: past this it no longer fits the corner whole. */
export const IDEA_MAX_CHARS = 72;

/** The most ideas a call returns: the corner shows the first, the rest when opened. */
export const IDEAS_MAX = 3;

/**
 * Lines that would fit any page, which say nothing about this one: "Summarize
 * this page", "Explain this", "What is this about?".
 */
const GENERIC =
  /^(?:(?:please\s+)?(?:summarize|summarise|explain|describe|analyze|analyse|review|read|translate|simplify|break down|tell me (?:more )?about|give me (?:a )?(?:summary|overview) of|what(?:'s| is)(?: this| it)?(?: all)? about)(?:\s+(?:this|the|these|that|it|my))?(?:\s+(?:page|pages|tab|tabs|article|site|website|document|doc|file|content|text|post|thread|email|for me))*|what(?:'s| is) (?:this|on this page)|tell me more|key (?:points|takeaways)(?: of this page)?|tl;?dr)[\s?.!]*$/i;

/** A verb that leaves the person's computer or can't be taken back, at the line's start. */
const IRREVERSIBLE_START =
  /^(?:delete|remove|trash|erase|send|email|reply|buy|purchase|order|pay|post|publish|tweet|submit|share|book|cancel|unsubscribe|sign up|subscribe)\b/i;

/** The same, anywhere in the line, for the verbs that are never a lookup. */
const IRREVERSIBLE_ANYWHERE =
  /\b(?:delete|buy|purchase|publish|unsubscribe)\b|\b(?:send|post) (?:it|this|them|a|an|the)\b/i;

/** A line about where the idea came from rather than an idea. */
const ABOUT_CONTEXT =
  /^(?:based on|from|given|looking at|since you(?:'re| are)?|as you)\b|\b(?:activity log|your activity|recent activity|your browsing|open tabs|the context|this context|you(?:'ve| have) been)\b/i;

/**
 * The ideas a model's answer offers, best first, or none: `suggestionsFrom`'s
 * cleanup and checks, then only lines short enough for the corner that are
 * specific to what's open, leave nothing irreversible to a press, don't talk
 * about the context they came from, and don't echo it back (a tab's title,
 * or the instruction's own words).
 */
export function ideasFrom(
  answer: string,
  echoes: { instruction?: string; titles?: readonly string[] } = {},
): string[] {
  const titles = new Set(
    (echoes.titles ?? []).map((title) => normalized(title)).filter(Boolean),
  );
  const instruction = normalized(echoes.instruction ?? "");
  return suggestionsFrom(answer)
    .filter((line) => {
      const plain = normalized(line);
      return (
        line.length <= IDEA_MAX_CHARS &&
        !GENERIC.test(line) &&
        !IRREVERSIBLE_START.test(line) &&
        !IRREVERSIBLE_ANYWHERE.test(line) &&
        !ABOUT_CONTEXT.test(line) &&
        !titles.has(plain) &&
        !(plain.length > 12 && instruction.includes(plain))
      );
    })
    .slice(0, IDEAS_MAX);
}

function normalized(text: string): string {
  return text
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
