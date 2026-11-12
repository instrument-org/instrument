/**
 * The #releases post for an Instrument release, made without a model: a card
 * that says the release is out with the notes' summary line, then one thread
 * reply with the whole notes or, for a tag cut without notes, every commit
 * grouped by scope. A stable release's card carries a tag saying whether its
 * GitHub release is still a draft, and a button to review the draft until it
 * is published; the thread reply opens by asking `--mention` to publish it.
 *
 *   node release-summary.ts post --tag <tag> --release-url <url> --notes <file> --commits <file> [--skills-commits <file>] [--mention <mrkdwn>] [--save <file>]
 *   node release-summary.ts preview ...   (same flags; prints the JSON it would post)
 *   node release-summary.ts update --card <file> --published true|false [--release-url <url>]
 *
 * `--notes` holds the tag's message (empty for a tag cut without notes);
 * `--commits` and `--skills-commits` hold `git log --pretty="%h %s"` output.
 * Posts the card and its thread reply as the bot, with SLACK_BOT_TOKEN and
 * SLACK_RELEASE_CHANNEL, and `--save` writes the card's channel, the card's
 * and the thread reply's `ts`, and the release to a file. `update` reads that
 * file and rebuilds the card and the thread reply for the GitHub release's
 * state, which `release-card.yml` runs
 * whenever the release is published or unpublished. Dependency-free so a
 * release job can run it with Node alone. The internal repository's
 * scripts/release-summary.ts grew from this file.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Commits past which a release without notes is called out as big. */
const BIG_RELEASE = 15;
/** Commits listed in the thread reply before the rest point at the release. */
const COMMITS_IN_THREAD = 60;

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

/** Markdown to Slack mrkdwn: escaped `&<>`, `**bold**`, and `[text](url)`. */
export function mrkdwn(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "<$2|$1>");
}

type RichElement =
  | { style?: { bold: true }; text: string; type: "text" }
  | { color: string; text: string; type: "tag" }
  | { text: string; type: "link"; url: string };

/**
 * Markdown to rich text elements: `**bold**` and `[text](url)`, the rest as
 * written. Rich text shows its text as it is, so nothing is escaped.
 */
export function richInline(text: string): RichElement[] {
  const elements: RichElement[] = [];
  const pattern = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > at) {
      elements.push({ text: text.slice(at, match.index), type: "text" });
    }
    if (match[1] !== undefined) {
      elements.push({ style: { bold: true }, text: match[1], type: "text" });
    } else if (match[2] !== undefined && match[3] !== undefined) {
      elements.push({ text: match[2], type: "link", url: match[3] });
    }
    at = match.index + match[0].length;
  }
  if (at < text.length) {
    elements.push({ text: text.slice(at), type: "text" });
  }
  return elements;
}

const richText = (elements: RichElement[]) => ({
  elements: [{ elements, type: "rich_text_section" }],
  type: "rich_text",
});

type Release = {
  commits: string;
  mention: string;
  notes: string;
  /** Whether the GitHub release is published; a stable one starts as a draft. */
  published?: boolean;
  releaseUrl: string;
  skillsCommits: string;
  tag: string;
};

/** The tag as a person says it: `v2.1.0` is 2.1.0, `v2.0.0-beta.139` is 2.0.0 beta 139. */
function versionName(tag: string) {
  const match = /^v?(\d+\.\d+\.\d+)-(alpha|beta)\.(\d+)$/.exec(tag);
  return match ? match.slice(1).join(" ") : tag.replace(/^v(?=\d)/, "");
}

