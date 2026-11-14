// Says what a CI run on main changed against the run before it, job by job:
// the tests that fail now and did not then, with the commits between the two
// runs, and the jobs green again. A run failing exactly as the one before it
// says nothing, so a red main reads as one report at the commit range that
// broke it rather than one per push. Writes the job summary.
//
// When SLACK_CHANNEL and SLACK_BOT_TOKEN are both set, each breakage is one
// Slack card: posted when main turns red, edited in place as failures come
// and go, with each change as a reply in its thread, and shrunk to one green
// line once every job passes. The card's message metadata (`ci_breakage`)
// marks it open or fixed, which is how the next run finds it in the channel's
// history, so the bot needs `channels:history` as well as `chat:write`.
//
//   node scripts/ci-report.ts    in a job that runs after the others in its run
import { appendFileSync } from "node:fs";

type Run = {
  conclusion: null | string;
  created_at: string;
  head_sha: string;
  html_url: string;
  id: number;
};
type Commit = {
  author: null | { login: string };
  commit: { author: { name: string }; message: string };
  html_url: string;
  sha: string;
};
type Job = {
  conclusion: null | string;
  html_url: string;
  id: number;
  name: string;
  steps?: { conclusion: null | string; name: string }[];
};

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};
const repo = env("GITHUB_REPOSITORY");
const runId = Number(env("GITHUB_RUN_ID"));
const token = env("GITHUB_TOKEN");
const reportJob = process.env.GITHUB_JOB;

async function api(pathname: string): Promise<Response> {
  const response = await fetch(
    `https://api.github.com/repos/${repo}${pathname}`,
    {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
      },
    },
  );
  if (!response.ok) throw new Error(`${pathname}: ${response.status}`);
  return response;
}
// `as`: GitHub's REST answers are untyped JSON; the types name the fields read.
const json = async <T>(pathname: string) =>
  (await (await api(pathname)).json()) as T;

const jobsOf = async (run: number) =>
  (
    await json<{ jobs: Job[] }>(`/actions/runs/${run}/jobs?per_page=100`)
  ).jobs.filter((job) => job.name !== reportJob && job.name !== "Report");

/** What a failed job failed on: vitest's FAIL lines, else the steps that failed. */
async function failuresOf(job: Job): Promise<Set<string>> {
  if (job.conclusion !== "failure") return new Set();
  const log = await (await api(`/actions/jobs/${job.id}/logs`)).text();
  const failed = new Set<string>();
  for (const line of log.split("\n")) {
    const plain = line
      // oxlint-disable-next-line no-control-regex -- the ANSI colors vitest prints
      .replaceAll(/\u001B\[[0-9;]*m/g, "")
      .replace(/^\S+Z /, "");
    const [, file, test] =
      /^\s*FAIL\s+(?:(?:browser \(\w+\)|node|jsdom)\s+)?(\S+\.[cm]?[jt]sx?)(?: > (.+?))?\s*$/.exec(
        plain,
      ) ?? [];
    if (file) failed.add(test ? `${file} > ${test}` : file);
  }
  if (failed.size === 0) {
    for (const step of job.steps ?? []) {
      if (step.conclusion === "failure") failed.add(`step: ${step.name}`);
    }
  }
  return failed;
}

const current = await json<Run>(`/actions/runs/${runId}`);
const workflow = await json<{ workflow_runs: Run[] }>(
  `/actions/workflows/ci.yml/runs?branch=main&event=push&status=completed&per_page=20&created=<${current.created_at}`,
);
const previous = workflow.workflow_runs.find(
  (run) =>
    run.id !== runId &&
    run.created_at < current.created_at &&
    run.conclusion !== "cancelled",
);
if (!previous) {
  console.log("No earlier finished run on main to compare with.");
  process.exit(0);
}
// The run compared with, for the Slack card's functions below.
const lastRun: Run = previous;

const before = new Map(
  (await jobsOf(previous.id)).map((job) => [job.name, job]),
);
const lines: string[] = [];
/** Every job failing in this run, with everything it fails on. */
const failing: { failures: string[]; job: Job }[] = [];
/** What changed per job, for the card's thread. */
const changes: {
  added: string[];
  fixed: string[];
  job: Job;
  kind: "green" | "new" | "red";
}[] = [];
for (const job of await jobsOf(runId)) {
  const now = await failuresOf(job);
  if (job.conclusion === "failure") failing.push({ failures: [...now], job });
  const was = before.get(job.name);
  if (!was || was.conclusion === "cancelled" || job.conclusion === "cancelled")
    continue;
  const then = await failuresOf(was);
  const added = [...now].filter((name) => !then.has(name));
  if (job.conclusion === "failure" && added.length > 0) {
    // A few failures by name; more than that by file, with how many in each.
    const byFile = new Map<string, number>();
    for (const name of added) {
      const [file = name] = name.split(" > ");
      byFile.set(file, (byFile.get(file) ?? 0) + 1);
    }
    const entries =
      added.length <= 5
        ? added
        : [...byFile].map(([file, count]) =>
            count === 1 ? file : `${file} (${count})`,
          );
    const shown = entries.slice(0, 15).map((entry) => `    • ${entry}`);
    if (entries.length > shown.length)
      shown.push(`    • and ${entries.length - shown.length} more`);
    const verb =
      was.conclusion === "success"
        ? "turned red"
        : `has ${added.length} new failure${added.length === 1 ? "" : "s"}`;
    lines.push(`• <${job.html_url}|${job.name}> ${verb}:`, ...shown);
    changes.push({
      added,
      fixed: [],
      job,
      kind: was.conclusion === "success" ? "red" : "new",
    });
  } else if (job.conclusion === "success" && was.conclusion === "failure") {
    lines.push(`• <${job.html_url}|${job.name}> is green again`);
    changes.push({ added: [], fixed: [...then], job, kind: "green" });
  }
}

if (lines.length === 0) {
  console.log(`Nothing changed against ${previous.html_url}.`);
  process.exit(0);
}

const range = `${previous.head_sha.slice(0, 9)}...${current.head_sha.slice(0, 9)}`;
const text = [
  `*<${current.html_url}|CI on main>* changed since <https://github.com/${repo}/compare/${range}|${range}>`,
  ...lines,
].join("\n");
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);

