import {
  AGENT_FILES_LANGUAGE,
  AGENT_MESSAGE_LANGUAGE,
  AGENT_TIMELINE_LANGUAGE,
} from "@instrument-org/workspace/client";

/**
 * The blocks a reply may name, however it wraps them, and the header keys
 * each one reads. One list for the wrapper pass and the renderer, so a name
 * the pass turns into a fence is always one the renderer draws.
 */
const REPLY_BLOCK_NAMES = [
  AGENT_FILES_LANGUAGE,
  AGENT_MESSAGE_LANGUAGE,
  AGENT_TIMELINE_LANGUAGE,
  "options",
  "chart",
  "numbers",
] as const;

export type ReplyBlockName = (typeof REPLY_BLOCK_NAMES)[number];

/** Other words a reply uses for a block. */
const ALIASES: Partial<Record<string, ReplyBlockName>> = {
  compare: "options",
  comparison: "options",
  figures: "numbers",
  stats: "numbers",
};

/** Every word that names a block: the names and their aliases. */
export const REPLY_BLOCK_WORDS: readonly string[] = [
  ...REPLY_BLOCK_NAMES,
  ...Object.keys(ALIASES),
];

/** The block a name written in a reply means, any case and alias; undefined for any other word. */
export const replyBlockNameOf = (
  written: string,
): ReplyBlockName | undefined => {
  const name = written.trim().toLowerCase();
  return REPLY_BLOCK_NAMES.find((known) => known === name) ?? ALIASES[name];
};

/**
 * The header lines each block reads from the top of its body. A block whose
 * body is itself `label: value` lines (numbers, a timeline) takes none, or
 * its first figure would be read as a setting. A message reads its own headers.
 */
export const HEADER_KEYS: Record<ReplyBlockName, readonly string[]> = {
  chart: ["type", "unit", "title", "highlight"],
  files: [],
  message: ["message", "kind", "sender", "to", "subject", "via"],
  numbers: [],
  options: ["pick"],
  timeline: [],
};
