/**
 * The #releases post for an Instrument release, made without a model: a card
 * with the release notes the tag carries, cut down to their summary line and
 * the first sentence of the first bullets in each section, or, for a tag cut
 * without notes, its commits grouped by scope with the plumbing left out; then
 * one thread reply with the whole notes or every commit.
 *
 *   node release-summary.ts post --tag <tag> --release-url <url> --notes <file> --commits <file> [--skills-commits <file>] [--mention <mrkdwn>]
 *   node release-summary.ts preview ...   (same flags; prints the JSON it would post)
 *
 * `--notes` holds the tag's message (empty for a tag cut without notes);
 * `--commits` and `--skills-commits` hold `git log --pretty="%h %s"` output.
 * A stable tag's card asks `--mention` to publish the draft release. With
 * SLACK_BOT_TOKEN and SLACK_RELEASE_CHANNEL set, posts the card and its thread
 * reply as the bot; otherwise, or when the bot cannot post, the card alone
 * goes to SLACK_RELEASE_WEBHOOK_URL. Dependency-free so a release job can run
 * it with Node alone. The internal repository's scripts/release-summary.ts
 * grew from this file and posts its deploys in the same shape.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Bullets shown per section before the rest collapse into a count. */
const BULLETS_PER_SECTION = 2;
/** Scope groups shown before the rest collapse into a count. */
const GROUPS_SHOWN = 5;
/** Commits past which a release without notes is called out as big. */
const BIG_RELEASE = 15;
/** Commits listed in the thread reply before the rest point at the release. */
const COMMITS_IN_THREAD = 60;
const CARD_COLOR = "#14B8A6";
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

type Release = {
  commits: string;
  mention: string;
  notes: string;
  releaseUrl: string;
  skillsCommits: string;
  tag: string;
};

/** The card and its thread reply, as Slack `chat.postMessage` bodies minus the channel. */
export function buildPost(release: Release) {
  const channel = release.tag.includes("-alpha")
    ? "alpha"
    : release.tag.includes("-beta")
      ? "beta"
      : undefined;
  const commits = parseCommits(release.commits).length;
  const skills = parseCommits(release.skillsCommits).length;
  const notes = summarizeNotes(release.notes);
  const headline = `:desktop_computer: *Instrument ${channel ? `${channel} ` : ""}${mrkdwn(release.tag)} is out*`;
  const counts = [
    commits > 0 && plural(commits, "change"),
    skills > 0 && plural(skills, "skill change"),
  ].filter(Boolean);
  const context = [
    ...counts,
    `<${release.releaseUrl}|${channel ? "Release notes" : "Draft release"}>`,
  ].join(" · ");
  const section = (text: string) => ({
    text: { text, type: "mrkdwn" },
    type: "section",
  });
  const blocks = [
    section(headline),
    ...(!notes && commits > BIG_RELEASE
      ? [
          section(
            `:warning: *Big release:* ${commits} changes went out without release notes.`,
          ),
        ]
      : []),
    section(notes ?? summarizeCommits(release.commits, release.skillsCommits)),
    { elements: [{ text: context, type: "mrkdwn" }], type: "context" },
  ];
  // A mention inside an attachment notifies no one, so the stable release's
  // nudge sits above the card.
  const card = {
    ...(channel
      ? {}
      : {
          blocks: [
            section(
              `${release.mention}: review and publish the draft GitHub release notes for this version.`,
            ),
          ],
        }),
    attachments: [{ blocks, color: CARD_COLOR }],
    text: `Instrument ${channel ? `${channel} ` : ""}${release.tag} is out`,
    unfurl_links: false,
    unfurl_media: false,
  };
  return { card, thread: threadText(release) };
}

