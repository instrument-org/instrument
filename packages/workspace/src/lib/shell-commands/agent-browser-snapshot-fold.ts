/**
 * Shortens the `snapshot -i` tree a follow-up attaches by folding the options
 * of every closed select into one line.
 *
 * It works on the tree read back out of the CLI's text, since the CLI gives
 * the tree no other way: `--json` carries the same text beside a flat map of
 * ref to role and name, with no children and no properties. The text is read
 * whole or not at all, so a line this does not know leaves the snapshot as the
 * CLI printed it.
 */

/** One printed control and the controls printed under it. */
export type SnapshotNode = {
  /** The bracketed properties other than the ref, in the order printed. */
  attrs: string[];
  children: SnapshotNode[];
  depth: number;
  /** The line as printed, or the line the fold wrote in its place. */
  line: string;
  /** The accessible name, quoted as printed. Empty when the line prints none. */
  name: string;
  /** Empty on the line the fold wrote, which names no control. */
  ref: string;
  role: string;
  /** What follows the brackets: a hint, the cursor kind, `: value`. */
  tail: string;
};

/**
 * A line as `render_tree` in the CLI's `snapshot.rs` prints it: two spaces a
 * level, `- role`, the name as a JSON string, the properties in brackets, then
 * the rest.
 */
const LINE =
  /^((?: {2})*)- ([A-Za-z]+)(?: ("(?:[^"\\]|\\.)*"))?(?: \[([^\]]*)\])?(.*)$/;

const REF = /^ref=(e\d+)$/;

/**
 * The tree a full `snapshot -i` printed, or nothing when any line is not a
 * control line with a ref no other line has, or sits more than one level
 * under the line before it. `-i` prints only controls it gave a ref, so the
 * rest of a multi-line field value, a delta and a format this does not know
 * all end up there, and the caller then leaves the text as it is.
 */
export function parseSnapshot(text: string): SnapshotNode[] | undefined {
  const roots: SnapshotNode[] = [];
  const open: SnapshotNode[] = [];
  const refs = new Set<string>();
  for (const line of text.split("\n")) {
    const match = LINE.exec(line);
    if (!match) {
      return undefined;
    }
    const [, indent = "", role = "", name = "", printed = "", tail = ""] =
      match;
    const attrs = printed.split(", ");
    const ref = attrs.map((attr) => REF.exec(attr)?.[1]).find(Boolean);
    const depth = indent.length / 2;
    if (ref === undefined || refs.has(ref) || depth > open.length) {
      return undefined;
    }
    refs.add(ref);
    const node: SnapshotNode = {
      attrs: attrs.filter((attr) => !REF.test(attr)),
      children: [],
      depth,
      line,
      name,
      ref,
      role,
      tail,
    };
    open.length = depth;
    (open.at(-1)?.children ?? roots).push(node);
    open.push(node);
  }
  return roots;
}

/** The tree as text again, a line a node. */
export function renderSnapshot(nodes: readonly SnapshotNode[]): string {
  return nodes.flatMap((node) => linesOf(node)).join("\n");
}

function linesOf(node: SnapshotNode): string[] {
  return [node.line, ...node.children.flatMap((child) => linesOf(child))];
}

/**
 * The options of a closed select as one line of their names, or nothing for
 * a control that is not one.
 *
 * The rule is the tree's own: a `combobox` that the page reports as
 * `expanded=false`, every child of which is an `option` with a name no
 * other option has, nothing under it and nothing after its brackets. That is
 * a native `<select>` and any custom combobox that keeps its options in the
 * tree while shut. A `listbox` is never folded: it has no closed state, so
 * its options are on screen and a ref is how one is clicked. Neither is a
 * combobox that is open, or that says nothing about being expanded, or one
 * with two options of a name, which `select` could not tell apart, or one
 * whose few options take fewer characters as printed than the line would.
 */
function foldedOptions(node: SnapshotNode): SnapshotNode | undefined {
  const options = node.children;
  const closed =
    node.role === "combobox" &&
    node.attrs.includes("expanded=false") &&
    options.length > 0 &&
    options.every(
      (option) =>
        option.role === "option" &&
        option.name !== "" &&
        option.children.length === 0 &&
        option.tail === "",
    ) &&
    new Set(options.map((option) => option.name)).size === options.length;
  if (!closed) {
    return undefined;
  }
  // Each name as printed, with the properties it had other than its ref
  // (`selected`, `disabled`).
  const names = options.map((option) =>
    [option.name, ...option.attrs.map((attr) => `[${attr}]`)].join(" "),
  );
  const text = `${options.length} options, chosen with \`select @${node.ref} <name>\`: ${names.join(", ")}`;
  const folded: SnapshotNode = {
    attrs: [],
    children: [],
    depth: node.depth + 1,
    line: `${"  ".repeat(node.depth + 1)}- ${text}`,
    name: "",
    ref: "",
    role: "",
    tail: text,
  };
  const printed = options.reduce((sum, { line }) => sum + line.length + 1, 0);
  return folded.line.length + 1 < printed ? folded : undefined;
}

/**
 * The tree with the options of every closed select as one line under it.
 * Every name is kept, so `select <ref> <name>` has what it needs; what goes
 * is each option's own line and ref.
 */
export function foldClosedSelects(
  nodes: readonly SnapshotNode[],
): SnapshotNode[] {
  return nodes.map((node) => {
    const folded = foldedOptions(node);
    return {
      ...node,
      children: folded ? [folded] : foldClosedSelects(node.children),
    };
  });
}

/**
 * A full `snapshot -i` with its closed selects folded, or the text as given
 * when it does not read as a tree.
 */
export function foldSnapshotText(text: string): string {
  const tree = parseSnapshot(text);
  return tree === undefined ? text : renderSnapshot(foldClosedSelects(tree));
}
