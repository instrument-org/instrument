import type { ToolName } from "../tools/types";

// Interactive tools are never executed: the agent machine parks them as
// pending tool calls and the UI resolves them via the
// message.resolveInteractiveToolCall RPC.
export function isInteractiveTool(toolName: ToolName): boolean {
  return (
    toolName === "choose" ||
    toolName === "connector_credential_prompt" ||
    toolName === "connector_oauth_prompt"
  );
}
