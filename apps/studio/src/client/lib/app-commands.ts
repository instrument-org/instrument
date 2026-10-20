import { type Icon } from "@phosphor-icons/react";

/**
 * Something the app does when a slash names it as the first thing in the box,
 * rather than anything the prompt is given: choosing it takes the slash back
 * out and runs it.
 */
export interface ComposerCommand {
  /** Every name it answers to; the menu shows the one being typed. */
  aliases: readonly string[];
  description: string;
  icon: Icon;
  id: string;
  onSelect: () => void;
}

/** What `/feedback` also answers to. */
export const FEEDBACK_COMMAND_ALIASES = ["feedback", "bug", "report"] as const;

/**
 * The commands a slash answers with, each under the first of its names the
 * query begins, so `/bu` offers `/bug` and a bare slash `/feedback`.
 */
export function matchComposerCommands(
  commands: readonly ComposerCommand[],
  query: string,
): { command: ComposerCommand; name: string }[] {
  const typed = query.toLowerCase();
  return commands.flatMap((command) => {
    const name = command.aliases.find((alias) => alias.startsWith(typed));
    return name ? [{ command, name }] : [];
  });
}
