import { splitSkillText } from "@/client/lib/skill-text";
import { SKILL_TOKEN_CLASS_NAME } from "@/client/lib/skill-tokens";
import {
  skillMentionLabel,
  skillMentionToken,
  splitSkillMention,
} from "@instrument-org/shared/skill-mention";
import {
  Fragment,
  type Node as ProseMirrorNode,
  Schema,
} from "prosemirror-model";
import { type Command, type TextSelection } from "prosemirror-state";

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
            class: SKILL_TOKEN_CLASS_NAME,
            contenteditable: "false",
            "data-skill": name,
          },
          skillMentionLabel(name),
        ];
      },
    },
    text: { group: "inline" },
  },
});

/**
 * Remove a whole skill token on a single backspace.
 *
 * The node is an unselectable atom, so ProseMirror's default backward-delete
 * leaves it in place and the press appears to do nothing. Deleting outright is
 * also what the token reads as: it is one chip, not the characters it renders.
 */
export const deleteSkillBackward: Command = (state, dispatch) => {
  const { $cursor } = state.selection as TextSelection;
  if (!$cursor || $cursor.parentOffset === 0) {
    return false;
  }
  const before = $cursor.nodeBefore;
  if (before?.type !== promptSchema.nodes.skill) {
    return false;
  }
  dispatch?.(state.tr.delete($cursor.pos - before.nodeSize, $cursor.pos));
  return true;
};

export const deleteSkillForward: Command = (state, dispatch) => {
  const { $cursor } = state.selection as TextSelection;
  if (!$cursor) {
    return false;
  }
  const after = $cursor.nodeAfter;
  if (after?.type !== promptSchema.nodes.skill) {
    return false;
  }
  dispatch?.(state.tr.delete($cursor.pos, $cursor.pos + after.nodeSize));
  return true;
};

export function promptDocFromPastedText(
  value: string,
  skills: {
    aliases: string[];
    id: string;
    qualifiedName: string;
  }[],
) {
  const skillIdsByName = new Map<string, string>();
  for (const skill of skills) {
    for (const name of [...skill.aliases, skill.qualifiedName]) {
      skillIdsByName.set(name, skill.id);
    }
  }

  const paragraphs = value.split("\n").map((line) => {
    const nodes: ProseMirrorNode[] = splitSkillText(line).map((segment) => {
      if (segment.type === "text") {
        return promptSchema.text(segment.text);
      }
      const name =
        segment.type === "skill"
          ? segment.name
          : skillIdsByName.get(segment.name);
      return name
        ? promptSchema.nodes.skill.create({ name })
        : promptSchema.text(skillMentionLabel(segment.name));
    });
    return promptSchema.nodes.paragraph.create(null, Fragment.from(nodes));
  });
  return promptSchema.nodes.doc.create(null, paragraphs);
}

export function promptDocFromText(value: string) {
  const paragraphs = value.split("\n").map((line) => {
    const nodes: ProseMirrorNode[] = splitSkillMention(line).map((segment) =>
      segment.type === "skill"
        ? promptSchema.nodes.skill.create({ name: segment.name })
        : promptSchema.text(segment.text),
    );
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
          ? skillMentionToken(String(node.attrs.name))
          : (node.text ?? "");
    }
    paragraphs.push(value);
  }
  return paragraphs.join("\n");
}
