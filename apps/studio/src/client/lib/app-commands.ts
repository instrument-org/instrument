import { type Icon } from "@phosphor-icons/react";
import { CardsThreeIcon } from "@phosphor-icons/react/CardsThree";

/**
 * Something the app does when a slash names it, rather than anything the
 * prompt is given: choosing it takes the slash back out and runs it. Only a
 * slash that starts the box offers one, unless it answers `anywhere`.
 */
export interface ComposerCommand {
  /** Every name it answers to; the menu shows the one being typed. */
  aliases: readonly string[];
  /** Offered for a slash after other words too, as one about the chat rather than the words is. */
  anywhere?: boolean;
  description: string;
  icon: Icon;
  id: string;
  onSelect: () => void;
}

/** `/project`, which every composer of a chat's answers with its own list of projects. */
export function projectCommand(onSelect: () => void): ComposerCommand {
  return {
    aliases: ["project"],
    anywhere: true,
    description: "File this chat under a project",
    icon: CardsThreeIcon,
    id: "project",
    onSelect,
  };
}

/** What `/feedback` also answers to. */
export const FEEDBACK_COMMAND_ALIASES = ["feedback", "bug", "report"] as const;

/**
 * The commands a slash answers with, each under the first of its names the
 * query begins, so `/bu` offers `/bug` and a bare slash `/feedback`.
 */
export function matchComposerCommands(
  commands: readonly ComposerCommand[],
  { atStart, query }: { atStart: boolean; query: string },
): { command: ComposerCommand; name: string }[] {
  const typed = query.toLowerCase();
  return commands.flatMap((command) => {
    if (!atStart && !command.anywhere) {
      return [];
    }
    const name = command.aliases.find((alias) => alias.startsWith(typed));
    return name ? [{ command, name }] : [];
  });
}
