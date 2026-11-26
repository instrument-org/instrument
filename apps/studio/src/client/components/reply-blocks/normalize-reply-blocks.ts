import {
  HEADER_KEYS,
  REPLY_BLOCK_WORDS,
  replyBlockNameOf,
  type ReplyBlockName,
} from "./names";

/**
 * Turns the three ways a reply may wrap a block into the one the renderer
 * reads, a fence named for the block:
 *
 * - a fence, ```` ```message ````, kept, with an alias or a different case
 *   written as the block's own name and attributes after the name moved into
 *   header lines;
 * - a directive, `:::message{to="Dana"}` ... `:::`, read leniently
 *   (`::: message`, `:::message to=Dana`, `{.x}` ignored);
 * - a tag on its own line, `<message to="Dana">` ... `</message>`.
 *
 * Attributes become `key: value` lines at the top of the body, for the keys
 * the block reads. A wrapper still open at the end of the text stays an open
 * fence, which is how a block still arriving is drawn. Lines inside a code
 * fence or an inline code span are never read, nor is an unknown name, which
 * stays the text it was.
 *
 * While the text is arriving (`streaming`), a last line that could still turn
 * out to open or close a wrapper is held back until its line ends, as a fence's
 * opener already is.
 */
export function normalizeReplyBlocks(
  text: string,
  { streaming = false }: { streaming?: boolean } = {},
): string {
  if (!MAYBE_BLOCK.test(text)) {
    return text;
  }

  const lines = text.split("\n");
  const out: string[] = [];
  let fence: string | undefined;
  let codeRun = 0;
  let wrapper: Wrapper | undefined;

  const finish = (closed: boolean) => {
    if (wrapper) {
      out.push(...fenceLinesOf(wrapper, closed));
      wrapper = undefined;
    }
  };

  for (const [index, line] of lines.entries()) {
    const isArrivingLine =
      streaming && index === lines.length - 1 && line !== "";

    if (wrapper?.fence !== undefined) {
      wrapper.body.push(line);
      if (closesFence(line, wrapper.fence)) {
        wrapper.fence = undefined;
      }
      continue;
    }
    if (fence !== undefined) {
      out.push(line);
      if (closesFence(line, fence)) {
        fence = undefined;
      }
      continue;
    }
    if (isArrivingLine && codeRun === 0 && mayStillBeWrapperLine(line)) {
      continue;
    }

    const opener = codeRun === 0 ? wrapperOpenerOf(line) : undefined;

    if (wrapper) {
      const closer = wrapperCloserOf(line, wrapper.name);
      if (closer !== undefined) {
        if (closer !== "") {
          wrapper.body.push(closer);
        }
        finish(true);
        continue;
      }
      if (opener) {
        // A new block before this one closed: the closer was left out.
        finish(true);
      } else {
        const nested = FENCE_OPENER.exec(line)?.[2];
        if (nested !== undefined) {
          wrapper.fence = nested;
        }
        wrapper.body.push(line);
        continue;
      }
    }

    if (opener) {
      wrapper = opener;
      codeRun = 0;
      continue;
    }

    // A fence interrupts a paragraph, so a code span open on the lines above
    // ends before it.
    const native = FENCE_OPENER.exec(line);
    const [, indent = "", run = "", info = ""] = native ?? [];
    if (native && !(run.startsWith("`") && info.includes("`"))) {
      fence = run;
      codeRun = 0;
      out.push(...nativeOpenerOf(indent, run, info));
      continue;
    }

    out.push(line);
    codeRun = line.trim() === "" ? 0 : codeRunAfter(line, codeRun);
  }

  finish(false);
  return out.join("\n");
}

interface Wrapper {
  attributes: Attribute[];
  body: string[];
  /** A code fence opened inside the body, which no closer of ours ends. */
  fence?: string;
  name: ReplyBlockName;
}

type Attribute = [key: string, value: string];

// Anything that could start a wrapper or a fence worth renaming. Most replies
// have none, and skip the walk.
const MAYBE_BLOCK = /^ {0,3}(?::{3}|<[a-z]|`{3}|~{3})/im;

const FENCE_OPENER = /^( {0,3})(`{3,}|~{3,})(.*)$/;

const DIRECTIVE_OPENER = /^ {0,3}:{3,}\s*([a-z][\w-]*)\s*(.*)$/i;
const DIRECTIVE_CLOSER = /^ {0,3}:{3,}\s*$/;
const TAG_OPENER = /^ {0,3}<([a-z][\w-]*)(\s[^>]*)?>(.*)$/i;
const TAG_CLOSER = /<\/([a-z][\w-]*)\s*>\s*$/i;

const closesFence = (line: string, fence: string) => {
  const trimmed = line.trim();
  return (
    /^ {0,3}\S/.test(line) &&
    trimmed.length >= fence.length &&
    trimmed.replaceAll(fence.charAt(0), "") === ""
  );
};

/**
 * Where an inline code span stands at the end of a line: the length of the
 * backtick run still waiting for its match, or 0. A span can run over a line
 * break inside one paragraph, and a wrapper line inside one is code.
 */