/** The card's line under its headline: the notes' summary, or what stands in for it. */
function lead(release: Release, commits: number) {
  const { sections, summary } = parseNotes(release.notes);
  if (summary) {
    return richInline(summary);
  }
  const titles = sections
    .filter(({ bullets }) => bullets.length > 0)
    .map(({ title }) => title);
  if (titles.length > 0) {
    return [
      {
        text: `The notes in the thread cover ${listed(titles)}.`,
        type: "text" as const,
      },
    ];
  }
  const text =
    commits === 0
      ? "This release has no notes and no changes to the app."
      : commits > BIG_RELEASE
        ? `${commits} changes went out without release notes. They are listed in the thread.`
        : `This release has no notes. Its ${plural(commits, "change")} ${commits === 1 ? "is" : "are"} listed in the thread.`;
  return [{ text, type: "text" as const }];
}

/** The card and its thread reply, as Slack `chat.postMessage` bodies minus the channel. */
export function buildPost(release: Release) {
  const prerelease = /-(alpha|beta)/.test(release.tag);
  const draft = !prerelease && !release.published;
  const commits = parseCommits(release.commits).length;
  const headline = `Instrument ${versionName(release.tag)} is out`;
  const blocks = [
    richText([
      { style: { bold: true }, text: headline, type: "text" },
      ...(prerelease
        ? []
        : [
            { text: "  ", type: "text" as const },
            draft
              ? {
                  color: "yellow",
                  text: "Notes in draft",
                  type: "tag" as const,
                }
              : { color: "green", text: "Published", type: "tag" as const },
          ]),
    ]),
    richText(lead(release, commits)),
    ...(draft
      ? [
          {
            elements: [
              {
                action_id: "review_draft",
                style: "primary",
                text: { text: "Review the draft", type: "plain_text" },
                type: "button",
                url: release.releaseUrl,
              },
            ],
            type: "actions",
          },
        ]
      : []),
  ];
  const card = {
    blocks,
    text: draft ? `${headline}, and its notes are a draft` : headline,
    unfurl_links: false,
    unfurl_media: false,
  };
  return { card, thread: threadText(release, { commits, draft }) };
}

/**
 * The thread reply: for a draft, the ask to publish it; then the whole notes
 * when the tag has them, otherwise every commit by scope; then the counts and
 * the release's address.
 */
function threadText(
  release: Release,
  { commits, draft }: { commits: number; draft: boolean },
) {
  const body = notesText(release) ?? commitsText(release);
  if (!body) {
    return undefined;
  }
  const ask = draft
    ? `${release.mention} the notes for ${versionName(release.tag)} are a draft on GitHub. Read them over and publish them when they look right.\n\n`
    : "";
  const skills = parseCommits(release.skillsCommits).length;
  const counts = [
    commits > 0 && plural(commits, "change"),
    skills > 0 && plural(skills, "skill change"),
    `<${tagUrl(release)}|Release on GitHub>`,
  ].filter(Boolean);
  return `${ask}${body}\n\n_${counts.join(" · ")}_`;
}

/**
 * The release's page by its tag. A draft's own address is an `untagged-`
 * editing URL that stops working once someone publishes it, and the tag's
 * page is the one that lasts.
 */
function tagUrl({ releaseUrl, tag }: Release) {
  return releaseUrl.replace(
    /\/releases\/tag\/[^/]+$/,
    `/releases/tag/${encodeURIComponent(tag)}`,
  );
}

/** The notes' sections in full, or undefined when the tag has no notes. */
function notesText({ notes }: Release) {
  const { sections } = parseNotes(notes);
  const sectionsText = sections
    .filter(({ bullets }) => bullets.length > 0)
    .map(
      ({ bullets, title }) =>
        `*${mrkdwn(title)}*\n${bullets.map((bullet) => `• ${mrkdwn(bullet)}`).join("\n")}`,
    );
  return sectionsText.length > 0 ? sectionsText.join("\n\n") : undefined;
}

/** Every commit by scope, largest first, with the skills last. */
function commitsText(release: Release) {
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
      `_${total - COMMITS_IN_THREAD} more in <${tagUrl(release)}|the release>._`,
    );
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}

