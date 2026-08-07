import { call, type ToolCall, type ToolOutput } from "./script";

// A fixed mtime, so a scenario reads the same every time it is built.
const MODIFIED_AT = 1_718_198_400_000;

/** `start_activity`: the heading the agent puts over the phase it is starting. */
export function activity(title: string): ToolCall {
  return call({ input: { title }, output: {}, type: "tool-start_activity" });
}

export function edited({
  explanation,
  filePath,
  newString,
  oldString,
}: {
  explanation: string;
  filePath: string;
  newString: string;
  oldString: string;
}): ToolCall {
  return call({
    input: { explanation, filePath, newString, oldString },
    output: {
      diff: `- ${oldString}\n+ ${newString}`,
      filePath,
      modifiedAt: MODIFIED_AT,
    },
    type: "tool-edit_file",
  });
}

export function ran({
  command,
  explanation,
  output = "",
}: {
  command: string;
  explanation: string;
  output?: string;
}): ToolCall {
  return call({
    input: { command, explanation },
    output: {
      command,
      commands: [command.split(" ")[0] ?? command],
      durationMs: 120,
      exitCode: 0,
      output,
    },
    type: "tool-bash",
  });
}

/** A command that ran and came back non-zero, which is not a tool failure. */
export function ranAndFailed({
  command,
  explanation,
  output,
}: {
  command: string;
  explanation: string;
  output: string;
}): ToolCall {
  return call({
    input: { command, explanation },
    output: {
      command,
      commands: [command.split(" ")[0] ?? command],
      durationMs: 90,
      exitCode: 1,
      output,
    },
    type: "tool-bash",
  });
}

export function read({
  content = "region,revenue\nnorth,48200\nsouth,51150",
  explanation,
  filePath,
}: {
  content?: string;
  explanation: string;
  filePath: string;
}): ToolCall {
  return call({
    input: { explanation, filePath },
    output: fileContents(filePath, content),
    type: "tool-read_file",
  });
}

/** A read of something that is not there, which draws as a failed row. */
export function readMissing({
  explanation,
  filePath,
}: {
  explanation: string;
  filePath: string;
}): ToolCall {
  return call({
    input: { explanation, filePath },
    output: { filePath, state: "does-not-exist", suggestions: [] },
    type: "tool-read_file",
  });
}

export function searched({ query }: { query: string }): ToolCall {
  return call({
    input: { query },
    output: {
      results: {
        costDollars: 0.01,
        kind: "excerpts",
        sources: [
          {
            text: "Legends belong outside the plot area when the series count is small.",
            title: "Chart legends",
            url: "https://example.com/legends",
          },
        ],
      },
      state: "success",
    },
    type: "tool-web_search",
  });
}

/** A call the runtime could not complete: the row that says the tool broke. */
export function threw({
  error,
  explanation,
  filePath,
}: {
  error: string;
  explanation: string;
  filePath: string;
}): ToolCall {
  return call({
    error,
    input: { content: "", explanation, filePath },
    type: "tool-write_file",
  });
}

export function wrote({
  content,
  explanation,
  filePath,
}: {
  content: string;
  explanation: string;
  filePath: string;
}): ToolCall {
  return call({
    input: { content, explanation, filePath },
    output: { content, filePath, isNewFile: true, modifiedAt: MODIFIED_AT },
    type: "tool-write_file",
  });
}

function fileContents(
  filePath: string,
  content: string,
): ToolOutput<"tool-read_file"> {
  const lines = content.split("\n").length;
  return {
    content,
    displayedLines: lines,
    filePath,
    hasMoreLines: false,
    modifiedAt: MODIFIED_AT,
    offset: 1,
    state: "exists",
    totalLines: lines,
    truncatedByBytes: false,
  };
}
