import { z } from "zod";

import { type SessionMessagePart } from "../../schemas/session/message-part";
import { TOOL_NAMES } from "../../tools/name";
import { clipLine, partCreatedAt, partEndedAt } from "../chat/call-label";

/**
 * How one call reads inside a `CHAT.md` work fold, and what the fold's
 * summary line says it did.
 *
 * A call is its own label, then at most a few lines of what it touched: the
 * command, the file, the query and the sites it found, the address. That is
 * what a person searches their files for, and it stays small, so a chat of
 * hundreds of calls is still a file to read: a command's output is kept only
 * when it failed, and then only its last lines.
 */

/** How much of a command, a path or an address the fold keeps. */
const DETAIL_MAX_LENGTH = 200;

/** How much of each side of an edit the fold keeps. */
const EDIT_MAX_LENGTH = 60;

/** How many of a failed command's last lines the fold keeps. */
const FAILED_OUTPUT_LINES = 3;

/** How many sites a search names. */
const SEARCH_SOURCES = 3;

/** How many facts the summary line says before it counts the rest. */
const SUMMARY_FACTS = 3;

const InputSchema = z.object({
  command: z.string().optional(),
  explanation: z.string().optional(),
  filePath: z.string().optional(),
  name: z.string().optional(),
  newString: z.string().optional(),
  oldString: z.string().optional(),
  query: z.string().optional(),
  url: z.string().optional(),
});

const OutputSchema = z.object({
  exitCode: z.number().optional(),
  filePath: z.string().optional(),
  images: z.array(z.object({ filePath: z.string() })).optional(),
  output: z.string().optional(),
  processId: z.string().optional(),
  results: z
    .object({ sources: z.array(z.object({ url: z.string() })) })
    .optional(),
  state: z.string().optional(),
});

const ErrorSchema = z.object({ errorText: z.string() });

/** What the agent calls a call it gave no label of its own. */
const UNLABELED: Record<string, string> = {
  [TOOL_NAMES.bash]: "Ran a command",
  [TOOL_NAMES.editFile]: "Edited a file",
  [TOOL_NAMES.generateImage]: "Made an image",
  [TOOL_NAMES.loadSkill]: "Loaded a skill",
  [TOOL_NAMES.readFile]: "Read a file",
  [TOOL_NAMES.webFetch]: "Opened a page",
  [TOOL_NAMES.webSearch]: "Searched the web",
  [TOOL_NAMES.writeFile]: "Wrote a file",
};

/**
 * One call as the fold's lines: its label with how it ended and how long it
 * took, then what it touched, each indented under it. A file is named from
 * `rootDir`, the workspace, where it is in it.
 */
export function workFoldLines(
  part: SessionMessagePart.ToolPart,
  rootDir: string,
): string[] {
  const tool = toolOf(part);
  const input = parsed(InputSchema, part.input);
  const label =
    input.explanation?.trim() || UNLABELED[tool] || tool.replaceAll("_", " ");
  const head = [clipLine(label, DETAIL_MAX_LENGTH), ...ending(part)].join(
    " · ",
  );
  return [
    head,
    ...touched(part, tool, input, rootDir).map((line) => `  ${line}`),
  ];
}

/**
 * The summary line's facts for a stretch of calls, in the order each kind of
 * work first came up: "read kyoto.md", "ran 6 commands". At most a few, and
 * a count of the calls the rest were.
 */
export function workFoldFacts(
  parts: readonly SessionMessagePart.ToolPart[],
): string[] {
  const kinds = new Map<string, SessionMessagePart.ToolPart[]>();
  for (const part of parts) {
    const kind = kindOf(toolOf(part));
    if (kind !== undefined) {
      kinds.set(kind, [...(kinds.get(kind) ?? []), part]);
    }
  }
  const facts = [...kinds].map(([kind, calls]) => ({
    calls: calls.length,
    text: fact(kind, calls),
  }));
  const said = facts.slice(0, SUMMARY_FACTS).map((each) => each.text);
  const rest = facts
    .slice(SUMMARY_FACTS)
    .reduce((sum, each) => sum + each.calls, 0);
  return rest === 0
    ? said
    : [...said, `and ${rest.toString()} more step${rest === 1 ? "" : "s"}`];
}

/** A length of time as the fold says it: 14s, 3m, 3m 10s, never under 1s. */
export function spokenDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) {
    return `${rest.toString()}s`;
  }
  return rest === 0
    ? `${minutes.toString()}m`
    : `${minutes.toString()}m ${rest.toString()}s`;
}

