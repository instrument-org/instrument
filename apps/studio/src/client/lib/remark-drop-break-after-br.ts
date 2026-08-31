/**
 * Drops the line break `remark-breaks` reads out of the newline that follows an
 * explicit `<br>`.
 *
 * Treating every newline as a break is what makes a model's single-newline
 * paragraph render the way it was written, and most of what a model writes needs
 * it. A model that also spells the break out as `<br>` at the end of the line
 * therefore gets two of them, and the second draws as a blank line above
 * whatever comes next -- most visibly an image, which is a block of its own and
 * so already starts on a line of its own.
 *
 * Only the newline immediately after a `<br>` goes. A `<br><br>` written to open
 * a blank line still opens one.
 */

// `@types/mdast` is not a dependency here, and this reads two fields, so it
// describes the nodes structurally rather than pulling the tree's full types in.
interface MdastNode {
  children?: MdastNode[];
  type: string;
  value?: string;
}

const isBreakTag = (node: MdastNode | undefined): boolean =>
  node?.type === "html" && /^<br\s*\/?>$/i.test(node.value ?? "");

export function remarkDropBreakAfterBr() {
  return (tree: MdastNode): void => {
    dropInChildren(tree);
  };
}

function dropInChildren(node: MdastNode): void {
  const children = node.children;
  if (!children) {
    return;
  }

  for (const child of children) {
    dropInChildren(child);
  }

  node.children = children.filter(
    (child, index) =>
      child.type !== "break" || !isBreakTag(children[index - 1]),
  );
}
