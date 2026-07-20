import {
  Fragment,
  type Node as ProseMirrorNode,
  Schema,
} from "prosemirror-model";

const skillTokenPattern = /\[\$([^\]]+)\]\(skill:([^)]+)\)/g;

export const promptSchema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: {
      content: "inline*",
      group: "block",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    },
    skill: {
      atom: true,
      attrs: { name: {} },
      group: "inline",
      inline: true,
      selectable: false,
      toDOM: (node) => {
        const name = String(node.attrs.name);
        return [
          "span",
          {
            class:
              "mx-0.5 inline-flex rounded-md bg-brown-100 px-1.5 py-0.5 align-baseline font-medium text-brown-700 dark:bg-brown-900/60 dark:text-brown-200",
            contenteditable: "false",
            "data-skill": name,
          },
          `/${name}`,
        ];
      },
    },
    text: { group: "inline" },
  },
});

export function promptDocFromText(value: string) {
  const paragraphs = value.split("\n").map((line) => {
    const nodes: ProseMirrorNode[] = [];
    let cursor = 0;
    for (const match of line.matchAll(skillTokenPattern)) {
      const index = match.index;
      const label = match[1];
      const name = match[2];
      if (!label || !name || label !== name) {
        continue;
      }
      if (index > cursor) {
        nodes.push(promptSchema.text(line.slice(cursor, index)));
      }
      nodes.push(promptSchema.nodes.skill.create({ name }));
      cursor = index + match[0].length;
    }
    if (cursor < line.length) {
      nodes.push(promptSchema.text(line.slice(cursor)));
    }
    return promptSchema.nodes.paragraph.create(null, Fragment.from(nodes));
  });
  return promptSchema.nodes.doc.create(null, paragraphs);
}

export function promptTextFromDoc(doc: ProseMirrorNode) {
  const paragraphs: string[] = [];
  for (let index = 0; index < doc.childCount; index++) {
    const paragraph = doc.child(index);
    let value = "";
    for (let childIndex = 0; childIndex < paragraph.childCount; childIndex++) {
      const node = paragraph.child(childIndex);
      value +=
        node.type === promptSchema.nodes.skill
          ? `[$${String(node.attrs.name)}](skill:${String(node.attrs.name)})`
          : (node.text ?? "");
    }
    paragraphs.push(value);
  }
  return paragraphs.join("\n");
}
