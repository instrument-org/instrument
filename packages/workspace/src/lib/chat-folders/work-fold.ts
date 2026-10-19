import { z } from "zod";

import { type SessionMessagePart } from "../../schemas/session/message-part";
import { TOOL_NAMES } from "../../tools/name";
import { clipLine, partCreatedAt, partEndedAt } from "../chat/call-label";

/**
 * How one call reads inside a `CHAT.md` work fold, as Markdown, and what the
 * fold's summary line says it did.
 *
 * A call is its own label in bold, then at most a few blocks of what it
 * touched: the command in a shell block, the file as a link a reader can
 * follow, an edit as a diff, a picture shown, the query and the pages it
 * found, the address. That is what a person searches their files for, and it
 * stays small, so a chat of hundreds of calls is still a file to read: a
 * command's output is kept only when it failed, and then only its last lines.
 *
 * `CHAT.md` is always `Chats/<title>/CHAT.md`, so a file in the workspace is
 * linked as `../../<path>`. One outside it is named but not linked: its path
 * is written from `~`, the same on every computer, which no reader resolves.
 */

/** How much of a command, a path or an address the fold keeps. */
const DETAIL_MAX_LENGTH = 200;

/** How many lines of each side of an edit the fold keeps, and how much of each. */
const EDIT_MAX_LINES = 6;
const EDIT_MAX_LENGTH = 120;

/** Where `CHAT.md` is from the workspace's top level: `Chats/<title>/`. */
const TO_ROOT = "../../";

/** A file a reader draws as a picture, by its extension. */
const IMAGE = /\.(?:avif|gif|jpe?g|png|svg|webp)$/iu;

/** How many of a failed command's last lines the fold keeps. */
const FAILED_OUTPUT_LINES = 3;

/** How many of the pages a search found it names. */
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
  reason: z.string().optional(),
  target: z.string().optional(),
  url: z.string().optional(),
});

const OutputSchema = z.object({
  exitCode: z.number().optional(),
  filePath: z.string().optional(),
  images: z.array(z.object({ filePath: z.string() })).optional(),
  output: z.string().optional(),
  processId: z.string().optional(),
  results: z
    .object({
      sources: z.array(
        z.object({ title: z.string().optional(), url: z.string() }),
      ),
    })
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
 * One call as the fold shows it: its label in bold with how it ended and how
 * long it took, a task's handle in front, then a block for each thing it
 * touched. A file is named from `rootDir`, the workspace, where it is in it.
 */
export function workFoldStep(
  part: SessionMessagePart.ToolPart,
  rootDir: string,
  handle = "",
): string {
  const tool = toolOf(part);
  const input = parsed(InputSchema, part.input);
  const label = clipLine(
    input.explanation?.trim() || UNLABELED[tool] || tool.replaceAll("_", " "),
    DETAIL_MAX_LENGTH,
  );
  const who = handle === "" ? "" : `${inlineMarkdown(handle)} `;
  const head = [`**${who}${inlineMarkdown(label)}**`, ...ending(part)].join(
    " · ",
  );
  return [head, ...touched(part, tool, input, label, rootDir)].join("\n\n");
}

/**
 * Text the agent wrote, as Markdown that draws its code spans and emphasis
 * but never markup: an angle bracket outside a code span is escaped, so a
 * `</details>` in a thought cannot close the fold, and a code span is left
 * as written, since Markdown shows what is in one literally.
 */
export function inlineMarkdown(text: string): string {
  return text
    .split(/(`+[^`]*?`+)/u)
    .map((piece, i) =>
      i % 2 === 1 ? piece : piece.replaceAll("<", "\\<").replaceAll(">", "\\>"),
    )
    .join("");
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

/** What the call touched, a Markdown block each. */
function touched(
  part: SessionMessagePart.ToolPart,
  tool: string,
  input: z.output<typeof InputSchema>,
  label: string,
  rootDir: string,
): string[] {
  const output = parsed(OutputSchema, part.output);
  const blocks: string[] = [];
  switch (tool) {
    case TOOL_NAMES.bash: {
      if (input.command !== undefined) {
        blocks.push(
          fenced("sh", clipLine(homeless(input.command), DETAIL_MAX_LENGTH)),
        );
      }
      const failed = output.exitCode !== undefined && output.exitCode !== 0;
      if (failed && output.output !== undefined) {
        const last = output.output
          .split("\n")
          .filter((line) => line.trim() !== "")
          .slice(-FAILED_OUTPUT_LINES)
          .map((line) => clipLine(homeless(line), DETAIL_MAX_LENGTH));
        if (last.length > 0) {
          blocks.push(fenced("text", last.join("\n")));
        }
      }
      break;
    }
    case TOOL_NAMES.editFile: {
      blocks.push(fileLink(filePathOf(part), rootDir));
      if (input.oldString !== undefined && input.newString !== undefined) {
        blocks.push(fenced("diff", diff(input.oldString, input.newString)));
      }
      break;
    }
    case TOOL_NAMES.generateImage: {
      const made = (output.images ?? []).map((image) => image.filePath);
      blocks.push(
        ...(made.length > 0 ? made : [filePathOf(part)]).map((each) =>
          picture(each, rootDir),
        ),
      );
      break;
    }
    case TOOL_NAMES.loadSkill: {
      // A label that already names the skill says it once.
      if (input.name !== undefined && !label.includes(input.name)) {
        blocks.push(`\`${input.name}\``);
      }
      break;
    }
    case TOOL_NAMES.readFile: {
      blocks.push(picture(filePathOf(part), rootDir));
      break;
    }
    case TOOL_NAMES.writeFile: {
      blocks.push(fileLink(filePathOf(part), rootDir));
      break;
    }
    case TOOL_NAMES.webFetch: {
      if (input.url !== undefined) {
        blocks.push(pageLink(input.url));
      }
      break;
    }
    case TOOL_NAMES.webSearch: {
      if (input.query !== undefined) {
        blocks.push(
          `“${inlineMarkdown(clipLine(input.query, DETAIL_MAX_LENGTH))}”`,
        );
      }
      const pages = (output.results?.sources ?? [])
        .filter((source) => hostOf(source.url) !== "")
        .slice(0, SEARCH_SOURCES);
      if (pages.length > 0) {
        blocks.push(
          pages
            .map((source) => `- ${pageLink(source.url, source.title)}`)
            .join("\n"),
        );
      }
      break;
    }
    case TOOL_NAMES.askPermission: {
      if (input.target !== undefined) {
        blocks.push(
          `\`${clipLine(fromRoot(input.target, rootDir), DETAIL_MAX_LENGTH)}\``,
        );
      }
      if (input.reason !== undefined) {
        blocks.push(inlineMarkdown(clipLine(input.reason, DETAIL_MAX_LENGTH)));
      }
      break;
    }
    default: {
      break;
    }
  }
  const error = ErrorSchema.safeParse(part);
  if (part.state === "output-error" && error.success) {
    blocks.push(
      inlineMarkdown(
        clipLine(homeless(error.data.errorText), DETAIL_MAX_LENGTH),
      ),
    );
  }
  return blocks.filter((block) => block !== "");
}

