/**
 * Lists the text a person reads in Studio, a line per string, so copy can be
 * reviewed as copy rather than found by reading components.
 *
 *   node scripts/ui-copy.ts                    every string in apps/studio/src
 *   node scripts/ui-copy.ts <file>...          the strings in those files
 *   node scripts/ui-copy.ts --new [<file>...]  only strings the base commit
 *                                              doesn't have, in changed files
 *   node scripts/ui-copy.ts --stop-hook        the Claude Code Stop hook: asks
 *                                              for a copy review once a
 *                                              session adds strings
 *
 * The base for `--new` is where the branch left origin/main. A string counts
 * as text a person reads when it is JSX text, the value of a prop that names
 * copy (title, description, label…), a property with such a name, or an
 * argument to a toast. Strings with no space in them are skipped as keys.
 * `…` stands for an interpolated value.
 *
 * The rubric the strings are checked against is the copy-review skill
 * (.agents/skills/copy-review/SKILL.md); the phrases a pattern can catch are
 * also the `studio/plain-copy` lint rule's.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseSync } from "oxc-parser";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const studioSource = "apps/studio/src";

type Found = { file: string; line: number; text: string; where: string };

const COPY_NAME =
  /^(?:title|subtitle|description|detail|label|aria-label|placeholder|tooltip|hint|message|heading|body|caption|empty|emptyText|confirmLabel|note|summary|cta)$/i;

/** Files under the source folder that hold copy rather than tests or debug pages. */
function isCopyFile(file: string): boolean {
  return (
    file.startsWith(`${studioSource}/`) &&
    /\.(?:ts|tsx)$/.test(file) &&
    !/\.(?:test|spec|stories)\.|\.d\.ts$/.test(file) &&
    !/\/(?:tests|debug|__tests__)\//.test(file)
  );
}

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(
    (entry) => {
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        return sourceFiles(file);
      }
      return isCopyFile(file) ? [file] : [];
    },
  );
}

type Node = { [key: string]: unknown; start: number; type: string };

const isNode = (value: unknown): value is Node =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { type?: unknown }).type === "string";

/** The words a string or template says, with `…` for each value put in. */
function spoken(node: unknown): string | undefined {
  if (!isNode(node)) {
    return undefined;
  }
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node.type === "TemplateLiteral" && Array.isArray(node.quasis)) {
    return node.quasis
      .map((quasi: { value: { cooked?: string; raw: string } }) => {
        return quasi.value.cooked ?? quasi.value.raw;
      })
      .join("…");
  }
  if (node.type === "ConditionalExpression") {
    return [spoken(node.consequent), spoken(node.alternate)]
      .filter(Boolean)
      .join(" / ");
  }
  return undefined;
}

const nameOf = (node: unknown): string | undefined => {
  if (!isNode(node)) {
    return undefined;
  }
  if (typeof node.name === "string") {
    return node.name;
  }
  return typeof node.value === "string" ? node.value : undefined;
};

/** Every string a person reads in `source`, a file's text. */
export function copyIn(file: string, source: string): Found[] {
  const found: Found[] = [];
  const lineStarts = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\n") {
      lineStarts.push(index + 1);
    }
  }
  const lineOf = (offset: number) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if ((lineStarts[mid] ?? 0) <= offset) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    return low + 1;
  };
  const add = (node: Node, text: string | undefined, where: string) => {
    const said = text?.replaceAll(/\s+/g, " ").trim();
    if (said && /\s/.test(said) && /[a-z]/i.test(said)) {
      found.push({ file, line: lineOf(node.start), text: said, where });
    }
  };
  const visit = (node: Node, parent?: Node) => {
    switch (node.type) {
      case "CallExpression": {
        const callee = node.callee;
        const name = isNode(callee)
          ? callee.type === "MemberExpression"
            ? [nameOf(callee.object), nameOf(callee.property)].join(".")
            : nameOf(callee)
          : undefined;
        if (name && /^toast(?:\.\w+)?$/.test(name)) {
          for (const argument of node.arguments as unknown[]) {
            if (isNode(argument)) {
              add(argument, spoken(argument), name);
            }
          }
        }
        break;
      }
      case "JSXAttribute": {
        const name = nameOf(node.name);
        const value = isNode(node.value)
          ? node.value.type === "JSXExpressionContainer"
            ? node.value.expression
            : node.value
          : undefined;
        if (name && COPY_NAME.test(name) && isNode(value)) {
          add(value, spoken(value), name);
        }
        break;
      }
      case "JSXExpressionContainer": {
        if (parent?.type === "JSXElement" || parent?.type === "JSXFragment") {
          add(node, spoken(node.expression), "text");
        }
        break;
      }
      case "JSXText": {
        add(node, typeof node.value === "string" ? node.value : "", "text");
        break;
      }
      case "Property": {
        const name = nameOf(node.key);
        if (name && COPY_NAME.test(name)) {
          add(node, spoken(node.value), name);
        }
        break;
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "parent") {
        continue;
      }
      for (const child of Array.isArray(value) ? value : [value]) {
        if (isNode(child)) {
          visit(child, node);
        }
      }
    }
  };
  visit(parseSync(file, source).program as unknown as Node);
  return found;
}

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

