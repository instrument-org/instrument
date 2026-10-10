import { parse, type SimpleCommandNode } from "just-bash";

/** What the chat's shell runs: the two commands that are its job, and filters to read their output with. */
// Its commands, and the file commands for putting a finished file where it
// belongs and looking at one: a task's folder is mounted read-only under the
// chat's view and the user's folders read and write, so a copy out of
// one into the other is the whole of what these can do to a file.
const CHAT_COMMANDS = new Set([
  "app",
  "cat",
  // Moving around reads nothing on its own, and `cd <folder>; ls` is how a
  // model looks into a folder before it thinks of a path argument.
  "cd",
  "chat",
  "cp",
  "du",
  "fg",
  "file",
  "find",
  "head",
  "jobs",
  "kill",
  "ls",
  "memory",
  "mkdir",
  "mv",
  "pwd",
  "stat",
  "tab",
  "tail",
  "task",
  "wc",
]);
const CHAT_FILTERS = new Set([
  "awk",
  "cut",
  "echo",
  "grep",
  "head",
  "jq",
  "rg",
  "sed",
  "sort",
  "tail",
  "true",
  "uniq",
  "wc",
]);
// The two filters that only ever read, so a path of their own is the same read
// `cat` already allows. Refusing `grep <pattern> <file>` while allowing
// `cat <file> | grep <pattern>` buys no containment and costs a turn every
// time: measured, the conversation's agent reaches for the first form, loses
// the read, and answers from a task's one-line summary instead of the file.
// The rest stay downstream of a pipe because they can write from inside their
// own arguments, which `filterWrites` refuses wherever they run.
const CHAT_SEARCH = new Set(["grep", "rg"]);

/** Redirections that open a file for writing. `>&` is checked on its own, since it also duplicates a stream. */
const WRITING_REDIRECTIONS = new Set([">", ">>", ">|", "&>", "&>>", "<>"]);

const REDIRECT_REFUSAL = `Redirecting output to a file is not yours to do: this shell reads files and never writes one. Work that writes a file's contents is a task's: start one with \`task new\`.`;

/**
 * The conversation's agent does no work of its own: every command it runs
 * is `task` or `app`, and a filter is allowed only downstream of one, on
 * their output. Anything else is refused with the way to do it instead, so
 * the agent never becomes busy doing what a task exists for.
 *
 * Read from just-bash's own parse of the script, so every command the shell
 * would run is checked: inside `$(...)` and `<(...)`, in a loop or a group,
 * after `;`, `&&` or `||`. A script that does not parse is let through,
 * because the shell refuses it with the syntax error itself.
 */
export function chatRefusal(script: string): string | undefined {
  let ast: unknown;
  try {
    ast = parse(script);
  } catch {
    return undefined;
  }
  // Checked before the command names, because this is the hole they leave: the
  // list is a list of things safe to *read* with, and every one of them writes
  // a file the moment its output is redirected. Measured, a model finds it on
  // its own -- gpt-oss-120b answered a "put a summary in my folder" ask with
  // `cat > /mnt/Instrument/summary.md <<'EOF'` and wrote the deliverable from
  // the conversation, which is the one thing this shell exists to prevent.
  if (someNode(ast, writesThroughRedirection)) {
    return REDIRECT_REFUSAL;
  }
  const commands: { command: SimpleCommandNode; piped: boolean }[] = [];
  collectCommands(ast, false, commands);
  for (const { command, piped } of commands) {
    const refusal = commandRefusal(command, piped);
    if (refusal !== undefined) {
      return refusal;
    }
  }
  return undefined;
}

function commandRefusal(
  command: SimpleCommandNode,
  piped: boolean,
): string | undefined {
  if (command.name === null) {
    return undefined;
  }
  const word = literalText(command.name.parts) ?? wordText(command.name.parts);
  if (literalText(command.name.parts) !== undefined) {
    if (
      CHAT_COMMANDS.has(word) ||
      CHAT_SEARCH.has(word) ||
      (piped && CHAT_FILTERS.has(word))
    ) {
      return filterWrites(word, command) ? REDIRECT_REFUSAL : undefined;
    }
    // A filter run without one is a rewrite away from working, so say the
    // rewrite: a refusal that only names the rule leaves the agent to guess at
    // the form, and the guess is usually another refusal.
    if (CHAT_FILTERS.has(word)) {
      return `\`${word}\` reads what a command before it printed, so give it one: \`cat <file> | ${word} ...\`. Searching a file by its path is \`grep\` or \`rg\`, which take one.`;
    }
  }
  return `\`${word}\` is not yours to run: this shell runs \`task\`, \`app\`, \`chat\`, \`memory\`, \`open\`, the file commands (cd, pwd, ls, cat, head, tail, wc, stat, file, find, du, cp, mv, mkdir), \`jobs\`/\`fg\`/\`kill\` on what it sent to the background, and \`grep\`/\`rg\` on a path, with the other filters (${[...CHAT_FILTERS].join(", ")}) after a pipe from one of them. Work that needs a shell, a page, or the web, or that writes a file's contents, is a task's: start one with \`task new\`.`;
}

