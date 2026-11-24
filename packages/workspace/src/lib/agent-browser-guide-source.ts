import { splitFrontMatter } from "@instrument-org/shared";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * Where the agent's agent-browser guide comes from: the core guide the
 * installed CLI release ships (`skill-data/core`, the text
 * `agent-browser skills get core` prints), with what describes setting
 * agent-browser up elsewhere, or what this app refuses or does differently,
 * left out. Upstream's text is cut, never reworded: what the app says in its
 * place is in the addendum (`agent-browser-guide.ts`). Read by the refresh script, which
 * writes the result into `agent-browser-core-guide.generated.ts`, and by the
 * test that fails when that file no longer matches the installed release.
 * Nothing here runs in the app.
 */

/** The upstream sections left out, by their exact heading. */
export const LEFT_OUT_SECTIONS = [
  // Names a session with `session id` and `--session`, both refused: the app
  // gives each chat's session its own.
  "## Always use your own session",
  // A table of references and other skills, most about setups the app
  // refuses (the credential vault, restore, streaming, proxies) or running
  // agent-browser somewhere else. The addendum names the references carried.
  "## Load more when you need it",
  // Teaches `fill`, the credential vault and plugins, all refused or advised
  // against here.
  "### Log in",
  // `session id` and `--restore`, both refused: sign-ins last here without.
  "### Keep a login across runs",
  // Names tabs `t2`, where a tab here has one id, its tab_ id, and teaches
  // `tab keep`, which is refused. The addendum covers tabs.
  "### Tabs",
  // `--session`, `--cdp` and `--pin-tab`, all refused.
  "### Parallel browsers",
  // `--allowed-domains`, which is refused, and a reference the addendum's
  // own rules stand in for.
  "## Working safely",
] as const;

/**
 * Paragraphs left out of the sections kept, by how they start: each teaches a
 * command or setup this app refuses or manages itself, or says the opposite
 * of the addendum.
 */
export const LEFT_OUT_PARAGRAPHS = [
  // Points at the references table and the other skills, both left out.
  "agent-browser drives Chrome over CDP from the command line.",
  // "Take a screenshot only when the user asks for one", where the addendum
  // has a page the agent made checked with one, and has one taken whenever
  // how the page looks matters.
  "Prefer snapshots. Take a screenshot only when the user asks for one",
  "Only when the user asks for one, or for something the DOM cannot represent",
  // `flow` and `--capture`, both refused.
  "A saved flow (experimental)",
  // `install` and `close`, both refused.
  "Install once with",
  // "After any page-changing action, wait", where the result of one comes
  // back here with the page after it attached.
  "Agents fail more often from bad waits than from bad selectors.",
  // Waits here give up after ten seconds, and a network-idle wait after five
  // without failing, where this says 25 and an error.
  "Don't use `wait --load networkidle` as a generic SPA wait",
  // `doctor`, which is refused.
  "Run `agent-browser doctor` before anything else",
] as const;

/**
 * List items left out of the lists kept, by how they start, for the same
 * reasons as a paragraph.
 */
export const LEFT_OUT_LIST_ITEMS = [
  // `tab keep`, which is refused: tabs here stay live.
  "- **A background tab shows stale state",
  // Relaunching with `--webgpu`, where the browser is the app's own.
  "- **WebGPU page screenshots black**",
] as const;

/** The references that apply here, kept for `skills get core --ref <name>` and `--full`. */
const REFERENCE_FILES = [
  "commands.md",
  "snapshot-refs.md",
  "trust-boundaries.md",
] as const;

const req = createRequire(import.meta.url);

/** The installed agent-browser release, and its core guide's folder. */
export function installedAgentBrowser(): { coreDir: string; version: string } {
  const packageJson = req.resolve("agent-browser/package.json");
  const { version } = req(packageJson) as { version: string };
  return {
    coreDir: path.join(path.dirname(packageJson), "skill-data", "core"),
    version,
  };
}

/** The installed core guide as shipped, frontmatter removed, sections and all. */
export function upstreamCoreGuide(coreDir: string): string {
  return splitFrontMatter(
    readFileSync(path.join(coreDir, "SKILL.md"), "utf8"),
  ).body.replace(/^\n+/, "");
}

/** One of the guide's references: its path in the release's core guide folder, and its text. */
interface GuideReference {
  path: string;
  text: string;
}

