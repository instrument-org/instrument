import { type AgentName } from "../agents/types";
import { TOOL_SAY_PARAM_NAME } from "../constants";
import { type SessionMessage } from "../schemas/session/message";
import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { type FirstLineMode } from "../types";
import { isToolPart } from "./is-tool-part";
import { ONE_AGENT_NAME } from "./one-agent-mode";
import { resolveChat } from "./record-folders";
import { Store } from "./store";
import { systemNote } from "./system-note";
import { isTypedByUser } from "./typed-by-user";
import { firstLineMode } from "./first-line-mode";

/**
 * The mode a session's requests run under (see `first-line-mode.ts`): the
 * one agent's, in a chat. A fork runs the same agent, but nobody reads its
 * lines as they come.
 */
export function firstLineModeFor({
  agentName,
  taskId,
}: {
  agentName: AgentName;
  taskId: TaskId;
}): FirstLineMode | undefined {
  if (agentName !== ONE_AGENT_NAME || resolveChat(taskId) === undefined) {
    return undefined;
  }
  return firstLineMode();
}

/** The current turn as the stored transcript has it, before the next step. */
export interface TurnSoFar {
  /** Whether the turn's opening message is the user's own words. */
  byUser: boolean;
  /** Whether any step of the turn called a tool. */
  calledTools: boolean;
  /** Whether any step of the turn wrote non-empty text. */
  said: boolean;
  /** Steps the turn has taken; one that failed is not counted. */
  steps: number;
}

export function turnSoFar(messages: SessionMessage.WithParts[]): TurnSoFar {
  const start = messages.findLastIndex((message) => message.role === "user");
  const opener = messages[start];
  const steps = messages
    .slice(start + 1)
    .filter(
      (message) =>
        message.role === "assistant" &&
        message.metadata.error === undefined &&
        !message.metadata.synthetic,
    );
  return {
    byUser:
      opener !== undefined &&
      !opener.metadata.inherited &&
      isTypedByUser(opener),
    calledTools: steps.some((message) =>
      message.parts.some((part) => isToolPart(part)),
    ),
    said: steps.some((message) =>
      message.parts.some(
        (part) => part.type === "text" && part.text.trim() !== "",
      ),
    ),
    steps: steps.length,
  };
}

export const TOOLS_OFF_NOTE = systemNote`
  Tools are off for this one message and come back right after it. Write one sentence to the user now, in plain text: what you will do, or the answer itself when it needs no tools. Never state as fact something you would need to check.
`;

export const AFTER_FIRST_LINE_NOTE = systemNote`
  Your message above has reached the user, and your tools are back. Do the work if it needs them; if nothing is left to do, end without writing anything more.
`;

export const NUDGE_NOTE = systemNote`
  The user has not seen a reply yet. Say one line to them about what you are doing, then continue.
`;

/** What the next step of a turn is sent with under a mode. */
export interface FirstLineStep {
  /** A note appended to this request alone. */
  note?: string;
  /** Whether a `say` on the step's first call becomes the turn's first line. */
  takesSay: boolean;
  toolChoice?: "none";
}

export function firstLineStep(
  mode: FirstLineMode | undefined,
  turn: TurnSoFar,
): FirstLineStep {
  switch (mode) {
    case "nudge": {
      return turn.byUser && turn.steps === 1 && turn.calledTools && !turn.said
        ? { note: NUDGE_NOTE, takesSay: false }
        : { takesSay: false };
    }
    case "say": {
      return { takesSay: !turn.said };
    }
    case "tools-off": {
      if (!turn.byUser) {
        return { takesSay: false };
      }
      if (turn.steps === 0) {
        return { note: TOOLS_OFF_NOTE, takesSay: false, toolChoice: "none" };
      }
      return turn.steps === 1 && !turn.calledTools
        ? { note: AFTER_FIRST_LINE_NOTE, takesSay: false }
        : { takesSay: false };
    }
    case undefined: {
      return { takesSay: false };
    }
  }
}

/**
 * What a session's next step is sent with, read from its stored transcript.
 * Reads nothing when no mode applies.
 */
export async function firstLineStepFor({
  agentName,
  sessionId,
  signal,
  taskId,
}: {
  agentName: AgentName;
  sessionId: StoreId.Session;
  signal?: AbortSignal;
  taskId: TaskId;
}): Promise<FirstLineStep> {
  const mode = firstLineModeFor({ agentName, taskId });
  if (mode === undefined) {
    return { takesSay: false };
  }
  const messages = await Store.getMessagesWithParts(
    { sessionId, taskId },
    { signal },
  );
  return messages.isOk()
    ? firstLineStep(mode, turnSoFar(messages.value))
    : { takesSay: false };
}

/**
 * Whether the turn takes another step that the agent's own rule would end:
 * under `tools-off`, the text-only first step is always followed by one with
 * tools.
 */
export function firstLineContinues(
  mode: FirstLineMode | undefined,
  turn: TurnSoFar,
): boolean {
  return (
    mode === "tools-off" && turn.byUser && turn.steps === 1 && !turn.calledTools
  );
}

/** The `say` a call's input carries, trimmed, when it carries one. */
export function sayOf(input: unknown): string | undefined {
  if (
    typeof input !== "object" ||
    input === null ||
    !(TOOL_SAY_PARAM_NAME in input)
  ) {
    return undefined;
  }
  const say = input[TOOL_SAY_PARAM_NAME];
  return typeof say === "string" && say.trim() !== "" ? say.trim() : undefined;
}
