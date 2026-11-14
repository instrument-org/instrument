import { parseAgentBrowserArgs } from "./agent-browser-args";

/**
 * The agent-browser runs that type text with line breaks in it as one
 * insertion, in order, or undefined when the command runs as written.
 *
 * `type` and `keyboard type` press Enter for every line break in their text,
 * and Enter sends a chat composer's message, submits a form and runs a
 * search, so a three-paragraph message typed into a chat went as three
 * messages. Text inserted in one piece, which is what `keyboard inserttext`
 * and `fill` do, keeps its line breaks as line breaks in a textarea, a
 * contenteditable and ProseMirror alike, and sends nothing. So a line break
 * inside the text goes in with it, and only the ones it ends with stay Enter
 * presses, since `type <field> "query\n"` is how a search is typed and sent.
 *
 * `type` focuses its element and types into it, `--clear` emptying it first,
 * which are `focus` and `fill`'s own steps; `--delay` paces keystrokes, and one
 * insertion has none. Each run keeps the invocation's global flags.
 */
export function typedTextRuns(args: string[]): string[][] | undefined {
  const typed = typedText(args);
  if (typed === undefined) {
    return undefined;
  }
  const trailing = /[\r\n]+$/.exec(typed.text)?.[0] ?? "";
  const body = typed.text.slice(0, typed.text.length - trailing.length);
  if (!/[\r\n]/.test(body)) {
    return undefined;
  }
  const lines = body.replaceAll(/\r\n?/g, "\n");
  const enters = trailing.split(/\r\n|\r|\n/).length - 1;

  const { subArgs } = parseAgentBrowserArgs(args);
  const subIndexes = new Set(subArgs.map(({ index }) => index));
  const globalArgs = args.filter((_, index) => !subIndexes.has(index));
  const run = (...words: string[]) => [...globalArgs, ...words];

  const insert =
    typed.selector === undefined
      ? [run("keyboard", "inserttext", lines)]
      : typed.clear
        ? [run("fill", typed.selector, lines)]
        : [run("focus", typed.selector), run("keyboard", "inserttext", lines)];
  return [
    ...insert,
    ...Array.from({ length: enters }, () => run("press", "Enter")),
  ];
}

/**
 * The text a `type` or `keyboard type` invocation types, read the way the CLI
 * reads it: the words after the selector joined by spaces, `--clear` and
 * `--delay <ms>` taken out, and everything after `--` taken as text.
 */
function typedText(
  args: string[],
): { clear: boolean; selector?: string; text: string } | undefined {
  const { subArgs, subcommand } = parseAgentBrowserArgs(args);
  const words = subArgs.slice(1).map(({ value }) => value);
  if (subcommand === "keyboard") {
    return words[0] === "type"
      ? { clear: false, text: words.slice(1).join(" ") }
      : undefined;
  }
  if (subcommand !== "type") {
    return undefined;
  }
  const [selector, ...rest] = words;
  if (selector === undefined) {
    return undefined;
  }
  let clear = false;
  const parts: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    if (word === "--") {
      parts.push(...rest.slice(i + 1));
      break;
    }
    if (word === "--clear") {
      clear = true;
    } else if (word === "--delay") {
      // A malformed delay is the CLI's to refuse, so it runs as written.
      if (!/^\d+$/.test(rest[i + 1] ?? "")) {
        return undefined;
      }
      i++;
    } else if (word !== undefined) {
      parts.push(word);
    }
  }
  return { clear, selector, text: parts.join(" ") };
}
