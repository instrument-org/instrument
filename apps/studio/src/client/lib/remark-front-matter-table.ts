import { parse } from "yaml";

/**
 * Draws a document's YAML front matter as a two-column table of its keys and
 * values, headed "Properties".
 *
 * Runs after `remark-frontmatter`, which is what keeps the block from being read
 * as markdown at all: without it the closing `---` underlines everything above
 * it into one enormous heading, which is how a transcript's metadata was
 * reaching the screen. Hiding the block would be the other option, and loses
 * the one place a file says what it is -- a note's tags, a transcript's task
 * name and model.
 *
 * A mapping is the only shape that is a table. Anything else that parses (a
 * list, a scalar), and anything that does not, is kept as the YAML it is, in a
 * code block; an empty block is dropped. Nested values print as JSON,
 * one row per top-level key, rather than unfolding into rows of their own.
 */

// `@types/mdast` is not a dependency here, so the nodes are described
// structurally, with only the fields this reads and writes.
interface MdastNode {
  align?: (null | string)[];
  children?: MdastNode[];
  lang?: string;
  type: string;
  value?: string;
}

const text = (value: string): MdastNode => ({ type: "text", value });

const cell = (content: MdastNode): MdastNode => ({
  children: [content],
  type: "tableCell",
});

const row = (cells: MdastNode[]): MdastNode => ({
  children: cells,
  type: "tableRow",
});

const cellFor = (value: unknown): MdastNode => {
  switch (typeof value) {
    case "bigint":
    case "boolean":
    case "number":
    case "string": {
      return text(String(value));
    }
    case "object": {
      // As text rather than inline code: the prose draws code with backticks
      // around it, which is noise in a table of values.
      return text(value === null ? "" : JSON.stringify(value));
    }
    default: {
      return text("");
    }
  }
};

const isMapping = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function remarkFrontMatterTable() {
  return (tree: MdastNode): void => {
    const children = tree.children;
    if (!children) {
      return;
    }
    // Front matter is only front matter at the top of the document, so there
    // is at most one and it is at the start.
    const index = children.findIndex((node) => node.type === "yaml");
    if (index === -1) {
      return;
    }
    const block = frontMatterBlock(children[index]?.value ?? "");
    children.splice(index, 1, ...(block ? [block] : []));
  };
}

function frontMatterBlock(source: string): MdastNode | null {
  let parsed: unknown;
  try {
    parsed = parse(source);
  } catch {
    return { lang: "yaml", type: "code", value: source };
  }
  if (parsed === null || parsed === undefined) {
    return null;
  }
  if (!isMapping(parsed)) {
    return { lang: "yaml", type: "code", value: source };
  }
  return {
    align: [null, null],
    children: [
      row([cell(text("Properties")), cell(text(""))]),
      ...Object.entries(parsed).map(([key, value]) =>
        row([cell(text(key)), cell(cellFor(value))]),
      ),
    ],
    type: "table",
  };
}