/**
 * Where a posted card and its thread reply are, and the release they were
 * built from, for `update`. Cards posted before `threadTs` was kept have none,
 * and their thread reply stays as it is.
 */
type PostedCard = {
  channel: string;
  release: Release;
  threadTs?: string;
  ts: string;
};

/** Posts the card as the bot, then its thread reply, and returns where the card is. */
export async function post(
  release: Release,
  env: Record<string, string | undefined>,
): Promise<PostedCard> {
  const { card, thread } = buildPost(release);
  const token = env.SLACK_BOT_TOKEN;
  const channel = env.SLACK_RELEASE_CHANNEL;
  if (!token || !channel) {
    throw new Error("Set SLACK_BOT_TOKEN and SLACK_RELEASE_CHANNEL");
  }
  const posted = await slackApi(token, "chat.postMessage", {
    ...card,
    channel,
  });
  if (!posted.ts) {
    throw new Error("chat.postMessage answered without a ts");
  }
  const reply = thread
    ? await slackApi(token, "chat.postMessage", {
        channel,
        text: thread,
        thread_ts: posted.ts,
        unfurl_links: false,
        unfurl_media: false,
      })
    : undefined;
  return {
    channel: posted.channel ?? channel,
    release,
    threadTs: reply?.ts,
    ts: posted.ts,
  };
}

/**
 * The `chat.update` bodies that redraw a posted card and its thread reply for
 * the release's state, so publishing the notes also drops the reply's ask to
 * publish them.
 */
export function updateBodies(
  posted: PostedCard,
  { published, releaseUrl }: { published: boolean; releaseUrl?: string },
) {
  const release = {
    ...posted.release,
    published,
    releaseUrl: releaseUrl || posted.release.releaseUrl,
  };
  const { card, thread } = buildPost(release);
  return [
    {
      blocks: card.blocks,
      channel: posted.channel,
      text: card.text,
      ts: posted.ts,
    },
    ...(posted.threadTs && thread
      ? [{ channel: posted.channel, text: thread, ts: posted.threadTs }]
      : []),
  ];
}

async function slackApi(
  token: string,
  method: "chat.postMessage" | "chat.update",
  body: Record<string, unknown>,
) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    method: "POST",
  });
  // Slack's Web API answers with this shape for every method.
  const result = (await response.json()) as {
    channel?: string;
    error?: string;
    ok: boolean;
    ts?: string;
  };
  if (!result.ok) {
    throw new Error(`${method} failed: ${result.error ?? "unknown"}`);
  }
  return result;
}

/** `a`, `a and b`, `a, b, and c`. */
function listed(items: string[]) {
  return items.length < 3
    ? items.join(" and ")
    : `${items.slice(0, -1).join(", ")}, and ${items.slice(-1).join("")}`;
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
  if (command === "update") {
    const env: Record<string, string | undefined> = process.env;
    const token = env.SLACK_BOT_TOKEN;
    if (!token) {
      throw new Error("Set SLACK_BOT_TOKEN");
    }
    // The file `post --save` wrote, so this shape.
    const posted = JSON.parse(readArg(args, "--card")) as PostedCard;
    const bodies = updateBodies(posted, {
      published: readFlag(args, "--published") === "true",
      releaseUrl: readFlag(args, "--release-url"),
    });
    for (const body of bodies) {
      await slackApi(token, "chat.update", body);
    }
  } else if (command === "post" || command === "preview") {
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
      const posted = await post(release, process.env);
      const save = readFlag(args, "--save");
      if (save) {
        writeFileSync(save, JSON.stringify(posted));
      }
    }
  } else {
    console.error(
      "usage: release-summary.ts post|preview --tag <tag> --release-url <url> --notes <file> --commits <file> [--skills-commits <file>] [--mention <mrkdwn>] [--save <file>]\n       release-summary.ts update --card <file> --published true|false [--release-url <url>]",
    );
    process.exit(1);
  }
}