/**
 * Whether a filter writes a file from inside its own arguments, which no
 * redirection shows: `sed -i` and sed's `w` command, and awk's `print >`,
 * `print |` and `system()`. Matched on the arguments' text, so it errs toward
 * refusing an awk or sed program that merely spells one of these.
 */
function filterWrites(word: string, command: SimpleCommandNode): boolean {
  const args = command.args.map((arg) => wordText(arg.parts));
  if (word === "sed") {
    return args.some(
      (arg) =>
        /^-[a-zA-Z]*i/.test(arg) ||
        arg.startsWith("--in-place") ||
        // `w file` as a command, or as the flag closing `s///`.
        /(?:^|[;{}\n]|\d|\$|\/)\s*[wW]\s+\S/.test(arg),
    );
  }
  if (word === "awk") {
    return args.some(
      (arg) =>
        /\bprintf?\b[^;}]*[>|]/.test(arg) ||
        /\bsystem\s*\(/.test(arg) ||
        /\|\s*getline\b/.test(arg),
    );
  }
  return false;
}

/** Every simple command, and whether a pipe feeds it. */
function collectCommands(
  node: unknown,
  piped: boolean,
  into: { command: SimpleCommandNode; piped: boolean }[],
): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectCommands(item, piped, into);
    }
    return;
  }
  if (!isRecord(node)) {
    return;
  }
  if (node.type === "Pipeline" && Array.isArray(node.commands)) {
    node.commands.forEach((stage: unknown, index) => {
      collectCommands(stage, index > 0, into);
    });
    return;
  }
  if (isSimpleCommand(node)) {
    into.push({ command: node, piped });
  }
  // What sits inside a command (a substitution in an argument, a loop's body)
  // is a script of its own, whose pipelines say again what is piped.
  for (const [key, value] of Object.entries(node)) {
    if (key !== "type") {
      collectCommands(value, false, into);
    }
  }
}

/** Whether anything in the tree answers `test`. */
function someNode(
  node: unknown,
  test: (node: Record<string, unknown>) => boolean,
): boolean {
  if (Array.isArray(node)) {
    return node.some((item) => someNode(item, test));
  }
  if (!isRecord(node)) {
    return false;
  }
  return (
    test(node) || Object.values(node).some((value) => someNode(value, test))
  );
}

/**
 * A redirection into a file. Throwing a stream away is not writing one:
 * `2>/dev/null` is how a command's noise is dropped, and refusing it costs
 * a turn. Nor is duplicating one stream onto another (`2>&1`, `>&2`).
 */
function writesThroughRedirection(node: Record<string, unknown>): boolean {
  if (node.type !== "Redirection" || typeof node.operator !== "string") {
    return false;
  }
  const target =
    isRecord(node.target) && Array.isArray(node.target.parts)
      ? literalText(node.target.parts)
      : undefined;
  if (node.operator === ">&") {
    return target === undefined || !/^(?:\d+|-)$/.test(target);
  }
  return WRITING_REDIRECTIONS.has(node.operator) && target !== "/dev/null";
}

/** The word's text when nothing in it expands, as the shell would pass it. */
function literalText(parts: unknown[]): string | undefined {
  let text = "";
  for (const part of parts) {
    if (!isRecord(part)) {
      return undefined;
    }
    if (
      (part.type === "Literal" ||
        part.type === "SingleQuoted" ||
        part.type === "Escaped") &&
      typeof part.value === "string"
    ) {
      text += part.value;
    } else if (part.type === "DoubleQuoted" && Array.isArray(part.parts)) {
      const inner = literalText(part.parts);
      if (inner === undefined) {
        return undefined;
      }
      text += inner;
    } else {
      return undefined;
    }
  }
  return text;
}

/** The word's text for matching and messages, an expansion standing as `$…`. */
function wordText(parts: unknown[]): string {
  return parts
    .map((part) => {
      if (!isRecord(part)) {
        return "";
      }
      if (typeof part.value === "string") {
        return part.value;
      }
      if (part.type === "DoubleQuoted" && Array.isArray(part.parts)) {
        return wordText(part.parts);
      }
      return "$…";
    })
    .join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The parse's own node type, read back off the object the parser built.
function isSimpleCommand(value: unknown): value is SimpleCommandNode {
  return isRecord(value) && value.type === "SimpleCommand";
}
