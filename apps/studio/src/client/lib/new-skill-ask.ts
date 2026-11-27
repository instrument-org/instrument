import { skillMentionToken } from "@instrument-org/shared/skill-mention";

/**
 * The start of a message that makes a new skill: it names the system skill
 * that knows how a skill is packaged, placed and checked, and leaves the rest
 * of the sentence to the person.
 */
export const NEW_SKILL_ASK = `Use ${skillMentionToken("skill-creator")} to make a skill that `;
