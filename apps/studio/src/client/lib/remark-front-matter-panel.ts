/**
 * Hands a document's YAML front matter to the renderer as one node it draws as
 * a properties panel.
 *
 * Runs after `remark-frontmatter`, which is what keeps the block from being read
 * as markdown at all: without it the closing `---` underlines everything above
 * it into one enormous heading, which is how a transcript's metadata was
 * reaching the screen. Hiding the block would be the other option, and loses
 * the one place a file says what it is -- a note's tags, a transcript's task
 * name and model.
 *
 * The block leaves here as a `details` element carrying the YAML source as its
 * text and an id the renderer's `details` component recognizes; parsing and
 * drawing happen there (`FrontMatter`), where the summary line and the
 * key/value grid can be React rather than markdown. A `details` because that
 * is what it is drawn as, and because it survives the sanitize pass a document
 * holding raw HTML goes through: the tag is on the allow-list, and the id comes
 * out of that pass with its clobber prefix, which the component also accepts.
 */

export const FRONT_MATTER_ID = "front-matter";

// `@types/mdast` is not a dependency here, so the nodes are described
// structurally, with only the fields this reads and writes.
interface MdastNode {
  children?: MdastNode[];
  data?: {
    hChildren?: MdastNode[];
    hName?: string;
    hProperties?: Record<string, unknown>;
  };
  type: string;
  value?: string;
}

export function remarkFrontMatterPanel() {
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
    children.splice(index, 1, {
      data: {
        hChildren: [{ type: "text", value: children[index]?.value ?? "" }],
        hName: "details",
        hProperties: { id: FRONT_MATTER_ID },
      },
      type: "frontMatter",
    });
  };
}
