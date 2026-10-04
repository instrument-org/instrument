/**
 * The Slack summary of a release, made without a model: the release notes the
 * tag carries, cut down to their summary line and the first sentence of the
 * first bullets in each section, or, for a tag cut without notes, its commits grouped by scope with
 * the plumbing left out.
 *
 *   node release-summary.ts slack --notes <file> --commits <file> [--skills-commits <file>]
 *
 * `--notes` holds the tag's message (empty for a tag cut without notes);
 * `--commits` and `--skills-commits` hold `git log --pretty="%h %s"` output.
 * Prints Slack mrkdwn. Dependency-free so a release job can run it with Node
 * alone, and copied as-is into the internal repository's release workflows.
 */
import { readFileSync } from "node:fs";

/** Bullets shown per section before the rest collapse into a count. */
const BULLETS_PER_SECTION = 2;
/** Scope groups shown before the rest collapse into a count. */
const GROUPS_SHOWN = 5;
const BULLET_MAX_LENGTH = 90;

/** Scopes whose commits never change what a user sees. */
const PLUMBING_SCOPES = new Set([
  "ci",
  "cspell",
  "dependencies",
  "deps",
  "docs",
  "dx",
  "eslint-config",
  "evals",
  "knip",
  "lint",
  "pnpm",
  "registry",
  "release",
  "skills",
  "spelling",
  "studio-drive",
]);

const AREA_NAMES: Record<string, string> = {
  "agent-browser": "Browser",
  "ai-gateway": "Models",
  api: "API",
  apps: "Apps",
  browser: "Browser",
  pages: "Pages",
  studio: "App",
  task: "Tasks",
  tasks: "Tasks",
  web: "Website",
  workspace: "Agent",
};

interface Section {
  bullets: string[];
  title: string;
}

/** The summary paragraph and the `##` sections of a release-notes document. */
export function parseNotes(notes: string): {
  sections: Section[];
  summary: string;
} {
  const summaryLines: string[] = [];
  const sections: Section[] = [];
  for (const raw of notes.split("\n")) {
    const line = raw.trim();
    const heading = /^#{2,3}\s+(.+)$/.exec(line);
    if (heading?.[1]) {
      sections.push({ bullets: [], title: heading[1].trim() });
      continue;
    }
    const bullet = /^[-*•]\s+(.+)$/.exec(line);
    const current = sections.at(-1);
    if (bullet?.[1] && current) {
      current.bullets.push(bullet[1].trim());
      continue;
    }
    if (!current && line && !line.startsWith("#")) {
      summaryLines.push(line);
    }
  }
  return { sections, summary: summaryLines.join(" ") };
}

/** Slack mrkdwn for release notes, or undefined when there are none. */
export function summarizeNotes(notes: string): string | undefined {
  const { sections, summary } = parseNotes(notes);
  if (!summary && sections.length === 0) {
    return undefined;
  }
  const lines = summary ? [mrkdwn(summary)] : [];
  for (const { bullets, title } of sections) {
    if (bullets.length === 0) {
      continue;
    }
    const shown = bullets
      .slice(0, BULLETS_PER_SECTION)
      .map((bullet) => mrkdwn(shorten(firstSentence(bullet))));
    const rest = bullets.length - shown.length;
    lines.push(
      `*${mrkdwn(title)}*: ${shown.join("; ")}${rest > 0 ? ` _(+${rest} more)_` : ""}`,
    );
  }
  return lines.join("\n");
}

/**
 * Slack mrkdwn for a release cut without notes: user-facing commits grouped by
 * their scope prefix, largest group first, each with its first subjects.
 */
export function summarizeCommits(commits: string, skillsCommits = ""): string {
  const groups = new Map<string, string[]>();
  const add = (area: string, subject: string) => {
    groups.set(area, [...(groups.get(area) ?? []), subject]);
  };
  for (const { scopes, subject } of parseCommits(commits)) {
    const shown = scopes.filter((scope) => !PLUMBING_SCOPES.has(scope));
    const scope = shown[0];
    if (scope) {
      add(AREA_NAMES[scope] ?? scope, subject);
    }
  }
  for (const { scopes, subject } of parseCommits(skillsCommits)) {
    if (!scopes.some((scope) => PLUMBING_SCOPES.has(scope))) {
      add("Skills", subject);
    }
  }
  if (groups.size === 0) {
    return "_No user-facing changes in this release._";
  }
  const sorted = [...groups].sort((a, b) => b[1].length - a[1].length);
  const lines = sorted.slice(0, GROUPS_SHOWN).map(
    ([area, subjects]) =>
      `*${mrkdwn(area)}* (${subjects.length}): ${subjects
        .slice(0, BULLETS_PER_SECTION)
        .map((subject) => mrkdwn(shorten(subject)))
        .join("; ")}`,
  );
  const rest = sorted.length - GROUPS_SHOWN;
  if (rest > 0) {
    lines.push(`_+${rest} more ${rest === 1 ? "area" : "areas"}_`);
  }
  return lines.join("\n");
}

/** `%h %s` lines as their scopes and subject; a line with no scope has none. */
function parseCommits(log: string) {
  return log
    .split("\n")
    .map((line) => line.trim().replace(/^[0-9a-f]{7,40}\s+/, ""))
    .filter(Boolean)
    .map((line) => {
      // `scope: x`, `a,b: x`, and the older `feat(scope): x`.
      const match =
        /^(?:[a-z]+\(([^)]+)\)|([a-z0-9][a-z0-9,/ -]*)):\s+(.+)$/i.exec(line);
      const scopes = (match?.[1] ?? match?.[2] ?? "")
        .split(",")
        .map((scope) => scope.trim().toLowerCase())
        .filter(Boolean);
      return { scopes, subject: match?.[3] ?? line };
    });
}

/** A bullet's lead, which the notes keep short for exactly this. */
function firstSentence(text: string) {
  return (/^(.+?)[.!?](?:\s|$)/.exec(text)?.[1] ?? text).trim();
}

function shorten(text: string) {
  if (text.length <= BULLET_MAX_LENGTH) {
    return text;
  }
  const cut = text.slice(0, BULLET_MAX_LENGTH);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:]$/, "")}…`;
}

/** Markdown to Slack mrkdwn: escaped `&<>`, `**bold**`, and `[text](url)`. */
export function mrkdwn(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "<$2|$1>");
}

function readArg(args: string[], flag: string) {
  const index = args.indexOf(flag);
  const file = index === -1 ? undefined : args[index + 1];
  return file ? readFileSync(file, "utf8") : "";
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args[0] !== "slack") {
    console.error(
      "usage: release-summary.ts slack --notes <file> --commits <file> [--skills-commits <file>]",
    );
    process.exit(1);
  }
  process.stdout.write(
    summarizeNotes(readArg(args, "--notes")) ??
      summarizeCommits(
        readArg(args, "--commits"),
        readArg(args, "--skills-commits"),
      ),
  );
}
