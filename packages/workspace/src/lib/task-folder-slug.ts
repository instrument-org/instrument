import { renderSkillMentionsAsText } from "@instrument-org/shared/skill-mention";

// Leaves room for the "YYYY-MM-DD-" prefix (11) and a "-NN" collision suffix
// within the 63-char subdomain limit enforced by SubdomainPartSchema.
const MAX_SLUG_LENGTH = 40;

// Derives a filesystem- and subdomain-safe slug from a user's prompt: lowercase
// alphanumeric runs joined with hyphens, truncated at token boundaries. A skill
// mention counts as the `/name` it reads as, since slugging its wire form would
// spend the budget on markup and on the name twice over. Returns an empty string
// when the prompt has no usable characters (e.g. emoji/CJK only).
export function taskFolderSlug(prompt: string): string {
  const tokens = renderSkillMentionsAsText(prompt)
    // NFKD + diacritic strip folds accented characters to ASCII (é -> e)
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036F]/g, "")
    .toLowerCase()
    .match(/[a-z0-9]+/g);

  if (!tokens || tokens.length === 0) {
    return "";
  }

  let slug = "";
  for (const token of tokens) {
    const next = slug ? `${slug}-${token}` : token;
    if (next.length > MAX_SLUG_LENGTH) {
      break;
    }
    slug = next;
  }

  // A single first token longer than the cap gets hard-truncated.
  return slug || tokens[0].slice(0, MAX_SLUG_LENGTH);
}
