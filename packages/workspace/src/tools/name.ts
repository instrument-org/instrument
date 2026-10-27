import { z } from "zod";

export const TOOL_NAMES = {
  askPermission: "ask_permission",
  bash: "bash",
  choose: "choose",
  connectApp: "connect_app",
  editFile: "edit_file",
  generateImage: "generate_image",
  loadSkill: "load_skill",
  offerFeedback: "offer_feedback",
  readFile: "read_file",
  unavailable: "unavailable",
  webFetch: "web_fetch",
  webSearch: "web_search",
  writeFile: "write_file",
} as const;

export const ToolNameSchema = z.enum([
  TOOL_NAMES.askPermission,
  TOOL_NAMES.bash,
  TOOL_NAMES.choose,
  TOOL_NAMES.connectApp,
  TOOL_NAMES.editFile,
  TOOL_NAMES.generateImage,
  TOOL_NAMES.loadSkill,
  TOOL_NAMES.offerFeedback,
  TOOL_NAMES.readFile,
  TOOL_NAMES.unavailable,
  TOOL_NAMES.webFetch,
  TOOL_NAMES.webSearch,
  TOOL_NAMES.writeFile,
]);