/** The open card's metadata: what the breakage started from, and who. */
type Breakage = {
  /** First names of the authors of the commits that broke main. */
  authors: string;
  /** The last green run's commit. */
  base: string;
  /** Each job family that failed during the breakage, comma-separated. */
  jobs: string;
  repo: string;
  /** When the run that turned main red started. */
  since: string;
  state: "fixed" | "open";
};
type Rich =
  | { style?: { bold: true }; text: string; type: "text" }
  | { color: "green" | "red"; text: string; type: "tag" }
  | { text: string; type: "link"; url: string };
type Message = {
  metadata?: { event_payload?: unknown; event_type?: string };
  ts: string;
};

async function slack(bot: string, method: string, body: object) {
  const answer = await fetch(`https://slack.com/api/${method}`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${bot}`,
      "content-type": "application/json; charset=utf-8",
    },
    method: "POST",
  });
  // `as`: Slack's Web API answers untyped JSON; `ok` and `error` are all it promises.
  const parsed = (await answer.json()) as Record<string, unknown> & {
    error?: string;
    ok: boolean;
  };
  if (!parsed.ok)
    throw new Error(`Slack refused ${method}: ${parsed.error ?? "no reason"}`);
  return parsed;
}

/** The newest breakage card for this repo in the channel's last 30 days, if it is still open. */
async function openCard(bot: string, channel: string) {
  const oldest = Math.floor(Date.now() / 1000) - 30 * 86_400;
  const response = await fetch(
    `https://slack.com/api/conversations.history?${new URLSearchParams({
      channel,
      include_all_metadata: "true",
      limit: "200",
      oldest: String(oldest),
    })}`,
    { headers: { authorization: `Bearer ${bot}` } },
  );
  // `as`: Slack's Web API answers untyped JSON; these are the fields read.
  const answer = (await response.json()) as {
    error?: string;
    messages?: Message[];
    ok: boolean;
  };
  if (!answer.ok)
    throw new Error(
      `Slack refused conversations.history: ${answer.error ?? "no reason"}`,
    );
  for (const message of answer.messages ?? []) {
    if (message.metadata?.event_type !== "ci_breakage") continue;
    // `as`: this script wrote the payload, in the Breakage shape.
    const payload = message.metadata.event_payload as Breakage;
    if (payload.repo !== repo) continue;
    return payload.state === "open" ? { payload, ts: message.ts } : undefined;
  }
  return undefined;
}

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;
const listed = (items: string[]) =>
  items.length <= 2
    ? items.join(" and ")
    : `${items.slice(0, -1).join(", ")}, and ${items.at(-1) ?? ""}`;
/** "Tests (Linux 2/4)" and its shards are all "Tests". */
const family = (name: string) => name.replace(/\s*\(.*\)$/, "");
const line = (...elements: Rich[]) => ({
  elements: [{ elements, type: "rich_text_section" }],
  type: "rich_text",
});
const bullets = (items: string[], indent = 0) => ({
  elements: items.map((item) => ({
    elements: [{ text: item, type: "text" }],
    type: "rich_text_section",
  })),
  indent,
  style: "bullet",
  type: "rich_text_list",
});
const capped = (items: string[], max: number) =>
  items.length > max
    ? [...items.slice(0, max), `and ${items.length - max} more`]
    : items;

/** The commits between two shas, oldest first. */
async function commitsBetween(base: string, head: string) {
  return (await json<{ commits: Commit[] }>(`/compare/${base}...${head}`))
    .commits;
}
const authorsOf = (commits: Commit[]) => [
  ...new Set(
    commits.map(
      (commit) =>
        commit.commit.author.name.split(" ")[0] ?? commit.author?.login ?? "",
    ),
  ),
];
const pushedBy = (authors: string[]) =>
  authors.length === 0
    ? "the last green run"
    : authors.length === 1
      ? `${authors[0] ?? ""}'s push`
      : `pushes by ${listed(authors.length > 3 ? [...authors.slice(0, 3), "others"] : authors)}`;
