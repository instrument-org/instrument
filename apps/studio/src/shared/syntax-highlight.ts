import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import {
  highlightCode,
  type Tag,
  tagHighlighter,
  tags as t,
} from "@lezer/highlight";

/**
 * Code highlighted the one way the app highlights it, with CodeMirror's Lezer
 * grammars: the editors through CodeMirror itself, and every view that only
 * shows code (a reply's code blocks, a command, a notebook's cells, a file's
 * thumbnail) as static markup from {@link highlightLines}. Both mark a token
 * with the same class, `syntax-<kind>`, colored in `code-colors.css`, so code
 * reads the same wherever it is and a theme is one stylesheet.
 */

/** The kinds of token that are colored, and the grammar tags each covers. */
const TOKEN_KINDS: { kind: string; tag: Tag | Tag[] }[] = [
  {
    kind: "keyword",
    tag: [
      t.keyword,
      t.modifier,
      t.controlKeyword,
      t.operatorKeyword,
      t.definitionKeyword,
      t.moduleKeyword,
      t.operator,
      t.escape,
      t.character,
    ],
  },
  {
    kind: "string",
    tag: [t.string, t.special(t.string), t.regexp, t.docString],
  },
  {
    kind: "constant",
    tag: [
      t.number,
      t.bool,
      t.null,
      t.atom,
      t.self,
      t.constant(t.variableName),
      t.standard(t.variableName),
      t.standard(t.typeName),
      t.special(t.variableName),
      t.unit,
      t.color,
      t.url,
      t.attributeName,
      t.monospace,
    ],
  },
  { kind: "comment", tag: [t.comment, t.meta] },
  {
    kind: "function",
    tag: [
      t.function(t.variableName),
      t.function(t.propertyName),
      t.function(t.definition(t.variableName)),
      t.macroName,
    ],
  },
  {
    kind: "entity",
    tag: [
      t.typeName,
      t.className,
      t.namespace,
      t.definition(t.typeName),
      t.labelName,
      t.changed,
    ],
  },
  { kind: "tag", tag: [t.tagName, t.quote, t.inserted] },
  { kind: "invalid", tag: t.invalid },
  { kind: "deleted", tag: t.deleted },
  { kind: "property", tag: [t.propertyName, t.definition(t.propertyName)] },
  { kind: "heading", tag: t.heading },
  { kind: "emphasis", tag: t.emphasis },
  { kind: "strong", tag: t.strong },
  { kind: "strikethrough", tag: t.strikethrough },
  { kind: "link", tag: t.link },
];

/** Marks each token with its kind's class, for CodeMirror and for static markup alike. */
export const syntaxClassHighlighter = tagHighlighter(
  TOKEN_KINDS.map(({ kind, tag }) => ({ class: `syntax-${kind}`, tag })),
);

/**
 * Every grammar the app has: CodeMirror's own set, and community ones for
 * languages it lacks, each loaded the first time it is asked for.
 */
export const syntaxLanguages: readonly LanguageDescription[] = [
  ...languages,
  LanguageDescription.of({
    alias: ["ex", "exs"],
    extensions: ["ex", "exs"],
    load: async () => (await import("codemirror-lang-elixir")).elixir(),
    name: "Elixir",
  }),
  LanguageDescription.of({
    extensions: ["nix"],
    load: async () => (await import("@replit/codemirror-lang-nix")).nix(),
    name: "Nix",
  }),
  LanguageDescription.of({
    alias: ["sol"],
    extensions: ["sol"],
    load: async () =>
      (await import("@replit/codemirror-lang-solidity")).solidity,
    name: "Solidity",
  }),
  LanguageDescription.of({
    extensions: ["svelte"],
    load: async () => (await import("@replit/codemirror-lang-svelte")).svelte(),
    name: "Svelte",
  }),
];

/**
 * What callers name a language by that the grammars do not: ids from the
 * extension table and fence words a reply uses. Anything else is matched by
 * the grammar's own name and aliases, and then by its file extensions, which
 * covers `py`, `rs`, `md` and the like.
 */
const ALIASES: Record<string, string> = {
  console: "shell",
  docker: "dockerfile",
  fish: "shell",
  jsonc: "json",
  matlab: "octave",
  mdx: "markdown",
  shellscript: "shell",
  vb: "vb.net",
};

/** Names for no language at all, one of which LaTeX claims as an extension. */
const PLAIN_TEXT = new Set(["plain", "plaintext", "text", "txt"]);

/** The grammar for a language named by id, alias or extension; undefined for none. */
export function syntaxLanguage(
  name: string | undefined,
): LanguageDescription | undefined {
  if (!name) {
    return;
  }
  const lower = name.toLowerCase();
  if (PLAIN_TEXT.has(lower)) {
    return;
  }
  const asked = ALIASES[lower] ?? lower;
  return (
    LanguageDescription.matchLanguageName(syntaxLanguages, asked, false) ??
    syntaxLanguages.find((description) =>
      description.extensions.includes(asked),
    )
  );
}

function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * The code as static markup in a grammar already loaded (`description.support`
 * set), one string per line, to be joined with `\n`: a
 * `<pre class="code-highlight">` whose `<code>` holds a `<span class="line">`
 * per line of `syntax-*` spans.
 */
export function highlightLoaded(
  code: string,
  description: LanguageDescription,
): string[] {
  const grammar = description.support?.language;
  if (!grammar) {
    throw new Error(`The ${description.name} grammar is not loaded yet`);
  }
  const lines: string[] = [];
  let line = "";
  highlightCode(
    code,
    grammar.parser.parse(code),
    syntaxClassHighlighter,
    (text, classes) => {
      line += classes
        ? `<span class="${classes}">${escapeHtml(text)}</span>`
        : escapeHtml(text);
    },
    () => {
      lines.push(`<span class="line">${line}</span>`);
      line = "";
    },
  );
  lines.push(`<span class="line">${line}</span>`);
  const name = escapeHtml(description.name.toLowerCase());
  const last = lines.length - 1;
  return lines.map(
    (each, index) =>
      `${index === 0 ? `<pre class="code-highlight" data-language="${name}"><code>` : ""}${each}${index === last ? "</code></pre>" : ""}`,
  );
}

/**
 * {@link highlightLoaded}, loading the grammar first. Undefined when there is
 * no grammar for the language.
 */
export async function highlightLines(
  code: string,
  language: string | undefined,
): Promise<string[] | undefined> {
  const description = syntaxLanguage(language);
  if (!description) {
    return;
  }
  await description.load();
  return highlightLoaded(code, description);
}