/**
 * An edit as diff lines: the lines both sides share at the start and the end
 * as context, and between them what went and what came, a few of each.
 */
function diff(before: string, after: string): string {
  const old = before.trim().split("\n");
  const now = after.trim().split("\n");
  let start = 0;
  while (
    start < old.length &&
    start < now.length &&
    old[start] === now[start]
  ) {
    start += 1;
  }
  let end = 0;
  while (
    end < old.length - start &&
    end < now.length - start &&
    old.at(-1 - end) === now.at(-1 - end)
  ) {
    end += 1;
  }
  const side = (lines: string[], sign: string) => {
    const kept = lines
      .slice(0, EDIT_MAX_LINES)
      .map((line) => `${sign} ${clipLine(homeless(line), EDIT_MAX_LENGTH)}`);
    return lines.length > EDIT_MAX_LINES ? [...kept, `${sign} …`] : kept;
  };
  return [
    ...side(old.slice(0, start), " "),
    ...side(old.slice(start, old.length - end), "-"),
    ...side(now.slice(start, now.length - end), "+"),
    ...side(old.slice(old.length - end), " "),
  ].join("\n");
}

/** Text in a fenced block, behind a fence longer than any backtick run in it. */
function fenced(language: string, text: string): string {
  const runs = [...text.matchAll(/`+/gu)].map((run) => run[0].length + 1);
  const fence = "`".repeat(Math.max(3, ...runs));
  return [`${fence}${language}`, text, fence].join("\n");
}

/** A file by its path from the workspace, linked when it is in it. */
function fileLink(filePath: string, rootDir: string): string {
  const shown = clipLine(fromRoot(filePath, rootDir), DETAIL_MAX_LENGTH);
  const href = hrefInRoot(filePath, rootDir);
  return href === undefined ? `\`${shown}\`` : `[${linkText(shown)}](${href})`;
}

/** A file shown as the picture it is where a reader can reach it, else linked. */
function picture(filePath: string, rootDir: string): string {
  const href = hrefInRoot(filePath, rootDir);
  if (href === undefined || !IMAGE.test(filePath)) {
    return fileLink(filePath, rootDir);
  }
  const name = filePath.split(/[/\\]/u).at(-1) ?? "";
  return `![${linkText(name)}](${href})`;
}

/** A page by its title, else by its address without the scheme. */
function pageLink(url: string, title?: string): string {
  const shown = title?.trim() || url.replace(/^https?:\/\//u, "");
  return `[${linkText(clipLine(shown, DETAIL_MAX_LENGTH))}](${encodeURI(decodeURISafe(url))})`;
}

/** The link from `CHAT.md` to a file in the workspace, or none for one outside it. */
function hrefInRoot(filePath: string, rootDir: string): string | undefined {
  const shown = fromRoot(filePath, rootDir);
  if (
    shown === "" ||
    shown.startsWith("~") ||
    /^(?:[/\\]|[A-Za-z]:)/u.test(shown)
  ) {
    return undefined;
  }
  return `${TO_ROOT}${shown.split(/[/\\]/u).map(encodeURIComponent).join("/")}`;
}

/** Text for inside a link's brackets. */
function linkText(text: string): string {
  return inlineMarkdown(text).replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function decodeURISafe(url: string): string {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}

/** The file a file tool's call names: where it landed, else what it asked for. */
function filePathOf(part: SessionMessagePart.ToolPart): string {
  const output = parsed(OutputSchema, part.output);
  const input = parsed(InputSchema, part.input);
  return output.filePath ?? input.filePath ?? "";
}

/** That file from the workspace where it is in it. */
function pathOf(part: SessionMessagePart.ToolPart, rootDir: string): string {
  return fromRoot(filePathOf(part), rootDir);
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
