import {
  parse,
  type ScriptNode,
  type SimpleCommandNode,
  type StatementNode,
  type WordNode,
} from "just-bash";

/**
 * How a command uses `&`. The shell runs every statement in the foreground,
 * so `&` cannot mean what it says inside a call: a trailing one is how the
 * agent asks for a background process, and any other is refused rather than
 * run in the foreground with nothing said.
 *
 * - `none`: no `&`, or a command that does not parse, whose error the shell
 *   reports when it runs.
 * - `trailing`: the last statement of the call, and only that one.
 * - `refused`: anywhere else, a script the shell itself runs included
 *   (`bash -c 'a & b'`, `sh -c`, `eval`), where even a trailing `&` holds the
 *   call until the command ends.
 */
export type AmpersandUse = "none" | "refused" | "trailing";

export function ampersandUse(command: string): AmpersandUse {
  let script: ScriptNode;
  try {
    script = parse(command);
  } catch {
    return "none";
  }
  const backgrounded: object[] = [];
  collect(script, backgrounded);
  if (backgrounded.length === 0) {
    return "none";
  }
  return backgrounded.length === 1 &&
    backgrounded[0] === script.statements.at(-1)
    ? "trailing"
    : "refused";
}

/**
 * Every backgrounded statement in the tree, at any depth: in a subshell, a
 * loop, a function, a command substitution, and every command handing the
 * shell a script with a `&` in it.
 */
function collect(node: unknown, into: object[]): void {
  if (Array.isArray(node)) {
    for (const each of node) {
      collect(each, into);
    }
    return;
  }
  if (typeof node !== "object" || node === null) {
    return;
  }
  if (isBackgroundedStatement(node)) {
    into.push(node);
  }
  if (isSimpleCommand(node)) {
    const inner = shellScript(node);
    if (inner !== undefined && ampersandUse(inner) !== "none") {
      into.push(node);
    }
  }
  for (const value of Object.values(node)) {
    collect(value, into);
  }
}

/**
 * The script a command hands the shell's own interpreter: `bash -c` and
 * `sh -c` as just-bash reads them (`-c` first), and `eval`. A part known only
 * when it runs (`$VAR`) reads as a placeholder; the `&` around it is what
 * counts. `/bin/bash` is the computer's own bash, whose `&` works.
 */
function shellScript(node: SimpleCommandNode): string | undefined {
  const name = node.name ? wordText(node.name) : undefined;
  const args = node.args.map(wordText);
  if ((name === "bash" || name === "sh") && args[0] === "-c") {
    return args[1];
  }
  if (name === "eval") {
    return args.join(" ");
  }
  return undefined;
}

function wordText(word: WordNode): string {
  return word.parts.map(partText).join("");
}

function partText(part: WordNode["parts"][number]): string {
  switch (part.type) {
    case "Literal":
    case "SingleQuoted":
    case "Escaped": {
      return part.value;
    }
    case "DoubleQuoted": {
      return part.parts.map(partText).join("");
    }
    default: {
      return "_";
    }
  }
}

function isSimpleCommand(node: object): node is SimpleCommandNode {
  return "type" in node && node.type === "SimpleCommand";
}

function isBackgroundedStatement(node: object): node is StatementNode {
  return (
    "type" in node &&
    node.type === "Statement" &&
    "background" in node &&
    node.background === true
  );
}
