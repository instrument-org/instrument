import {
  type AppMention,
  appMentionToken,
  splitAppMentions,
} from "@/client/lib/app-mention";
import { type SkillTextSegment, splitSkillText } from "@/client/lib/skill-text";
import { SKILL_TOKEN_CLASS_NAME } from "@/client/lib/skill-tokens";
import {
  type SkillMentionSegment,
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
    /** An app named in the prompt, by its slug, wearing its name. */
    app: {
      atom: true,
      attrs: { name: {}, slug: {} },
      group: "inline",
      inline: true,
      selectable: false,
      toDOM: (node) => [
        "span",
        {
          class: SKILL_TOKEN_CLASS_NAME,
          contenteditable: "false",
          "data-app": String(node.attrs.slug),
        },
        String(node.attrs.name),
      ],
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

/** The app a node names, when it is an app node. */
export function appOfNode(node: ProseMirrorNode): AppMention | undefined {
  return node.type === promptSchema.nodes.app
    ? { name: String(node.attrs.name), slug: String(node.attrs.slug) }
    : undefined;
}

/**
 * Remove a whole token on a single backspace.
 *
 * A skill or an app is an unselectable atom, so ProseMirror's default
 * backward-delete leaves it in place and the press appears to do nothing.
 * Deleting outright is also what the token reads as: it is one chip, not the
 * characters it renders.
 */
export const deleteTokenBackward: Command = (state, dispatch) => {
  const { $cursor } = state.selection as TextSelection;
  if (!$cursor || $cursor.parentOffset === 0) {
    return false;
  }
  const before = $cursor.nodeBefore;
  // A text node is a leaf too, so the schema's own word for a token is what
  // tells a chip from the character before the caret.
  if (!before?.type.spec.atom) {
    return false;
  }
  dispatch?.(state.tr.delete($cursor.pos - before.nodeSize, $cursor.pos));
  return true;
};

export const deleteTokenForward: Command = (state, dispatch) => {
  const { $cursor } = state.selection as TextSelection;
  if (!$cursor) {
    return false;
  }
  const after = $cursor.nodeAfter;
  if (!after?.type.spec.atom) {
    return false;
  }
  dispatch?.(state.tr.delete($cursor.pos, $cursor.pos + after.nodeSize));
  return true;
};

/** The text of a line as nodes: its apps as tokens, the rest as text. */
function textNodes(text: string): ProseMirrorNode[] {
  return splitAppMentions(text).map((segment) =>
    segment.type === "app"
      ? promptSchema.nodes.app.create(segment.app)
      : promptSchema.text(segment.text),
  );
}

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
    const nodes = splitSkillText(line).flatMap(
      (segment: SkillTextSegment): ProseMirrorNode[] => {
        if (segment.type === "text") {
          return textNodes(segment.text);
        }
        const name =
          segment.type === "skill"
            ? segment.name
            : skillIdsByName.get(segment.name);
        return [
          name
            ? promptSchema.nodes.skill.create({ name })
            : promptSchema.text(skillMentionLabel(segment.name)),
        ];
      },
    );
    return promptSchema.nodes.paragraph.create(null, Fragment.from(nodes));
  });
  return promptSchema.nodes.doc.create(null, paragraphs);
}

export function promptDocFromText(value: string) {
  const paragraphs = value.split("\n").map((line) => {
    const nodes = splitSkillMention(line).flatMap(
      (segment: SkillMentionSegment): ProseMirrorNode[] =>
        segment.type === "skill"
          ? [promptSchema.nodes.skill.create({ name: segment.name })]
          : textNodes(segment.text),
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
      const app = appOfNode(node);
      value +=
        node.type === promptSchema.nodes.skill
          ? skillMentionToken(String(node.attrs.name))
          : app
            ? appMentionToken(app)
            : (node.text ?? "");
    }
    paragraphs.push(value);
  }
  return paragraphs.join("\n");
}
