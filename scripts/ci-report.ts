// Says what a CI run on main changed against the run before it, job by job:
// the tests that fail now and did not then, with the commits between the two
// runs, and the jobs green again. A run failing exactly as the one before it
// says nothing, so a red main reads as one report at the commit range that
// broke it rather than one per push. Writes the job summary, and posts to
// SLACK_CHANNEL as the bot SLACK_BOT_TOKEN names when both are set.
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

const before = new Map(
  (await jobsOf(previous.id)).map((job) => [job.name, job]),
);
const lines: string[] = [];
for (const job of await jobsOf(runId)) {
  const was = before.get(job.name);
  if (!was || was.conclusion === "cancelled" || job.conclusion === "cancelled")
    continue;
  const now = await failuresOf(job);
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
  } else if (job.conclusion === "success" && was.conclusion === "failure") {
    lines.push(`• <${job.html_url}|${job.name}> is green again`);
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
const slackToken = process.env.SLACK_BOT_TOKEN;
const slackChannel = process.env.SLACK_CHANNEL;
if (slackToken && slackChannel) {
  const posted = await fetch("https://slack.com/api/chat.postMessage", {
    body: JSON.stringify({
      channel: slackChannel,
      text,
      unfurl_links: false,
    }),
    headers: {
      authorization: `Bearer ${slackToken}`,
      "content-type": "application/json; charset=utf-8",
    },
    method: "POST",
  });
  // `as`: Slack's Web API answers untyped JSON; `ok` and `error` are all it promises.
  const answer = (await posted.json()) as { error?: string; ok: boolean };
  if (!answer.ok)
    throw new Error(`Slack refused the post: ${answer.error ?? "no reason"}`);
}
