import { parse, type ScriptNode, type StatementNode } from "just-bash";

/**
 * How a command uses `&`. The shell runs every statement in the foreground,
 * so `&` cannot mean what it says inside a call: a trailing one is how the
 * agent asks for a background process, and any other is refused rather than
 * run in the foreground with nothing said.
 *
 * - `none`: no `&`, or a command that does not parse, whose error the shell
 *   reports when it runs.
 * - `trailing`: the last statement of the call, and only that one.
 * - `refused`: anywhere else.
 */
export type AmpersandUse = "none" | "refused" | "trailing";

export function ampersandUse(command: string): AmpersandUse {
  let script: ScriptNode;
  try {
    script = parse(command);
  } catch {
    return "none";
  }
  const backgrounded: StatementNode[] = [];
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
 * loop, a function, a command substitution.
 */
function collect(node: unknown, into: StatementNode[]): void {
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
  for (const value of Object.values(node)) {
    collect(value, into);
  }
}

function isBackgroundedStatement(node: object): node is StatementNode {
  return (
    "type" in node &&
    node.type === "Statement" &&
    "background" in node &&
    node.background === true
  );
}
