import { type ToolName } from "@instrument-org/workspace/client";
import {
  BookOpenIcon,
  CodeIcon,
  EyeIcon,
  FileMagnifyingGlassIcon,
  type Icon,
  ImageIcon,
  ListMagnifyingGlassIcon,
  LockKeyIcon,
  MagnifyingGlassIcon,
  PlugsConnectedIcon,
  PlugsIcon,
  QuestionIcon,
  TerminalIcon,
  WrenchIcon,
} from "@phosphor-icons/react";

// | undefined ensures runtime type safety
const TOOL_DISPLAY_NAMES: Record<ToolName, string | undefined> = {
  bash: "Ran terminal command",
  choose: "Waiting for answer",
  connector_credential_prompt: "Requested credential",
  connector_mcp: "Used MCP connector",
  connector_oauth_prompt: "Requested sign-in",
  connector_request: "Queried connector",
  connector_test: "Tested connector",
  edit_file: "Edited",
  generate_image: "Generated image",
  glob: "Searched files",
  grep: "Searched text",
  load_skill: "Loaded skill",
  read_file: "Read",
  unavailable: "Used unknown tool",
  web_search: "Searched web",
  write_file: "Created",
};

const TOOL_STREAMING_DISPLAY_NAMES: Record<ToolName, string | undefined> = {
  bash: "Running terminal command",
  choose: "Thinking about a question",
  connector_credential_prompt: "Requesting credential",
  connector_mcp: "Using MCP connector",
  connector_oauth_prompt: "Requesting sign-in",
  connector_request: "Querying connector",
  connector_test: "Testing connector",
  edit_file: "Editing a file",
  generate_image: "Generating an image",
  glob: "Searching files",
  grep: "Searching text",
  load_skill: "Loading skill",
  read_file: "Reading file",
  unavailable: "Using unknown tool",
  web_search: "Searching the web",
  write_file: "Creating a file",
};

const TOOL_STREAMING_DISPLAY_NAMES_WITH_VALUE: Record<
  ToolName,
  string | undefined
> = {
  bash: TOOL_STREAMING_DISPLAY_NAMES.bash,
  choose: TOOL_STREAMING_DISPLAY_NAMES.choose,
  connector_credential_prompt: "Requesting credential",
  connector_mcp: "Using",
  connector_oauth_prompt: "Requesting sign-in",
  connector_request: "Querying",
  connector_test: "Testing",
  edit_file: "Editing",
  generate_image: "Generating",
  glob: "Searching for",
  grep: "Searching for",
  load_skill: "Loading skill",
  read_file: "Reading",
  unavailable: TOOL_STREAMING_DISPLAY_NAMES.unavailable,
  web_search: "Searching for",
  write_file: "Creating",
};

const TOOL_TRIED_DISPLAY_NAMES: Record<ToolName, string | undefined> = {
  bash: "Tried to run terminal command",
  choose: "Tried to ask a question",
  connector_credential_prompt: "Tried to request credential",
  connector_mcp: "Tried to use MCP connector",
  connector_oauth_prompt: "Tried to request sign-in",
  connector_request: "Tried to query connector",
  connector_test: "Tried to test connector",
  edit_file: "Tried to edit file",
  generate_image: "Tried to generate image",
  glob: "Tried to search files",
  grep: "Tried to search text",
  load_skill: "Tried to load skill",
  read_file: "Tried to read file",
  unavailable: "Tried unknown tool",
  web_search: "Tried to search the web",
  write_file: "Tried to create file",
};

export const TOOL_ICONS: Record<ToolName, Icon | undefined> = {
  bash: TerminalIcon,
  choose: QuestionIcon,
  connector_credential_prompt: LockKeyIcon,
  connector_mcp: PlugsConnectedIcon,
  connector_oauth_prompt: PlugsConnectedIcon,
  connector_request: PlugsConnectedIcon,
  connector_test: PlugsIcon,
  edit_file: CodeIcon,
  generate_image: ImageIcon,
  glob: ListMagnifyingGlassIcon,
  grep: FileMagnifyingGlassIcon,
  load_skill: BookOpenIcon,
  read_file: EyeIcon,
  unavailable: WrenchIcon,
  web_search: MagnifyingGlassIcon,
  write_file: CodeIcon,
};

export function getToolLabel(toolName: ToolName): string {
  return TOOL_DISPLAY_NAMES[toolName] ?? "Unknown tool";
}

export function getToolLabelForPart({
  hasCapabilityFailure,
  hasValue,
  state,
  toolName,
}: {
  hasCapabilityFailure?: boolean;
  hasValue?: boolean;
  state: "completed" | "streaming" | "tried";
  toolName: ToolName;
}): string {
  switch (state) {
    case "completed": {
      return hasCapabilityFailure
        ? getToolTriedLabel(toolName)
        : getToolLabel(toolName);
    }
    case "streaming": {
      return getToolStreamingLabel(toolName, hasValue);
    }
    case "tried": {
      return getToolTriedLabel(toolName);
    }
  }
}

export function getToolStreamingLabel(
  toolName: ToolName,
  hasValue = false,
): string {
  const names = hasValue
    ? TOOL_STREAMING_DISPLAY_NAMES_WITH_VALUE
    : TOOL_STREAMING_DISPLAY_NAMES;
  return names[toolName] ?? "Processing";
}

function getToolTriedLabel(toolName: ToolName): string {
  return TOOL_TRIED_DISPLAY_NAMES[toolName] ?? "Tried tool";
}
