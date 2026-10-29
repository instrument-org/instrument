import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

// The parser family the renderer reads a reply with, so a link is read here
// exactly as it draws there: angle-bracket and parenthesized targets, nested
// brackets in the text, references, and nothing inside code.
const markdown = unified().use(remarkParse).use(remarkGfm);

type MarkdownNode =
  | ReturnType<typeof markdown.parse>
  | ReturnType<typeof markdown.parse>["children"][number];

/**
 * The target of every link and image a reply draws, in order. Code is shown
 * as written, so a link inside it is no link, and the files fence is read on
 * its own, as the card it renders.
 */
export function linkTargetsIn(text: string): string[] {
  const definitions = new Map<string, string>();
  const found: ({ reference: string } | { url: string })[] = [];
  const visit = (node: MarkdownNode) => {
    if (node.type === "definition") {
      definitions.set(node.identifier, node.url);
    } else if (node.type === "link" || node.type === "image") {
      found.push({ url: node.url });
    } else if (
      node.type === "linkReference" ||
      node.type === "imageReference"
    ) {
      found.push({ reference: node.identifier });
    }
    if ("children" in node) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };
  visit(markdown.parse(text));
  return found.flatMap((each) => {
    const url = "url" in each ? each.url : definitions.get(each.reference);
    return url ? [url] : [];
  });
}