const codeRunAfter = (line: string, open: number) => {
  let run = open;
  for (const match of line.matchAll(/`+/g)) {
    const length = match[0].length;
    if (run === 0) {
      run = length;
    } else if (length === run) {
      run = 0;
    }
  }
  return run;
};

/**
 * Whether a line not yet ended may still become a wrapper's opener or closer:
 * colons on their own or before a name, or a tag whose name is on its way to
 * one we know.
 */
const mayStillBeWrapperLine = (line: string) => {
  if (/^ {0,3}:/.test(line)) {
    return true;
  }
  const tag = /^ {0,3}<\/?([a-z]*)(.?)/i.exec(line);
  if (!tag) {
    return false;
  }
  const [, word = "", after = ""] = tag;
  const name = word.toLowerCase();
  return after === ""
    ? REPLY_BLOCK_WORDS.some((known) => known.startsWith(name))
    : REPLY_BLOCK_WORDS.includes(name);
};

const wrapperOpenerOf = (line: string): undefined | Wrapper => {
  const directive = DIRECTIVE_OPENER.exec(line);
  if (directive) {
    const name = replyBlockNameOf(directive[1] ?? "");
    return name
      ? { attributes: attributesOf(directive[2] ?? ""), body: [], name }
      : undefined;
  }
  const tag = TAG_OPENER.exec(line);
  if (!tag || tag[2]?.trimEnd().endsWith("/")) {
    return undefined;
  }
  const name = replyBlockNameOf(tag[1] ?? "");
  if (!name) {
    return undefined;
  }
  const wrapper: Wrapper = {
    attributes: attributesOf(tag[2] ?? ""),
    body: [],
    name,
  };
  // Words written on the tag's own line are the body's first line.
  const rest = tag[3] ?? "";
  if (rest.trim() !== "") {
    wrapper.body.push(rest.replace(/^\s+/, ""));
  }
  return wrapper;
};

/**
 * Whether a line ends the open wrapper, and what of it is still the body's:
 * `""` for a closer on its own line, the text before it for a closing tag at
 * the end of one, undefined when it closes nothing.
 */
const wrapperCloserOf = (
  line: string,
  name: ReplyBlockName,
): string | undefined => {
  if (DIRECTIVE_CLOSER.test(line)) {
    return "";
  }
  const tag = TAG_CLOSER.exec(line);
  if (!tag || replyBlockNameOf(tag[1] ?? "") !== name) {
    return undefined;
  }
  return line.slice(0, tag.index).trimEnd();
};

/**
 * A fence's opening line, named for the block it is when it is one of ours,
 * with what followed the name taken as attributes.
 */
const nativeOpenerOf = (indent: string, run: string, info: string) => {
  const [, word = "", rest = ""] = /^\s*([^\s{]*)\s*(.*)$/.exec(info) ?? [];
  const name = replyBlockNameOf(word);
  if (!name || (word === name && rest.trim() === "")) {
    return [`${indent}${run}${info}`];
  }
  return [
    `${indent}${run}${name}`,
    ...headerLinesOf(name, attributesOf(rest), []),
  ];
};

const fenceLinesOf = (wrapper: Wrapper, closed: boolean) => {
  const longest = Math.max(
    0,
    ...wrapper.body.map((line) => /^\s*(`+)/.exec(line)?.[1]?.length ?? 0),
  );
  const fence = "`".repeat(Math.max(3, longest + 1));
  const header = headerLinesOf(wrapper.name, wrapper.attributes, wrapper.body);
  const body =
    wrapper.name === "message"
      ? messageBodyOf(header, wrapper.body)
      : [...header, ...wrapper.body];
  return [`${fence}${wrapper.name}`, ...body, ...(closed ? [fence] : [])];
};

/**
 * A message reads its headers from front matter when it has some, so the
 * wrapper's go inside it there rather than above it.
 */
const messageBodyOf = (header: string[], body: string[]) => {
  const first = body.findIndex((line) => line.trim() !== "");
  if (first !== -1 && body[first]?.trim() === "---") {
    return [...body.slice(0, first + 1), ...header, ...body.slice(first + 1)];
  }
  return [...header, ...body];
};

const headerLinesOf = (
  name: ReplyBlockName,
  attributes: Attribute[],
  body: string[],
) => {
  const keys = HEADER_KEYS[name];
  // A key the body already sets is the body's to say.
  const written = new Set(
    body
      .map((line) => /^([a-z]+):/i.exec(line)?.[1]?.toLowerCase())
      .filter((key) => key !== undefined),
  );
  return attributes
    .filter(([key]) => keys.includes(key) && !written.has(key))
    .map(([key, value]) => `${key}: ${value}`);
};

const ATTRIBUTE =
  /([a-z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s,}]+))|[.#][\w-]+|([a-z_][\w-]*)/gi;

/**
 * The attributes after a directive's or a tag's name: `{pick="Pinecrest"}`,
 * `pick=Pinecrest, unit=$`, `pick='x'`, a bare `key` as `true`. Classes and
 * ids (`.x`, `#y`) are dropped. Words with no `=` at all are a title,
 * `:::chart Monthly spend`.
 */
const attributesOf = (written: string): Attribute[] => {
  const text = written.trim();
  if (text === "") {
    return [];
  }
  if (!/[={}"']/.test(text)) {
    return [["title", text]];
  }
  const inner = text.replace(/^\{/, "").replace(/\}\s*$/, "");
  const attributes: Attribute[] = [];
  for (const match of inner.matchAll(ATTRIBUTE)) {
    const [, key, double, single, bare, flag] = match;
    if (key) {
      attributes.push([
        key.toLowerCase(),
        (double ?? single ?? bare ?? "").trim(),
      ]);
    } else if (flag) {
      attributes.push([flag.toLowerCase(), "true"]);
    }
  }
  return attributes;
};