const subjectOf = (commit: Commit) =>
  commit.commit.message.split("\n")[0] ?? "";

/** The card for main while it is red: what fails, since whose push, and links to the run and the commits. */
function breakageCard(breakage: Breakage) {
  const all = failing.flatMap(({ failures }) => failures);
  const tests = all.filter((name) => !name.startsWith("step: "));
  const jobs = failing.map(({ job }) => job.name);
  const sentence =
    tests.length > 0
      ? `${tests.length === 1 ? "A test fails" : `${tests.length} tests fail`} on main since ${pushedBy(breakage.authors ? breakage.authors.split(",") : [])}.`
      : `${listed(jobs)} ${jobs.length === 1 ? "fails" : "fail"} on main since ${pushedBy(breakage.authors ? breakage.authors.split(",") : [])}.`;
  const files = new Set(tests.map((name) => name.split(" > ")[0]));
  const subtitle =
    tests.length > 0
      ? files.size === 1
        ? `${tests.length} in ${[...files][0]?.split("/").at(-1) ?? ""}`
        : `${tests.length} in ${files.size} files`
      : plural(all.length, "failed step", "failed steps");
  const compare = `https://github.com/${repo}/compare/${breakage.base.slice(0, 9)}...${current.head_sha.slice(0, 9)}`;
  return {
    blocks: [
      line(
        { color: "red", text: "Failing", type: "tag" },
        { text: " ", type: "text" },
        { style: { bold: true }, text: sentence, type: "text" },
      ),
      {
        elements: [
          {
            text: failing
              .map(({ job }) => `<${job.html_url}|${job.name}>`)
              .join(" · "),
            type: "mrkdwn",
          },
        ],
        type: "context",
      },
      {
        child_blocks: [
          {
            elements: [
              bullets(
                capped(
                  all.map((name) =>
                    name.replace(/^step: /, "Step: ").replaceAll(" > ", " › "),
                  ),
                  40,
                ),
              ),
            ],
            type: "rich_text",
          },
        ],
        default_collapsed: true,
        is_collapsible: true,
        subtitle: { text: subtitle, type: "plain_text" },
        title: {
          text: tests.length > 0 ? "Failing tests" : "Failing steps",
          type: "plain_text",
        },
        type: "container",
      },
      {
        elements: [
          {
            text: { text: "Open the run", type: "plain_text" },
            type: "button",
            url: current.html_url,
          },
          {
            text: { text: "Compare commits", type: "plain_text" },
            type: "button",
            url: compare,
          },
        ],
        type: "actions",
      },
    ],
    text: sentence,
  };
}

/** The card once every job passes again: one green line. */
function fixedLine(breakage: Breakage) {
  const minutes = Math.max(
    1,
    Math.round(
      (Date.parse(current.created_at) - Date.parse(breakage.since)) / 60_000,
    ),
  );
  const how =
    minutes < 90
      ? plural(minutes, "minute", "minutes")
      : minutes < 48 * 60
        ? plural(Math.round(minutes / 60), "hour", "hours")
        : plural(Math.round(minutes / 1440), "day", "days");
  const sentence = `${listed(breakage.jobs.split(","))} failed on main for ${how}.`;
  return {
    blocks: [
      line(
        { color: "green", text: "Fixed", type: "tag" },
        { text: ` ${sentence}`, type: "text" },
      ),
    ],
    text: `Fixed: ${sentence}`,
  };
}

