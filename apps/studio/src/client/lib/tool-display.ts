import {
  isTaskAgentName,
  type SessionMessagePart,
  type TaskAgentName,
  type ToolName,
} from "@instrument-org/workspace/client";
import {
  BookOpenIcon,
  CodeIcon,
  EyeIcon,
  FileMagnifyingGlassIcon,
  FolderSimplePlusIcon,
  type Icon,
  ImageIcon,
  ListMagnifyingGlassIcon,
  MagnifyingGlassIcon,
  QuestionIcon,
  TerminalIcon,
  TreeStructureIcon,
  WrenchIcon,
} from "@phosphor-icons/react";

const TASK_DISPLAY_NAMES: Record<TaskAgentName, string> = {
  retrieval: "Retrieved",
};

const TASK_STREAMING_DISPLAY_NAMES: Record<TaskAgentName, string> = {
  retrieval: "Retrieving",
};

const TASK_TRIED_DISPLAY_NAMES: Record<TaskAgentName, string> = {
  retrieval: "Tried to retrieve",
};

// | undefined ensures runtime type safety
const TOOL_DISPLAY_NAMES: Record<ToolName, string | undefined> = {
  agent: "Agent",
  bash: "Ran terminal command",
  choose: "Waiting for answer",
  copy_to_task: "Copied to task",
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
  agent: "Agent",
  bash: "Running terminal command",
  choose: "Thinking about a question",
  copy_to_task: "Copying to task",
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
  agent: TOOL_STREAMING_DISPLAY_NAMES.agent,
  bash: TOOL_STREAMING_DISPLAY_NAMES.bash,
  choose: TOOL_STREAMING_DISPLAY_NAMES.choose,
  copy_to_task: "Copying",
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
  agent: "Tried to run agent",
  bash: "Tried to run terminal command",
  choose: "Tried to ask a question",
  copy_to_task: "Tried to copy to task",
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
  agent: TreeStructureIcon,
  bash: TerminalIcon,
  choose: QuestionIcon,
  copy_to_task: FolderSimplePlusIcon,
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
  part,
  state,
  toolName,
}: {
  hasCapabilityFailure?: boolean;
  hasValue?: boolean;
  part: SessionMessagePart.ToolPart;
  state: "completed" | "streaming" | "tried";
  toolName: ToolName;
}): string {
  if (toolName !== "agent") {
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

  const taskAgentName =
    part.type === "tool-agent" && part.input
      ? part.input.agent_type
      : undefined;

  const taskState =
    state === "completed" && hasCapabilityFailure ? "tried" : state;

  return getTaskToolLabel(taskAgentName, taskState);
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

function getTaskToolLabel(
  agentName: string | undefined,
  state: "completed" | "streaming" | "tried",
): string {
  if (typeof agentName !== "string" || !isTaskAgentName(agentName)) {
    return "Planning…";
  }

  switch (state) {
    case "completed": {
      return TASK_DISPLAY_NAMES[agentName];
    }
    case "streaming": {
      return TASK_STREAMING_DISPLAY_NAMES[agentName];
    }
    case "tried": {
      return TASK_TRIED_DISPLAY_NAMES[agentName];
    }
  }
}

function getToolTriedLabel(toolName: ToolName): string {
  return TOOL_TRIED_DISPLAY_NAMES[toolName] ?? "Tried tool";
}