/** Where this branch left main, from origin's main or else the local one. */
function base(): string {
  for (const main of ["origin/main", "main"]) {
    try {
      return git("merge-base", "HEAD", main);
    } catch {
      // Try the next name for main.
    }
  }
  throw new Error(
    "Can't tell what this branch added: no origin/main or main to compare with.",
  );
}

/** The strings in `files` that the same file at `from` doesn't say. */
function newCopy(files: string[], from: string): Found[] {
  return files.flatMap((file) => {
    if (!existsSync(path.join(root, file))) {
      return [];
    }
    const now = copyIn(file, readFileSync(path.join(root, file), "utf8"));
    let before: string;
    try {
      before = git("show", `${from}:${file}`);
    } catch {
      return now;
    }
    const said = new Set(copyIn(file, before).map((entry) => entry.text));
    return now.filter((entry) => !said.has(entry.text));
  });
}

function changedFiles(from: string): string[] {
  const listed = [
    git("diff", "--name-only", from),
    git("ls-files", "--others", "--exclude-standard", studioSource),
  ].join("\n");
  return listed.split("\n").filter(isCopyFile);
}

const show = (entries: Found[]) =>
  entries
    .map(
      (entry) => `${entry.file}:${entry.line} [${entry.where}] ${entry.text}`,
    )
    .join("\n");

/**
 * The Stop hook: when the files this session edited say something new, the
 * turn goes on once with the copy-review skill asked for. A session that has
 * loaded the skill is not asked again, and nothing unexpected blocks a stop.
 */
function stopHook() {
  const input = JSON.parse(readFileSync(0, "utf8")) as {
    stop_hook_active?: boolean;
    transcript_path?: string;
  };
  const transcript = input.transcript_path;
  if (input.stop_hook_active || !transcript || !existsSync(transcript)) {
    return;
  }
  const log = readFileSync(transcript, "utf8");
  if (
    /"skill":"(?:[^"]*:)?copy-review"|"file_path":"[^"]*copy-review\/SKILL\.md"/.test(
      log,
    )
  ) {
    return;
  }
  const edited = new Set<string>();
  for (const match of log.matchAll(/"file_path":"((?:\\.|[^"\\])+)"/g)) {
    let written: unknown;
    try {
      written = JSON.parse(`"${match[1] ?? ""}"`);
    } catch {
      continue;
    }
    if (typeof written !== "string") {
      continue;
    }
    const file = path.relative(root, written).split(path.sep).join("/");
    if (isCopyFile(file)) {
      edited.add(file);
    }
  }
  if (edited.size === 0) {
    return;
  }
  const added = newCopy([...edited], base());
  if (added.length === 0) {
    return;
  }
  const listed = show(added.slice(0, 20));
  const more = added.length > 20 ? `\n…and ${added.length - 20} more` : "";
  process.stdout.write(
    JSON.stringify({
      decision: "block",
      reason: `This session added text a person reads:\n${listed}${more}\n\nLoad the copy-review skill and check these against it before finishing. Asked once per session.`,
    }),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === "--stop-hook") {
    try {
      stopHook();
    } catch (error) {
      // A reminder, never a reason to keep a turn from ending: say why it
      // was skipped and let the turn end.
      process.stderr.write(
        `ui-copy: skipped the copy reminder: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  } else if (args[0] === "--new") {
    const from = base();
    const files = args.length > 1 ? args.slice(1) : changedFiles(from);
    console.log(show(newCopy(files, from)));
  } else {
    const files = args.length > 0 ? args : sourceFiles(studioSource);
    console.log(
      show(
        files.flatMap((file) =>
          copyIn(file, readFileSync(path.join(root, file), "utf8")),
        ),
      ),
    );
  }
}
