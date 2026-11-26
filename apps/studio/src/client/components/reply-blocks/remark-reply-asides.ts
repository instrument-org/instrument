/**
 * Marks the two blockquotes a reply means as something more than a quote, for
 * the blockquote renderer to draw:
 *
 * - a GitHub alert, `> [!WARNING]` on the first line (any case; words after
 *   the marker are its title), as `data-alert` on the quote and its title as
 *   a first paragraph marked `data-alert-title`;
 * - a quote ending on its source, a last line that is only a link or
 *   `Source:`, `-`, `—` or `from` and a link, as a last paragraph marked
 *   `data-quote-source` holding the link alone.
 *
 * Runs after `remark-breaks`, so the lines of a paragraph are split by
 * `break` nodes.
 */

// `@types/mdast` is not a dependency here; this reads a handful of fields.
interface MdastNode {
  children?: MdastNode[];
  data?: { hProperties?: Record<string, boolean | string> };
  type: string;
  url?: string;
  value?: string;
}

const ALERT_TYPES = ["note", "tip", "important", "warning", "caution"] as const;

export type AlertType = (typeof ALERT_TYPES)[number];

export const alertTypeOf = (written: unknown): AlertType | undefined =>
  typeof written === "string"
    ? ALERT_TYPES.find((type) => type === written)
    : undefined;

export function remarkReplyAsides() {
  return (tree: MdastNode): void => {
    walk(tree);
  };
}

function walk(node: MdastNode) {
  for (const child of node.children ?? []) {
    walk(child);
  }
  if (node.type === "blockquote") {
    if (!markAlert(node)) {
      markSource(node);
    }
  }
}

const MARKER = /^\s*\[!([a-z]+)\][^\S\n]*/i;

/** The paragraph's first line, up to its first break, and what follows it. */
const splitFirstLine = (children: MdastNode[]) => {
  const at = children.findIndex((child) => child.type === "break");
  return at === -1
    ? { first: children, rest: [] }
    : { first: children.slice(0, at), rest: children.slice(at + 1) };
};

function markAlert(quote: MdastNode): boolean {
  const paragraph = quote.children?.[0];
  const lead = paragraph?.children?.[0];
  if (paragraph?.type !== "paragraph" || lead?.type !== "text") {
    return false;
  }
  const marker = MARKER.exec(lead.value ?? "");
  if (!marker) {
    return false;
  }
  const written = (marker[1] ?? "").toLowerCase();
  // An unknown type reads as a note, as GitHub's own readers do not, but
  // Obsidian's do: the writer meant an aside.
  const type = alertTypeOf(written) ?? "note";
  const { first, rest } = splitFirstLine(paragraph.children ?? []);
  const title = [
    { ...lead, value: (lead.value ?? "").slice(marker[0].length) },
    ...first.slice(1),
  ].filter((node) => node.type !== "text" || (node.value ?? "").trim() !== "");

  quote.data = {
    ...quote.data,
    hProperties: { ...quote.data?.hProperties, dataAlert: type },
  };
  const titleParagraph: MdastNode = {
    children: title,
    data: { hProperties: { dataAlertTitle: true } },
    type: "paragraph",
  };
  paragraph.children = rest;
  quote.children = [
    ...(title.length > 0 ? [titleParagraph] : []),
    ...(rest.length > 0 ? [paragraph] : []),
    ...(quote.children ?? []).slice(1),
  ];
  return true;
}

const SOURCE_LEAD = /^\s*(?:source:|sources:|from|via|[-—–])?\s*$/i;

function markSource(quote: MdastNode) {
  const paragraph = quote.children?.at(-1);
  const children = paragraph?.children ?? [];
  if (paragraph?.type !== "paragraph" || children.length === 0) {
    return;
  }
  const at = children.findLastIndex((child) => child.type === "break");
  const line = children.slice(at + 1);
  const links = line.filter((child) => child.type === "link");
  const words = line.filter((child) => child.type !== "link");
  const lead = line[0]?.type === "text" ? (line[0].value ?? "") : "";
  const link = links[0];
  if (
    !link ||
    links.length !== 1 ||
    // The quote itself, all on one line, is not its own source.
    (at === -1 && (quote.children?.length ?? 0) === 1) ||
    !words.every(
      (child) =>
        child.type === "text" &&
        (child === line[0]
          ? SOURCE_LEAD.test(lead)
          : /^[\s.,;)]*$/.test(child.value ?? "")),
    )
  ) {
    return;
  }

  const source: MdastNode = {
    children: [link],
    data: { hProperties: { dataQuoteSource: true } },
    type: "paragraph",
  };
  paragraph.children = children.slice(0, Math.max(0, at));
  quote.children = [
    ...(quote.children ?? []).slice(0, -1),
    ...(paragraph.children.length > 0 ? [paragraph] : []),
    source,
  ];
}
