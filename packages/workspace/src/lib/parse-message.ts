import { parse as parseYaml } from "yaml";

import { AGENT_MESSAGE_LANGUAGE } from "../constants";

/**
 * What a message is for, which decides what the card offers: an email opens
 * in a mail app with its subject, anything else is copied or shared.
 */
export const MESSAGE_KINDS = [
  "email",
  "text",
  "chat",
  "post",
  "comment",
  "other",
] as const;

/** Words the user will send as their own, as the agent wrote them. */
export interface MessageDraft {
  body: string;
  kind: MessageKind;
  subject?: string;
  /** Who it goes to, as written: a name, an address, or both. */
  to?: string;
  /** Where it goes, in the agent's words: "Slack", "LinkedIn", "Figma". */
  via?: string;
}

export type MessageKind = (typeof MESSAGE_KINDS)[number];

/**
 * A ```message fence in a reply, its body captured, in the shape of
 * `FILES_FENCE`.
 */
export const MESSAGE_FENCE = new RegExp(
  String.raw`^[ \t]*\x60{3,}[ \t]*${AGENT_MESSAGE_LANGUAGE}[ \t]*$([\s\S]*?)^[ \t]*\x60{3,}[ \t]*$`,
  "gmu",
);

const FIELDS = ["message", "kind", "to", "subject", "via"] as const;
type Field = (typeof FIELDS)[number];

// A header line written without front matter's rules: `to: Sam`.
const HEADER_LINE = /^([a-z]+):(.*)$/i;

/**
 * Whether a Markdown file is a message rather than a document: its front
 * matter says `message:`. Other front matter is a document's own.
 */
export function isMessageDocument(source: string): boolean {
  const text = source.replaceAll("\r\n", "\n");
  if (!text.startsWith("---\n")) {
    return false;
  }
  const end = text.indexOf("\n---", 4);
  if (end === -1) {
    return false;
  }
  return readFrontMatter(text.slice(4, end)).message !== undefined;
}

/**
 * Reads a message: front matter (or bare `key: value` lines up to the first
 * blank one) and the body under it. The kind comes from `message:` (or
 * `kind:`); left out, a subject makes it an email and anything else is
 * `other`, which still copies.
 *
 * Tolerant on purpose, since a fence still streaming is half a message and a
 * model writes headers either way: an unclosed front matter is headers with
 * no body yet, and front matter that does not parse is read line by line.
 */
export function parseMessage(source: string): MessageDraft {
  const text = source.replaceAll("\r\n", "\n").replace(/^\n+/, "");
  const { body, fields } = splitHeaders(text);
  const subject = fields.subject;
  return {
    body: body.trim(),
    kind: kindOf(fields.message ?? fields.kind, subject),
    ...(subject ? { subject } : {}),
    ...(fields.to ? { to: fields.to } : {}),
    ...(fields.via ? { via: fields.via } : {}),
  };
}

const FIELD_NAMES: ReadonlySet<string> = new Set(FIELDS);

function isField(key: string | undefined): key is Field {
  return key !== undefined && FIELD_NAMES.has(key);
}

function kindOf(
  written: string | undefined,
  subject: string | undefined,
): MessageKind {
  const kind = written?.toLowerCase();
  const known = MESSAGE_KINDS.find((candidate) => candidate === kind);
  if (known) {
    return known;
  }
  return subject ? "email" : "other";
}

function readFrontMatter(yaml: string): Partial<Record<Field, string>> {
  const fields: Partial<Record<Field, string>> = {};
  let parsed: unknown;
  try {
    parsed = parseYaml(yaml);
  } catch {
    parsed = undefined;
  }
  if (parsed !== null && typeof parsed === "object") {
    for (const [key, value] of Object.entries(parsed)) {
      const field = key.toLowerCase();
      if (isField(field) && value !== null && value !== undefined) {
        fields[field] = Array.isArray(value)
          ? value.map(String).join(", ")
          : String(value).trim();
      }
    }
    return fields;
  }
  for (const line of yaml.split("\n")) {
    const match = HEADER_LINE.exec(line);
    const key = match?.[1]?.toLowerCase();
    if (match && isField(key)) {
      fields[key] = (match[2] ?? "").trim();
    }
  }
  return fields;
}

function splitHeaders(text: string): {
  body: string;
  fields: Partial<Record<Field, string>>;
} {
  if (text.startsWith("---\n")) {
    const end = /\n---[ \t]*(?:\n|$)/.exec(text.slice(3));
    if (!end) {
      return { body: "", fields: readFrontMatter(text.slice(4)) };
    }
    const close = 3 + end.index;
    return {
      body: text.slice(close + end[0].length),
      fields: readFrontMatter(text.slice(4, close)),
    };
  }

  const lines = text.split("\n");
  const fields: Partial<Record<Field, string>> = {};
  let index = 0;
  for (; index < lines.length; index += 1) {
    const match = HEADER_LINE.exec(lines[index] ?? "");
    const key = match?.[1]?.toLowerCase();
    if (!match || !isField(key)) {
      break;
    }
    fields[key] = (match[2] ?? "").trim();
  }
  // Headers end at a blank line; a first line that was not one is all body.
  if (index === 0) {
    return { body: text, fields };
  }
  return { body: lines.slice(index).join("\n"), fields };
}
