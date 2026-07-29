import { z } from "zod";

export const TOOL_NAMES = {
  bash: "bash",
  choose: "choose",
  connectorCredentialPrompt: "connector_credential_prompt",
  connectorMcp: "connector_mcp",
  connectorOauthPrompt: "connector_oauth_prompt",
  connectorRequest: "connector_request",
  connectorTest: "connector_test",
  editFile: "edit_file",
  generateImage: "generate_image",
  loadSkill: "load_skill",
  readFile: "read_file",
  unavailable: "unavailable",
  webFetch: "web_fetch",
  webSearch: "web_search",
  writeFile: "write_file",
} as const;

export const ToolNameSchema = z.enum([
  TOOL_NAMES.bash,
  TOOL_NAMES.choose,
  TOOL_NAMES.connectorCredentialPrompt,
  TOOL_NAMES.connectorMcp,
  TOOL_NAMES.connectorOauthPrompt,
  TOOL_NAMES.connectorRequest,
  TOOL_NAMES.connectorTest,
  TOOL_NAMES.editFile,
  TOOL_NAMES.generateImage,
  TOOL_NAMES.loadSkill,
  TOOL_NAMES.readFile,
  TOOL_NAMES.unavailable,
  TOOL_NAMES.webFetch,
  TOOL_NAMES.webSearch,
  TOOL_NAMES.writeFile,
]);
