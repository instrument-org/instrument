import { OUR_MODELS, OUR_PROVIDER_CONFIG } from "@instrument-org/shared";
import { RelativePathSchema } from "@instrument-org/workspace/client";

import { call, type ToolCall, type ToolOutput } from "./script";

// A fixed mtime. Nothing here writes a file, so it is only ever the version
// stamp the asset URL a card builds depends on, and a fixed one means a
// scenario reads the same every time it is built.
const MODIFIED_AT = 1_718_198_400_000;

const OUR_PROVIDER = {
  displayName: "Instrument",
  id: OUR_PROVIDER_CONFIG.id,
  type: OUR_PROVIDER_CONFIG.type,
};

const NO_USAGE = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

/** `start_activity`: the heading the agent puts over the phase it is starting. */
export function activity(title: string): ToolCall {
  return call({ input: { title }, output: {}, type: "tool-start_activity" });
}

/** A question put to the user, and the answer that came back. */
export function chose({
  choices,
  explanation,
  question,
  selected,
}: {
  choices: string[];
  explanation?: string;
  question: string;
  selected: string;
}): ToolCall {
  return call({
    input: { choices, explanation, question },
    output: { selectedChoice: selected },
    type: "tool-choose",
  });
}

export function edited({
  explanation,
  filePath,
  newString,
  oldString,
  streamedPath,
}: {
  explanation?: string;
  filePath: string;
  newString: string;
  oldString: string;
  /** Half a path, for watching the chip a row draws fill itself in. */
  streamedPath?: string;
}): ToolCall {
  return call({
    input: { explanation, filePath, newString, oldString },
    output: {
      diff: `- ${oldString}\n+ ${newString}`,
      filePath,
      modifiedAt: MODIFIED_AT,
    },
    streamed: streamedPath
      ? { explanation, filePath: streamedPath }
      : undefined,
    type: "tool-edit_file",
  });
}

export function fetched({
  explanation,
  streamedUrl,
  text,
  url,
}: {
  explanation?: string;
  /** Half a URL, for watching the source link a row draws fill itself in. */
  streamedUrl?: string;
  text: string;
  url: string;
}): ToolCall {
  return call({
    input: { explanation, url },
    output: {
      contentType: "text/html",
      format: "markdown",
      state: "success",
      text,
      truncated: false,
      url,
    },
    streamed: streamedUrl ? { explanation, url: streamedUrl } : undefined,
    type: "tool-web_fetch",
  });
}

export function generated({
  explanation,
  filePath,
  parameters,
  prompt,
  sourceImages = [],
}: {
  explanation?: string;
  filePath: string;
  parameters?: Record<string, boolean | number | string>;
  prompt: string;
  sourceImages?: string[];
}): ToolCall {
  return call({
    input: { explanation, filePath, parameters, prompt, sourceImages },
    output: {
      appliedParameters: parameters,
      images: [
        {
          filePath: RelativePathSchema.parse(`${filePath}.png`),
          height: 1024,
          modifiedAt: MODIFIED_AT,
          sizeBytes: 245_760,
          width: 1024,
        },
      ],
      modelId: OUR_MODELS.image.id,
      provider: OUR_PROVIDER,
      renamedToAvoidOverwrite: false,
      sourceImages: sourceImages.map((path) => ({
        filePath: RelativePathSchema.parse(path),
        modifiedAt: MODIFIED_AT,
      })),
      state: "success",
      usage: NO_USAGE,
    },
    type: "tool-generate_image",
  });
}

/**
 * A call that reached the tool and got a refusal from it, rather than throwing.
 *
 * The row this draws says the agent tried and could not, which is a different
 * thing from the tool breaking: nothing is configured to do the work at all.
 */
export function imageUnavailable({
  explanation,
  filePath,
  prompt,
}: {
  explanation?: string;
  filePath: string;
  prompt: string;
}): ToolCall {
  return call({
    input: { explanation, filePath, prompt },
    output: {
      errorMessage:
        "No AI provider with image generation capability is available.",
      errorType: "no-image-model",
      state: "failure",
    },
    type: "tool-generate_image",
  });
}

