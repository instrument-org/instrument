import { z } from "zod";

export const TOOL_NAMES = {
  bash: "bash",
  choose: "choose",
  editFile: "edit_file",
  generateImage: "generate_image",
  grep: "grep",
  loadSkill: "load_skill",
  readFile: "read_file",
  unavailable: "unavailable",
  webSearch: "web_search",
  writeFile: "write_file",
} as const;

export const ToolNameSchema = z.enum([
  TOOL_NAMES.bash,
  TOOL_NAMES.choose,
  TOOL_NAMES.editFile,
  TOOL_NAMES.generateImage,
  TOOL_NAMES.grep,
  TOOL_NAMES.loadSkill,
  TOOL_NAMES.readFile,
  TOOL_NAMES.unavailable,
  TOOL_NAMES.webSearch,
  TOOL_NAMES.writeFile,
]);
