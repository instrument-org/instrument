import { type ToolName } from "@instrument-org/workspace/client";
import { type Icon } from "@phosphor-icons/react";
import { BookOpenIcon } from "@phosphor-icons/react/BookOpen";
import { CodeIcon } from "@phosphor-icons/react/Code";
import { EyeIcon } from "@phosphor-icons/react/Eye";
import { FlagIcon } from "@phosphor-icons/react/Flag";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { ImageIcon } from "@phosphor-icons/react/Image";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { QuestionIcon } from "@phosphor-icons/react/Question";
import { TerminalIcon } from "@phosphor-icons/react/Terminal";
import { WrenchIcon } from "@phosphor-icons/react/Wrench";

// | undefined ensures runtime type safety
const TOOL_DISPLAY_NAMES: Record<ToolName, string | undefined> = {
  bash: "Ran terminal command",
  choose: "Waiting for answer",
  edit_file: "Edited",
  generate_image: "Generated image",
  load_skill: "Loaded skill",
  read_file: "Read",
  start_activity: "Started working",
  unavailable: "Used unknown tool",
  web_fetch: "Read web page",
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
  start_activity: "Starting work",
  unavailable: "Using unknown tool",
  web_fetch: "Reading web page",
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
  start_activity: TOOL_STREAMING_DISPLAY_NAMES.start_activity,
  unavailable: TOOL_STREAMING_DISPLAY_NAMES.unavailable,
  web_fetch: "Reading",
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
  start_activity: "Tried to start work",
  unavailable: "Tried unknown tool",
  web_fetch: "Tried to read web page",
  web_search: "Tried to search the web",
  write_file: "Tried to create file",
};

// Past-tense phrases for the heading generated over a run of calls the agent
// never named. Lower case, because all but the first are read mid-sentence.
// `plural` is omitted where a count says nothing worth the words: how many
// searches went into an answer is not what the reader is deciding on.
const TOOL_SUMMARY_PHRASES: Record<
  ToolName,
  undefined | { plural?: (count: number) => string; singular: string }
> = {
  bash: {
    plural: (count) => `ran ${count} commands`,
    singular: "ran a command",
  },
  choose: { singular: "asked a question" },
  edit_file: {
    plural: (count) => `edited ${count} files`,
    singular: "edited a file",
  },
  generate_image: {
    plural: (count) => `generated ${count} images`,
    singular: "generated an image",
  },
  load_skill: { singular: "loaded a skill" },
  read_file: {
    plural: (count) => `read ${count} files`,
    singular: "read a file",
  },
  // Never summarized: it is the heading, not a step under one.
  start_activity: undefined,
  unavailable: { singular: "used an unknown tool" },
  web_fetch: {
    plural: (count) => `read ${count} web pages`,
    singular: "read a web page",
  },
  web_search: { singular: "searched the web" },
  write_file: {
    plural: (count) => `created ${count} files`,
    singular: "created a file",
  },
};

export const TOOL_ICONS: Record<ToolName, Icon | undefined> = {
  bash: TerminalIcon,
  choose: QuestionIcon,
  edit_file: CodeIcon,
  generate_image: ImageIcon,
  load_skill: BookOpenIcon,
  read_file: EyeIcon,
  start_activity: FlagIcon,
  unavailable: WrenchIcon,
  web_fetch: GlobeIcon,
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

/**
 * Names a run of calls the agent never gave a heading to: "Read 3 files and ran
 * a command".
 *
 * Counting, not narrating. It says what the run touched and how much of it,
 * which is what a reader deciding whether to open the group needs; what any one
 * call was for is on the row inside. Tools are listed in the order they first
 * appear, so the phrase tracks how the work actually went.
 */
export function summarizeToolRun(toolNames: ToolName[]): string {
  const counts = new Map<ToolName, number>();
  for (const toolName of toolNames) {
    if (TOOL_SUMMARY_PHRASES[toolName]) {
      counts.set(toolName, (counts.get(toolName) ?? 0) + 1);
    }
  }

  const clauses: string[] = [];
  for (const [toolName, count] of counts) {
    const phrase = TOOL_SUMMARY_PHRASES[toolName];
    if (phrase) {
      clauses.push(
        count > 1 && phrase.plural ? phrase.plural(count) : phrase.singular,
      );
    }
  }

  const last = clauses.pop();
  if (last === undefined) {
    return "Worked on it";
  }
  const sentence =
    clauses.length === 0 ? last : `${clauses.join(", ")} and ${last}`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function getToolTriedLabel(toolName: ToolName): string {
  return TOOL_TRIED_DISPLAY_NAMES[toolName] ?? "Tried tool";
}