/** The guide and its references as the agent reads them, from an installed release. */
export function coreGuideFrom(coreDir: string): {
  guide: string;
  references: GuideReference[];
} {
  return {
    guide: withoutListItems(
      withoutParagraphs(
        withoutSections(upstreamCoreGuide(coreDir), LEFT_OUT_SECTIONS),
        LEFT_OUT_PARAGRAPHS,
      ),
      LEFT_OUT_LIST_ITEMS,
    )
      .trim()
      .concat("\n"),
    references: REFERENCE_FILES.map((name) => ({
      path: `references/${name}`,
      text: readFileSync(path.join(coreDir, "references", name), "utf8").trim(),
    })),
  };
}

/**
 * A Markdown text with the named sections removed. A heading is a line
 * starting with `#` outside a fenced code block, whose shell comments start
 * the same way; a section runs to the next heading of its level or above.
 */
export function withoutSections(
  markdown: string,
  headings: readonly string[],
): string {
  const kept: string[] = [];
  let inFence = false;
  let skippingLevel: number | undefined;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) {
      inFence = !inFence;
    }
    const heading = inFence ? undefined : /^(#{1,6}) /.exec(line);
    if (heading?.[1] !== undefined) {
      const level = heading[1].length;
      if (skippingLevel !== undefined && level <= skippingLevel) {
        skippingLevel = undefined;
      }
      if (skippingLevel === undefined && headings.includes(line.trim())) {
        skippingLevel = level;
      }
    }
    if (skippingLevel === undefined) {
      kept.push(line);
    }
  }
  return kept.join("\n");
}

/**
 * A Markdown text with the paragraphs starting with any of `starts` removed,
 * along with the blank line after each. A paragraph is a run of lines between
 * blank lines, outside a fenced code block.
 */
export function withoutParagraphs(
  markdown: string,
  starts: readonly string[],
): string {
  const kept: string[] = [];
  let inFence = false;
  let skipping = false;
  let atParagraphStart = true;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) {
      inFence = !inFence;
    }
    if (!inFence && atParagraphStart && line.trim() !== "") {
      skipping = starts.some((start) => line.startsWith(start));
    }
    if (line.trim() === "") {
      atParagraphStart = !inFence;
      if (skipping) {
        skipping = false;
        continue;
      }
    } else {
      atParagraphStart = false;
    }
    if (!skipping) {
      kept.push(line);
    }
  }
  return kept.join("\n");
}

/**
 * A Markdown text with the list items starting with any of `starts` removed.
 * An item is a line starting with `- ` outside a fenced code block, with the
 * lines after it up to the next item or blank line.
 */
export function withoutListItems(
  markdown: string,
  starts: readonly string[],
): string {
  const kept: string[] = [];
  let inFence = false;
  let skipping = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) {
      inFence = !inFence;
    }
    if (!inFence && (line.startsWith("- ") || line.trim() === "")) {
      skipping = starts.some((start) => line.startsWith(start));
    }
    if (!skipping) {
      kept.push(line);
    }
  }
  return kept.join("\n");
}

/** The list items of a Markdown text, by their first line, outside fenced code. */
export function listItemStartsOf(markdown: string): string[] {
  let inFence = false;
  return markdown.split("\n").flatMap((line) => {
    if (line.startsWith("```")) {
      inFence = !inFence;
      return [];
    }
    return !inFence && line.startsWith("- ") ? [line] : [];
  });
}

/** The paragraphs of a Markdown text, by their first line, outside fenced code. */
export function paragraphStartsOf(markdown: string): string[] {
  const starts: string[] = [];
  let inFence = false;
  let atParagraphStart = true;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) {
      inFence = !inFence;
    }
    if (line.trim() === "") {
      atParagraphStart = !inFence;
    } else {
      if (!inFence && atParagraphStart) {
        starts.push(line);
      }
      atParagraphStart = false;
    }
  }
  return starts;
}

/** The headings of a Markdown text, outside fenced code. */
export function headingsOf(markdown: string): string[] {
  let inFence = false;
  return markdown.split("\n").flatMap((line) => {
    if (line.startsWith("```")) {
      inFence = !inFence;
      return [];
    }
    return !inFence && /^#{1,6} /.test(line) ? [line.trim()] : [];
  });
}

/** The generated module's text for an installed release. */
export function generatedGuideModule({
  guide,
  references,
  version,
}: {
  guide: string;
  references: GuideReference[];
  version: string;
}): string {
  return [
    "// Generated by scripts/refresh-agent-browser-guide.ts from the installed",
    "// agent-browser release's skill-data/core. Do not edit; run the script.",
    "",
    `export const AGENT_BROWSER_CORE_GUIDE_READ_FROM = ${JSON.stringify(version)};`,
    "",
    `export const AGENT_BROWSER_CORE_GUIDE = ${JSON.stringify(guide)};`,
    "",
    `export const AGENT_BROWSER_CORE_REFERENCES = ${JSON.stringify(references, null, 2)};`,
    "",
  ].join("\n");
}