export function loadedSkill({
  explanation,
  name,
  streamedName,
}: {
  explanation?: string;
  name: string;
  /** Half a name, for the row drawn before the skill is known. */
  streamedName?: string;
}): ToolCall {
  return call({
    input: { explanation, name },
    output: {
      alreadyLoaded: false,
      content: `# ${name}\n\nWhat this skill is for and how to use it.`,
      contentTruncated: false,
      directory: `skills/${name}`,
      files: [`skills/${name}/SKILL.md`],
      name,
      origin: "workspace",
      skillName: name,
      state: "success",
      truncated: false,
    },
    streamed: streamedName ? { explanation, name: streamedName } : undefined,
    type: "tool-load_skill",
  });
}

export function ran({
  command,
  explanation,
  output = "",
}: {
  command: string;
  explanation?: string;
  output?: string;
}): ToolCall {
  return call({
    input: { command, explanation },
    output: {
      command,
      commands: [command.split(" ")[0] ?? command],
      durationMs: 120,
      exitCode: 0,
      omittedBytes: 0,
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
  explanation?: string;
  output: string;
}): ToolCall {
  return call({
    input: { command, explanation },
    output: {
      command,
      commands: [command.split(" ")[0] ?? command],
      durationMs: 90,
      exitCode: 1,
      omittedBytes: 0,
      output,
    },
    type: "tool-bash",
  });
}

export function read({
  content = "region,revenue\nnorth,48200\nsouth,51150",
  explanation,
  filePath,
  streamedPath,
}: {
  content?: string;
  explanation?: string;
  filePath: string;
  /** Half a path, for watching the chip a row draws fill itself in. */
  streamedPath?: string;
}): ToolCall {
  return call({
    input: { explanation, filePath },
    output: fileContents(filePath, content),
    streamed: streamedPath
      ? { explanation, filePath: streamedPath }
      : undefined,
    type: "tool-read_file",
  });
}

/** A read of something that is not there, which draws as a failed row. */
export function readMissing({
  explanation,
  filePath,
}: {
  explanation?: string;
  filePath: string;
}): ToolCall {
  return call({
    input: { explanation, filePath },
    output: { filePath, state: "does-not-exist", suggestions: [] },
    type: "tool-read_file",
  });
}

export function searched({
  explanation,
  query,
}: {
  explanation?: string;
  query: string;
}): ToolCall {
  return call({
    input: { explanation, query },
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
          {
            publishedDate: "2026-02-11",
            text: "A stacked bar chart answers a different question from a grouped one, and the two are not interchangeable.",
            title: "Choosing a bar chart",
            url: "https://example.com/bars",
          },
        ],
      },
      state: "success",
    },
    type: "tool-web_search",
  });
}

/** The other search backend: prose written by a search model, not excerpts. */
export function searchedForSummary({
  explanation,
  query,
  text,
}: {
  explanation?: string;
  query: string;
  text: string;
}): ToolCall {
  return call({
    input: { explanation, query },
    output: {
      results: {
        kind: "summary",
        modelId: OUR_MODELS.text.id,
        provider: OUR_PROVIDER,
        sources: [
          { title: "Chart legends", url: "https://example.com/legends" },
        ],
        text,
        usage: { inputTokens: 50, outputTokens: 80, totalTokens: 130 },
      },
      state: "success",
    },
    type: "tool-web_search",
  });
}

/** Nothing is configured to search, which the tool says rather than throws. */
export function searchUnavailable({
  explanation,
  query,
}: {
  explanation?: string;
  query: string;
}): ToolCall {
  return call({
    input: { explanation, query },
    output: {
      errorMessage: "No web search backend is available.",
      errorType: "no-search-backend",
      state: "failure",
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
  explanation?: string;
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
  streamedPath,
}: {
  content: string;
  explanation?: string;
  filePath: string;
  /** Half a path, for watching the chip a row draws fill itself in. */
  streamedPath?: string;
}): ToolCall {
  return call({
    input: { content, explanation, filePath },
    output: { content, filePath, isNewFile: true, modifiedAt: MODIFIED_AT },
    streamed: streamedPath
      ? { content: "", explanation, filePath: streamedPath }
      : undefined,
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
