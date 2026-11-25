import {
  type AppMention,
  appMentionToken,
  splitAppMentions,
} from "@/client/lib/app-mention";
import { type SkillTextSegment, splitSkillText } from "@/client/lib/skill-text";
import { SKILL_TOKEN_CLASS_NAME } from "@/client/lib/skill-tokens";
import { isWebPage } from "@/client/lib/open-target";
import { markdownLinkText, splitMarkdownLinks } from "@/shared/link-text";
import {
  skillMentionLabel,
  type SkillMentionSegment,
  skillMentionToken,
  splitSkillMention,
} from "@instrument-org/shared/skill-mention";
import {
  dictatedToken,
  splitDictatedText,
} from "@instrument-org/shared/dictated-text";
import {
  Fragment,
  type Mark,
  type Node as ProseMirrorNode,
  Schema,
} from "prosemirror-model";
import {
  type Command,
  type EditorState,
  type TextSelection,
  type Transaction,
} from "prosemirror-state";

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
  marks: {
    /**
     * Words the person dictated rather than typed, which the model is told
     * were spoken. It looks like any other text; editing inside it keeps it.
     */
    dictated: {
      inclusive: false,
      parseDOM: [{ tag: "span[data-dictated]" }],
      toDOM: () => ["span", { "data-dictated": "" }, 0],
    },
    /**
     * Words that link to an address, written in the text as a Markdown link
     * (`[words](address)`), which is how the sent message reads them back. An
     * address typed on its own carries no mark: it is drawn as a link where it
     * stands, and stays the characters it is.
     */
    link: {
      attrs: { href: {} },
      inclusive: false,
      toDOM: (mark) => ["span", { "data-href": String(mark.attrs.href) }, 0],
    },
  },
});

/** The address a node links to, when its words carry a link. */
export function linkOfNode(node: ProseMirrorNode): string | undefined {
  const mark = promptSchema.marks.link.isInSet(node.marks);
  return mark ? String(mark.attrs.href) : undefined;
}

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
          return markedTextNodes(segment.text);
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
          : markedTextNodes(segment.text),
    );
    return promptSchema.nodes.paragraph.create(null, Fragment.from(nodes));
  });
  return promptSchema.nodes.doc.create(null, paragraphs);
}

/**
 * The space dictated words need before them at the end of `doc`: none on an
 * empty last line or after a space, one after anything else, a chip included.
 */
export function dictationLead(doc: ProseMirrorNode): "" | " " {
  const end = doc.lastChild?.lastChild;
  if (!end) {
    return "";
  }
  return end.isText && /\s$/.test(end.text ?? "") ? "" : " ";
}

/**
 * Puts dictated words at the end of the document, after a space on its last
 * line, so several takes in a row read as one run of sentences; into the last
 * line itself when it is empty (an empty box, or one that ends on a fresh
 * line). The words carry the dictated mark and the space before them does
 * not; nothing already written is touched, and the step undoes as one.
 */
export function appendDictated(state: EditorState, text: string): Transaction {
  const [first = "", ...rest] = text.trim().split("\n");
  const { doc } = state;
  const lineEnd = doc.content.size - 1;
  const lead = dictationLead(doc);
  const tr = state.tr.insert(
    lineEnd,
    Fragment.from([
      ...(lead ? [promptSchema.text(lead)] : []),
      ...(first ? textNodes(first, [dictatedMark()]) : []),
    ]),
  );
  if (rest.length > 0) {
    tr.insert(
      tr.doc.content.size,
      rest.map((line) =>
        promptSchema.nodes.paragraph.create(
          null,
          Fragment.from(line ? textNodes(line, [dictatedMark()]) : []),
        ),
      ),
    );
  }
  return tr;
}

export function promptTextFromDoc(doc: ProseMirrorNode) {
  const paragraphs: string[] = [];
  for (let index = 0; index < doc.childCount; index++) {
    const paragraph = doc.child(index);
    let value = "";
    for (let childIndex = 0; childIndex < paragraph.childCount; childIndex++) {
      const node = paragraph.child(childIndex);
      const href = linkOfNode(node);
      if (href !== undefined) {
        // A link's words can span several nodes (part of them dictated), and
        // are written once, whole, as one Markdown link.
        let label = node.text ?? "";
        while (childIndex + 1 < paragraph.childCount) {
          const next = paragraph.child(childIndex + 1);
          if (linkOfNode(next) !== href) {
            break;
          }
          label += next.text ?? "";
          childIndex++;
        }
        value += markdownLinkText(label, href);
        continue;
      }
      const app = appOfNode(node);
      const text = node.text ?? "";
      const dictated =
        promptSchema.marks.dictated.isInSet(node.marks) !== undefined;
      value +=
        node.type === promptSchema.nodes.skill
          ? skillMentionToken(String(node.attrs.name))
          : app
            ? appMentionToken(app)
            : dictated && text.trim()
              ? dictatedToken(text)
              : text;
    }
    paragraphs.push(value);
  }
  return paragraphs.join("\n");
}

/** The text of a line as nodes: its apps as tokens, the rest as text with `marks`. */
function textNodes(
  text: string,
  marks: readonly Mark[] = [],
): ProseMirrorNode[] {
  return splitAppMentions(text).map((segment) =>
    segment.type === "app"
      ? promptSchema.nodes.app.create(segment.app)
      : promptSchema.text(segment.text, marks),
  );
}

/**
 * The text of a line as nodes: its dictated runs carrying the dictated mark,
 * and its Markdown links as their words carrying the link mark.
 */
function markedTextNodes(text: string): ProseMirrorNode[] {
  return splitDictatedText(text).flatMap((segment) => {
    if (!segment.text) {
      return [];
    }
    if (segment.dictated) {
      return textNodes(segment.text, [dictatedMark()]);
    }
    // Only a link to a web page is linked words. One into the app is an app's
    // chip or stays the text it is, as it always has.
    return splitMarkdownLinks(segment.text).flatMap((part) =>
      part.type === "text"
        ? textNodes(part.text)
        : isWebPage(part.href)
          ? [
              promptSchema.text(part.label, [
                promptSchema.marks.link.create({ href: part.href }),
              ]),
            ]
          : textNodes(`[${part.label}](${part.href})`),
    );
  });
}

const dictatedMark = () => promptSchema.marks.dictated.create();
