import { type ToolName } from "@instrument-org/workspace/client";
import {
  BookOpenIcon,
  CodeIcon,
  EyeIcon,
  type Icon,
  ImageIcon,
  MagnifyingGlassIcon,
  QuestionIcon,
  TerminalIcon,
  WrenchIcon,
} from "@phosphor-icons/react";

// | undefined ensures runtime type safety
const TOOL_DISPLAY_NAMES: Record<ToolName, string | undefined> = {
  bash: "Ran terminal command",
  choose: "Waiting for answer",
  edit_file: "Edited",
  generate_image: "Generated image",
  load_skill: "Loaded skill",
  read_file: "Read",
  unavailable: "Used unknown tool",
  web_search: "Searched web",
  write_file: "Created",
};

const TOOL_STREAMING_DISPLAY_NAMES: Record<ToolName, string | undefined> = {
  bash: "Running terminal command",
  choose: "Thinking about a question",
  edit_file: "Editing a file",
  generate_image: "Generating an image",
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
  edit_file: "Editing",
  generate_image: "Generating",
  load_skill: "Loading skill",
  read_file: "Reading",
  unavailable: TOOL_STREAMING_DISPLAY_NAMES.unavailable,
  web_search: "Searching for",
  write_file: "Creating",
};

const TOOL_TRIED_DISPLAY_NAMES: Record<ToolName, string | undefined> = {
  bash: "Tried to run terminal command",
  choose: "Tried to ask a question",
  edit_file: "Tried to edit file",
  generate_image: "Tried to generate image",
  load_skill: "Tried to load skill",
  read_file: "Tried to read file",
  unavailable: "Tried unknown tool",
  web_search: "Tried to search the web",
  write_file: "Tried to create file",
};

export const TOOL_ICONS: Record<ToolName, Icon | undefined> = {
  bash: TerminalIcon,
  choose: QuestionIcon,
  edit_file: CodeIcon,
  generate_image: ImageIcon,
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