/** The thread reply for one run's changes to an open card. */
function changeReply(commits: Commit[], fixedAll: boolean) {
  const elements: object[] = [];
  if (fixedAll) {
    const [only] = commits;
    elements.push({
      elements: [
        {
          text: `${pushedBy(authorsOf(commits)).replace(/^./, (c) => c.toUpperCase())} fixed it`,
          type: "text",
        },
        ...(commits.length === 1 && only
          ? [
              { text: ": ", type: "text" },
              { text: subjectOf(only), type: "link", url: only.html_url },
              { text: ".", type: "text" },
            ]
          : [{ text: ".", type: "text" }]),
      ],
      type: "rich_text_section",
    });
    if (commits.length > 1)
      elements.push(bullets(capped(commits.map(subjectOf), 10)));
  }
  for (const change of changes) {
    if (fixedAll && change.kind === "green") continue;
    elements.push({
      elements: [
        {
          text:
            change.kind === "green"
              ? `${change.job.name} is green again.`
              : change.kind === "red"
                ? `${change.job.name} turned red.`
                : `${change.job.name} has ${plural(change.added.length, "new failure", "new failures")}.`,
          type: "text",
        },
      ],
      type: "rich_text_section",
    });
    if (change.added.length > 0)
      elements.push(
        bullets(
          capped(
            change.added.map((name) => name.replaceAll(" > ", " › ")),
            15,
          ),
        ),
      );
  }
  const fixed = changes.flatMap((change) => change.fixed);
  const blocks: object[] = [{ elements, type: "rich_text" }];
  if (fixedAll && fixed.length > 0)
    blocks.push({
      child_blocks: [
        {
          elements: [
            bullets(
              capped(
                fixed.map((name) =>
                  name.replace(/^step: /, "Step: ").replaceAll(" > ", " › "),
                ),
                40,
              ),
            ),
          ],
          type: "rich_text",
        },
      ],
      default_collapsed: true,
      is_collapsible: true,
      title: { text: "What was failing", type: "plain_text" },
      type: "container",
    });
  return {
    blocks,
    text: fixedAll ? "Main is green again" : "What changed on main",
  };
}

async function reportToSlack(bot: string, channel: string) {
  const open = await openCard(bot, channel);
  const metadata = (payload: Breakage) => ({
    event_payload: payload,
    event_type: "ci_breakage",
  });
  if (!open) {
    // Only a run that turns something red starts a card.
    if (!changes.some((change) => change.kind !== "green")) return;
    const breakage: Breakage = {
      authors: authorsOf(
        await commitsBetween(lastRun.head_sha, current.head_sha),
      ).join(","),
      base: lastRun.head_sha,
      jobs: [...new Set(failing.map(({ job }) => family(job.name)))].join(","),
      repo,
      since: current.created_at,
      state: "open",
    };
    await slack(bot, "chat.postMessage", {
      ...breakageCard(breakage),
      channel,
      metadata: metadata(breakage),
      unfurl_links: false,
      unfurl_media: false,
    });
    return;
  }
  const fixedAll = failing.length === 0;
  const breakage: Breakage = {
    ...open.payload,
    jobs: [
      ...new Set([
        ...open.payload.jobs.split(","),
        ...failing.map(({ job }) => family(job.name)),
      ]),
    ].join(","),
    state: fixedAll ? "fixed" : "open",
  };
  await slack(bot, "chat.update", {
    ...(fixedAll ? fixedLine(breakage) : breakageCard(breakage)),
    channel,
    metadata: metadata(breakage),
    ts: open.ts,
  });
  await slack(bot, "chat.postMessage", {
    ...changeReply(
      fixedAll ? await commitsBetween(lastRun.head_sha, current.head_sha) : [],
      fixedAll,
    ),
    channel,
    thread_ts: open.ts,
    unfurl_links: false,
    unfurl_media: false,
  });
}

const slackToken = process.env.SLACK_BOT_TOKEN;
const slackChannel = process.env.SLACK_CHANNEL;
if (slackToken && slackChannel) await reportToSlack(slackToken, slackChannel);