/** The whole notes when the tag has them, otherwise every commit by scope. */
function threadText(release: Release) {
  const { sections, summary } = parseNotes(release.notes);
  if (summary || sections.length > 0) {
    const sectionsText = sections
      .filter(({ bullets }) => bullets.length > 0)
      .map(
        ({ bullets, title }) =>
          `*${mrkdwn(title)}*\n${bullets.map((bullet) => `• ${mrkdwn(bullet)}`).join("\n")}`,
      );
    return sectionsText.length > 0 ? sectionsText.join("\n\n") : undefined;
  }
  const groups = new Map<string, string[]>();
  for (const { scopes, subject } of parseCommits(release.commits)) {
    const scope = scopes[0] ?? "";
    const area = AREA_NAMES[scope] ?? (scope || "Other");
    groups.set(area, [...(groups.get(area) ?? []), subject]);
  }
  const skills = parseCommits(release.skillsCommits).map(
    ({ subject }) => subject,
  );
  const sorted = [...groups].sort((a, b) => b[1].length - a[1].length);
  if (skills.length > 0) {
    sorted.push(["Skills", skills]);
  }
  let budget = COMMITS_IN_THREAD;
  const lines: string[] = [];
  for (const [area, subjects] of sorted) {
    if (budget <= 0) {
      break;
    }
    lines.push(
      `${lines.length > 0 ? "\n" : ""}*${mrkdwn(area)}* (${subjects.length})`,
    );
    for (const subject of subjects.slice(0, budget)) {
      lines.push(`• ${mrkdwn(subject)}`);
    }
    budget -= subjects.length;
  }
  const total = sorted.reduce((sum, [, subjects]) => sum + subjects.length, 0);
  if (total > COMMITS_IN_THREAD) {
    lines.push(
      `_${total - COMMITS_IN_THREAD} more in <${release.releaseUrl}|the release>._`,
    );
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}

/**
 * Posts the card, then its thread reply when a bot token can make one. A card
 * the bot cannot post, such as when it is not in the channel, goes through the
 * webhook instead.
 */
export async function post(
  release: Release,
  env: Record<string, string | undefined>,
) {
  const { card, thread } = buildPost(release);
  const token = env.SLACK_BOT_TOKEN;
  const channel = env.SLACK_RELEASE_CHANNEL;
  const webhook = env.SLACK_RELEASE_WEBHOOK_URL;
  if (token && channel) {
    let posted: Awaited<ReturnType<typeof slackApi>> | undefined;
    try {
      posted = await slackApi(token, { ...card, channel });
    } catch (error) {
      if (!webhook) {
        throw error;
      }
      console.warn(
        `::warning::Posting as the bot failed, using the webhook: ${String(error)}`,
      );
    }
    if (posted) {
      if (thread) {
        await slackApi(token, {
          channel,
          text: thread,
          thread_ts: posted.ts,
          unfurl_links: false,
          unfurl_media: false,
        });
      }
      return;
    }
  }
  if (!webhook) {
    throw new Error(
      "Set SLACK_BOT_TOKEN and SLACK_RELEASE_CHANNEL, or SLACK_RELEASE_WEBHOOK_URL",
    );
  }
  const response = await fetch(webhook, {
    body: JSON.stringify(card),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      `Slack webhook answered ${response.status}: ${await response.text()}`,
    );
  }
}

async function slackApi(token: string, body: Record<string, unknown>) {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    method: "POST",
  });
  // Slack's Web API answers with this shape for every method.
  const result = (await response.json()) as {
    error?: string;
    ok: boolean;
    ts?: string;
  };
  if (!result.ok) {
    throw new Error(`chat.postMessage failed: ${result.error ?? "unknown"}`);
  }
  return result;
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function readFlag(args: string[], flag: string) {
  const index = args.indexOf(flag);
  return index === -1 ? "" : (args[index + 1] ?? "");
}

function readArg(args: string[], flag: string) {
  const file = readFlag(args, flag);
  return file ? readFileSync(file, "utf8") : "";
}

// Run as a script, not imported by its tests.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const args = process.argv.slice(2);
  const command = args[0];
  if (command !== "post" && command !== "preview") {
    console.error(
      "usage: release-summary.ts post|preview --tag <tag> --release-url <url> --notes <file> --commits <file> [--skills-commits <file>] [--mention <mrkdwn>]",
    );
    process.exit(1);
  }
  const release = {
    commits: readArg(args, "--commits"),
    mention: readFlag(args, "--mention") || "<!channel>",
    notes: readArg(args, "--notes"),
    releaseUrl: readFlag(args, "--release-url"),
    skillsCommits: readArg(args, "--skills-commits"),
    tag: readFlag(args, "--tag"),
  };
  if (command === "preview") {
    console.log(JSON.stringify(buildPost(release), null, 2));
  } else {
    await post(release, process.env);
  }
}
