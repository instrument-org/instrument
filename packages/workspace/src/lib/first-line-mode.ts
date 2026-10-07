import { type AgentName } from "../agents/types";
import { type FirstLineMode } from "../types";
import { ONE_AGENT_NAME } from "./one-agent-mode";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * The first-line experiment: three harness mechanisms, one per mode, that
 * get the one agent's chat to say a line to the user before its work rather
 * than after it. Each leaves the line in the transcript as the assistant's
 * own text, where the model and the chat both read it.
 *
 * - `tools-off`: the first step of a turn the user started is sent with
 *   `toolChoice: "none"`, the tools still in the request so the cached prefix
 *   holds, and a note saying the message goes out before any tool can run.
 *   A second step always follows, with tools and a note that the line went
 *   out, so a turn that needed nothing more can end without saying it twice.
 * - `say`: every tool offers a `say` field; the first call of a step with no
 *   text, in a turn with nothing said yet, has its `say` stored and streamed
 *   as a text part ahead of the call.
 * - `nudge`: when a turn's first tool results are back and nothing has been
 *   said, the next step carries a note asking for the line.
 *
 * Notes ride on the one request they are for and are never stored.
 */
export function firstLineMode(): FirstLineMode | undefined {
  return getWorkspaceConfig().firstLineMode?.();
}

/** A mode spelled the way the evals' `INSTRUMENT_EVAL_FIRST_LINE` gives it. */
export function parseFirstLineMode(
  value: string | undefined,
): FirstLineMode | undefined {
  return value === "nudge" || value === "say" || value === "tools-off"
    ? value
    : undefined;
}

/** Whether the `say` field is offered on an agent's tools. */
export function offersSay(agentName: AgentName): boolean {
  return agentName === ONE_AGENT_NAME && firstLineMode() === "say";
}