/** The kind of work a tool's calls count as in the summary, by tool. */
function kindOf(tool: string): string | undefined {
  switch (tool) {
    case TOOL_NAMES.bash:
    case TOOL_NAMES.generateImage:
    case TOOL_NAMES.loadSkill:
    case TOOL_NAMES.readFile:
    case TOOL_NAMES.webFetch:
    case TOOL_NAMES.webSearch: {
      return tool;
    }
    // Writing a file and editing one both change it.
    case TOOL_NAMES.editFile:
    case TOOL_NAMES.writeFile: {
      return TOOL_NAMES.editFile;
    }
    default: {
      return undefined;
    }
  }
}

function fact(
  kind: string,
  calls: readonly SessionMessagePart.ToolPart[],
): string {
  const count = calls.length;
  switch (kind) {
    case TOOL_NAMES.bash: {
      return count === 1 ? "ran a command" : `ran ${count.toString()} commands`;
    }
    case TOOL_NAMES.generateImage: {
      return count === 1 ? "made an image" : `made ${count.toString()} images`;
    }
    case TOOL_NAMES.loadSkill: {
      return count === 1
        ? "loaded a skill"
        : `loaded ${count.toString()} skills`;
    }
    case TOOL_NAMES.readFile: {
      return `read ${files(calls)}`;
    }
    case TOOL_NAMES.webFetch: {
      return count === 1 ? "opened a page" : `opened ${count.toString()} pages`;
    }
    case TOOL_NAMES.webSearch: {
      return `searched the web${times(count)}`;
    }
    default: {
      const verb = calls.every((part) => toolOf(part) === TOOL_NAMES.writeFile)
        ? "wrote"
        : "edited";
      const named = oneFile(calls);
      // One file changed again and again says how often; several say how many.
      return named === undefined
        ? `${verb} ${count.toString()} files`
        : `${verb} ${named}${times(count)}`;
    }
  }
}

/** The files a set of calls touched: the one by its name, more by a count. */
function files(calls: readonly SessionMessagePart.ToolPart[]): string {
  const named = oneFile(calls);
  if (named !== undefined) {
    return named;
  }
  const count = new Set(calls.map((each) => pathOf(each, ""))).size;
  return `${count.toString()} file${count === 1 ? "" : "s"}`;
}

/** The name of the one file every call touched, if there is just one. */
function oneFile(
  calls: readonly SessionMessagePart.ToolPart[],
): string | undefined {
  const paths = new Set(calls.map((each) => pathOf(each, "")));
  const [only] = paths;
  return paths.size === 1 && only ? only.split(/[/\\]/u).at(-1) : undefined;
}

function times(count: number): string {
  if (count === 1) {
    return "";
  }
  return count === 2 ? " twice" : ` ${count.toString()} times`;
}

/** How the call ended and how long it ran, where either is worth saying. */
function ending(part: SessionMessagePart.ToolPart): string[] {
  const output = parsed(OutputSchema, part.output);
  const said: string[] = [];
  switch (part.state) {
    case "input-available":
    case "input-streaming": {
      said.push(part.metadata.startedAt === undefined ? "queued" : "running");
      break;
    }
    case "output-available": {
      if (output.processId !== undefined) {
        said.push(`still running as ${output.processId}`);
      } else if (output.exitCode !== undefined && output.exitCode !== 0) {
        said.push(`exit ${output.exitCode.toString()}`);
      } else if (output.state === "failure") {
        said.push("failed");
      }
      break;
    }
    case "output-error": {
      said.push("failed");
      break;
    }
    default: {
      break;
    }
  }
  const started = partCreatedAt(part);
  const ended = partEndedAt(part);
  if (started && ended && ended.getTime() - started.getTime() >= 1000) {
    said.push(spokenDuration(ended.getTime() - started.getTime()));
  }
  return said;
}

