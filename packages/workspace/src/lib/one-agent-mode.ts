import { type OneAgentMode } from "../types";
import { TASK_COMMAND } from "./shell-commands/task-command";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * How the `one_agent` feature flag has chats run, or none when the host left
 * it off. See `OneAgentMode`.
 */
export function oneAgentMode(): OneAgentMode | undefined {
  return getWorkspaceConfig().oneAgentMode?.();
}

/** How a switch outside the app asks for `fork` mode with fork on interrupt. */
export const FORK_ON_INTERRUPT = "fork-on-interrupt";

/**
 * A mode spelled the way a switch outside the app gives it (the evals'
 * `INSTRUMENT_EVAL_ONE_AGENT`): `1`, `fork` or `fork-on-interrupt` for
 * `fork`, `foreground`, `fork-only`, `background`, or anything else for off.
 */
export function parseOneAgentMode(
  value: string | undefined,
): OneAgentMode | undefined {
  switch (value) {
    case "1":
    case "fork":
    case FORK_ON_INTERRUPT:
      return "fork";
    case "background":
    case "foreground":
    case "fork-only":
      return value;
    default:
      return undefined;
  }
}

/**
 * Whether a mode forks work to the background: every mode but `foreground`.
 */
export function forksToBackground(mode: OneAgentMode | undefined): boolean {
  return mode !== undefined && mode !== "foreground";
}

/**
 * Whether a mode is the fork-only design (`fork-only`, or `background`,
 * which only renames it): every task is a fork in the chat's folder.
 */
export function isForkOnly(mode: OneAgentMode | undefined): boolean {
  return mode === "fork-only" || mode === "background";
}

/** Whether the chat's mode right now is the fork-only design. */
export function isForkOnlyEnabled(): boolean {
  return isForkOnly(oneAgentMode());
}

/** The command the `background` mode names its forks by. */
export const BACKGROUND_COMMAND_NAME = "background";

/**
 * The command the agent starts and reaches its forks with: `background` in
 * the `background` mode, `task` in every other.
 */
export function forkCommandName(): string {
  return oneAgentMode() === "background"
    ? BACKGROUND_COMMAND_NAME
    : TASK_COMMAND.name;
}

/**
 * Text the agent reads about its forks (a command's output, a note that one
 * finished), in the mode's own words: unchanged except in the `background`
 * mode, where the `task` command is the `background` one and a task is
 * background work. Paths (`/task`, `/tasks/<id>`) keep their spelling.
 */
export function inForkWords(text: string): string {
  if (oneAgentMode() !== "background") {
    return text;
  }
  const word = String.raw`(?<![\w/.-])`;
  const end = String.raw`(?![\w/-])`;
  return text
    .replaceAll(
      new RegExp(
        `${word}${TASK_COMMAND.name}(?= (?:new|send|stop|show|log|list|folder|fork|help)\\b)`,
        "g",
      ),
      BACKGROUND_COMMAND_NAME,
    )
    .replaceAll(
      new RegExp(`${word}(A|a) new task${end}`, "g"),
      (_, article: string) =>
        article === "A" ? "New background work" : "new background work",
    )
    .replaceAll(
      new RegExp(`${word}(A|a|One|one) tasks?${end}`, "g"),
      (_, article: string) =>
        /^[Aa]$/.test(article)
          ? `${article === "A" ? "B" : "b"}ackground work`
          : `${article} background run`,
    )
    .replaceAll(new RegExp(`${word}Tasks${end}`, "g"), "Background runs")
    .replaceAll(new RegExp(`${word}tasks${end}`, "g"), "background runs")
    .replaceAll(new RegExp(`${word}Task${end}`, "g"), "Background work")
    .replaceAll(new RegExp(`${word}task${end}`, "g"), "background work");
}
