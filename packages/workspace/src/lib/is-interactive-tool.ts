import type { ToolName } from "../tools/types";

import { TOOL_NAMES } from "../tools/name";

// Interactive tools are never executed: the agent machine parks them as
// pending tool calls and the UI resolves them via the
// message.resolveInteractiveToolCall RPC.
export function isInteractiveTool(toolName: ToolName): boolean {
  return (
    toolName === TOOL_NAMES.choose ||
    toolName === TOOL_NAMES.connectorCredentialPrompt ||
    toolName === TOOL_NAMES.connectorOauthPrompt
  );
}