/** What the call touched, a line each. */
function touched(
  part: SessionMessagePart.ToolPart,
  tool: string,
  input: z.output<typeof InputSchema>,
  rootDir: string,
): string[] {
  const output = parsed(OutputSchema, part.output);
  const lines: string[] = [];
  switch (tool) {
    case TOOL_NAMES.bash: {
      if (input.command !== undefined) {
        lines.push(`$ ${clipLine(homeless(input.command), DETAIL_MAX_LENGTH)}`);
      }
      const failed = output.exitCode !== undefined && output.exitCode !== 0;
      if (failed && output.output !== undefined) {
        lines.push(
          ...output.output
            .split("\n")
            .filter((line) => line.trim() !== "")
            .slice(-FAILED_OUTPUT_LINES)
            .map((line) => clipLine(homeless(line), DETAIL_MAX_LENGTH)),
        );
      }
      break;
    }
    case TOOL_NAMES.editFile: {
      lines.push(clipLine(pathOf(part, rootDir), DETAIL_MAX_LENGTH));
      if (input.oldString !== undefined && input.newString !== undefined) {
        lines.push(
          `“${clipLine(input.oldString.trim(), EDIT_MAX_LENGTH)}” → “${clipLine(input.newString.trim(), EDIT_MAX_LENGTH)}”`,
        );
      }
      break;
    }
    case TOOL_NAMES.generateImage: {
      const made = (output.images ?? []).map((image) => image.filePath);
      lines.push(
        ...(made.length > 0 ? made : [pathOf(part, rootDir)]).map((each) =>
          clipLine(fromRoot(each, rootDir), DETAIL_MAX_LENGTH),
        ),
      );
      break;
    }
    case TOOL_NAMES.loadSkill: {
      if (input.name !== undefined) {
        lines.push(input.name);
      }
      break;
    }
    case TOOL_NAMES.readFile:
    case TOOL_NAMES.writeFile: {
      lines.push(clipLine(pathOf(part, rootDir), DETAIL_MAX_LENGTH));
      break;
    }
    case TOOL_NAMES.webFetch: {
      if (input.url !== undefined) {
        lines.push(clipLine(input.url, DETAIL_MAX_LENGTH));
      }
      break;
    }
    case TOOL_NAMES.webSearch: {
      if (input.query !== undefined) {
        lines.push(clipLine(input.query, DETAIL_MAX_LENGTH));
      }
      const hosts = [
        ...new Set(
          (output.results?.sources ?? []).map((source) => hostOf(source.url)),
        ),
      ]
        .filter((host) => host !== "")
        .slice(0, SEARCH_SOURCES);
      if (hosts.length > 0) {
        lines.push(hosts.join(", "));
      }
      break;
    }
    default: {
      break;
    }
  }
  const error = ErrorSchema.safeParse(part);
  if (part.state === "output-error" && error.success) {
    lines.push(clipLine(error.data.errorText, DETAIL_MAX_LENGTH));
  }
  return lines.filter((line) => line !== "");
}

/**
 * The file a file tool's call names: where it landed, else what it asked for,
 * from the workspace where it is in it.
 */
function pathOf(part: SessionMessagePart.ToolPart, rootDir: string): string {
  const output = parsed(OutputSchema, part.output);
  const input = parsed(InputSchema, part.input);
  return fromRoot(output.filePath ?? input.filePath ?? "", rootDir);
}

/**
 * A path from the workspace where it is in it, and otherwise from the home
 * folder. Both are compared with their home folders written as `~`, so a
 * workspace a sync engine keeps at one place under every account names its
 * files the same on each computer, and so the same records render the same
 * bytes there.
 */
function fromRoot(filePath: string, rootDir: string): string {
  const file = homeless(filePath);
  const root = homeless(rootDir).replace(/[/\\]+$/u, "");
  if (root === "") {
    return file;
  }
  const inside = file.slice(root.length);
  return file.startsWith(root) && /^[/\\]/u.test(inside)
    ? inside.slice(1)
    : file;
}

/**
 * Text with every home folder in it written as `~`, so the fold names a file
 * the way a person reads it rather than by the account it is under, and the
 * same on every computer.
 */
function homeless(text: string): string {
  return text.replaceAll(
    /(?:\/Users\/[^/\s"']+|\/home\/[^/\s"']+|[A-Za-z]:\\Users\\[^\\\s"']+)(?=[/\\\s"']|$)/gu,
    "~",
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, "");
  } catch {
    return "";
  }
}

function toolOf(part: SessionMessagePart.ToolPart): string {
  return part.type.slice("tool-".length);
}

/** The fields of an input or an output the fold reads, or none of them. */
function parsed<T extends z.ZodType>(
  schema: T,
  value: unknown,
): Partial<z.output<T>> {
  const result = schema.safeParse(value);
  return result.success ? result.data : {};
}
