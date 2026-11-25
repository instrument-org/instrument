// Says where CI stands on the branch a landing goes onto, and refuses a landing
// onto a branch that stays red. scripts/land.sh runs it before its own checks.
//
//   node scripts/ci-state.ts <branch> [--onto-red <reason>]
//
// The verdict is the last finished CI run, which can be commits behind: runs
// take minutes and a later push may have replaced one, so it says how far back
// that run is and what became of the newest push's.
//
// A failure refuses the landing only when the last two finished runs both have
// it. One that the last run alone has is printed with the commits that may have
// broken it, since a flaky test looks the same once and a false refusal holds
// up every session landing on the branch. It also passes when
//
// - a commit since that run, on the branch or being landed, says it fixes it
//   (a `Fixes-CI: <failure>` trailer) or changes the failing test file. The
//   claim holds only until a run that has the commit finishes: a failure still
//   there is then newer than the claim.
// - scripts/ci-known-failures.json lists it with a date that has not passed.
//   An entry is a commit like any other, so one landing lets everyone else
//   through, and the date is at most two weeks out.
// - the run is too far behind to say anything about what the branch is now.
// - `--onto-red <reason>` says why to land anyway, which is printed.
//
// Without gh, the network or an answer within seconds it warns and lets the
// landing go on. Exit code 3 is a refusal; anything else lands.
import { execFile, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

/** GitHub's answer to a GET of this path under the repo. */
type GitHub = (pathname: string) => Promise<unknown>;
type Run = {
  conclusion: null | string;
  event: string;
  head_sha: string;
  html_url: string;
  id: number;
  status: string;
};
type Job = {
  conclusion: null | string;
  id: number;
  name: string;
  steps?: { conclusion: null | string; name: string }[];
};
type Annotation = {
  annotation_level: string;
  message: string;
  path: string;
  title: null | string;
};
type Commit = { body: string; files: string[]; sha: string; subject: string };
export type KnownFailure = { expires: string; failure: string; why: string };

/** Commits behind which a run says too little about the branch to refuse over. */
const TOO_FAR_BEHIND = 40;
const KNOWN_FAILURE_DAYS = 14;
/** GitHub keeps this many of a step's errors as annotations and drops the rest. */
const ANNOTATIONS_KEPT = 10;

const day = (date: Date) => date.toISOString().slice(0, 10);
const plural = (count: number, one: string) =>
  `${count} ${one}${count === 1 ? "" : "s"}`;

/** A job's name without its shard, which tests move between. */
const jobFamily = (name: string) => name.replace(/ \d+\/\d+\)$/, ")");

/** What a failed job failed on: test files, Turbo tasks, or the steps themselves. */
async function failuresOf(github: GitHub, job: Job) {
  // `as`: GitHub's REST answers are untyped JSON; the types name the fields read.
  const annotations = (
    (await github(
      `check-runs/${job.id}/annotations?per_page=100`,
    )) as Annotation[]
  ).filter(({ annotation_level }) => annotation_level === "failure");
  const names = new Set<string>();
  const tasks = new Set<string>();
  for (const annotation of annotations) {
    const task = / run ([\w:-]+)(?: .*)? exited \(\d+\)/.exec(
      annotation.message,
    );
    if (task?.[1]) {
      tasks.add(task[1]);
    } else if (annotation.path !== ".github") {
      // The test file a title opens with, over the annotated line's own file,
      // which is a helper's when the test failed inside one. A title's path
      // starts at the package, so the package comes from the annotated path.
      const test = /(?:^|\s)(\S+\.test\.[cm]?[jt]sx?)(?:\s|$)/.exec(
        annotation.title ?? "",
      )?.[1];
      const owner = /^(.*?\/)?src\//.exec(annotation.path)?.[1] ?? "";
      names.add(test ? owner + test : annotation.path);
    }
  }
  if (names.size === 0) {
    for (const task of tasks) {
      names.add(task);
    }
  }
  if (names.size === 0) {
    for (const step of job.steps ?? []) {
      if (step.conclusion === "failure") {
        names.add(step.name);
      }
    }
  }
  return {
    failures: [...names].map((name) => `${jobFamily(job.name)}: ${name}`),
    truncated: annotations.length >= ANNOTATIONS_KEPT,
  };
}

async function failuresOfRun(github: GitHub, run: Run) {
  if (run.conclusion === "success") {
    return { failures: [], truncated: [] };
  }
  const { jobs } = (await github(
    `actions/runs/${run.id}/jobs?per_page=100`,
  )) as {
    jobs: Job[];
  };
  const failed = jobs.filter(
    ({ conclusion }) => conclusion === "failure" || conclusion === "timed_out",
  );
  const found = await Promise.all(
    failed.map(async (job) => ({
      family: jobFamily(job.name),
      ...(await failuresOf(github, job)),
    })),
  );
  return {
    failures: [...new Set(found.flatMap(({ failures }) => failures))].sort(),
    truncated: found.flatMap(({ family, truncated }) =>
      truncated ? [family] : [],
    ),
  };
}

/** The name within a failure, after its job: a test file, a task or a step. */
const nameIn = (failure: string) => failure.slice(failure.indexOf(": ") + 2);

const FIXES = /^Fixes-CI: (.+)$/gm;

/** Whether a commit says it fixes a failure, or changes the test that fails. */
function claims(commit: Commit, failure: string) {
  const name = nameIn(failure);
  return (
    commit.files.includes(name) ||
    [...commit.body.matchAll(FIXES)].some(([, claimed = ""]) =>
      [failure, name].includes(claimed.trim()),
    )
  );
}

export async function ciState({
  behind,
  branch,
  commitsSince,
  github,
  known,
  now,
  override,
  tip,
}: {
  /** How many commits the branch has past a run's, or undefined for one git lacks. */
  behind: (sha: string) => number | undefined;
  branch: string;
  /** The commits from a run's to what is being landed, the branch's own included. */
  commitsSince: (sha: string) => Commit[];
  github: GitHub;
  known: KnownFailure[];
  now: Date;
  override: string | undefined;
  /** The newest commit pushed to the branch. */
  tip: string;
}): Promise<{ lines: string[]; refuse: boolean }> {
  const { workflow_runs } = (await github(
    `actions/workflows/ci.yml/runs?branch=${encodeURIComponent(branch)}&per_page=50`,
  )) as { workflow_runs: Run[] };
  // A fork's pull request can come from a branch of main's name.
  const runs = workflow_runs.filter(
    ({ conclusion, event }) =>
      conclusion !== "skipped" &&
      (event === "push" || (event === "pull_request" && branch !== "main")),
  );
  const finished = runs.filter(
    ({ conclusion, status }) =>
      status === "completed" &&
      ["failure", "startup_failure", "success", "timed_out"].includes(
        conclusion ?? "",
      ),
  );
  const [last, before] = finished;
  const lines: string[] = [];

  const newest = runs.find(({ head_sha }) => head_sha === tip);
  if (!newest) {
    const pulls = (await github(
      `pulls?state=open&per_page=1&head={owner}:${encodeURIComponent(branch)}`,
    )) as { number: number }[];
    const pull = pulls[0]
      ? ((await github(`pulls/${pulls[0].number}`)) as {
          mergeable: boolean | null;
          number: number;
        })
      : undefined;
    lines.push(
      pull?.mergeable === false
        ? `the newest push (${tip.slice(0, 9)}) has no CI run: pull request #${pull.number} conflicts with its base, so GitHub runs none for it`
        : `the newest push (${tip.slice(0, 9)}) has no CI run`,
    );
  } else if (newest.status !== "completed") {
    lines.push(`CI is still running on the newest push (${tip.slice(0, 9)})`);
  } else if (newest !== last) {
    lines.push(
      `CI on the newest push (${tip.slice(0, 9)}) was ${newest.conclusion ?? "left unfinished"}`,
    );
  }
  if (!last) {
    lines.push(`no finished CI run on ${branch}`);
    return { lines, refuse: false };
  }

  const back = behind(last.head_sha);
  const where = `${last.head_sha.slice(0, 9)}, ${
    back === undefined
      ? "a commit not here"
      : back === 0
        ? "the newest push"
        : `${plural(back, "commit")} back`
  }`;
  const [current, previous] = await Promise.all([
    failuresOfRun(github, last),
    before ? failuresOfRun(github, before) : undefined,
  ]);

  const today = day(now);
  const latest = day(
    new Date(now.getTime() + KNOWN_FAILURE_DAYS * 24 * 60 * 60 * 1000),
  );
  const live = new Map<string, KnownFailure>();
  for (const entry of known) {
    if (entry.expires < today || entry.expires > latest) {
      lines.push(
        `known failure ${entry.failure} ${entry.expires < today ? `expired on ${entry.expires}` : `expires on ${entry.expires}, past the ${KNOWN_FAILURE_DAYS} days allowed`}, so it no longer counts`,
      );
    } else {
      live.set(entry.failure, entry);
    }
    if (!current.failures.includes(entry.failure)) {
      lines.push(
        `known failure ${entry.failure} did not fail in the last run; take it out once it stays that way`,
      );
    }
  }

  if (current.failures.length === 0 && last.conclusion === "success") {
    lines.push(`CI is green on ${branch} (${where})`);
    return { lines, refuse: false };
  }

  lines.push(`CI is red on ${branch} (${where}): ${last.html_url}`);
  // A run whose failed jobs named nothing is still red.
  const failures =
    current.failures.length > 0 ? current.failures : ["CI: the run itself"];
  const wasRed = new Set(
    previous &&
      previous.failures.length === 0 &&
      before?.conclusion !== "success"
      ? ["CI: the run itself"]
      : previous?.failures,
  );
  const since = back === undefined ? [] : commitsSince(last.head_sha);
  const unanswered: string[] = [];
  for (const failure of failures) {
    const entry = live.get(failure);
    const claim = since.find((commit) => claims(commit, failure));
    let note: string;
    if (entry) {
      note = `known until ${entry.expires}: ${entry.why}`;
    } else if (claim) {
      note = `fix claimed by ${claim.sha.slice(0, 9)} ${claim.subject}, and no finished run has it`;
    } else if (wasRed.has(failure)) {
      note = "in the run before it too";
      unanswered.push(failure);
    } else {
      note = before
        ? `new in this run, so broken by ${before.head_sha.slice(0, 9)}..${last.head_sha.slice(0, 9)} or flaky`
        : "new in this run";
    }
    lines.push(`  ${failure}\n    ${note}`);
  }
  for (const family of current.truncated) {
    lines.push(
      `  ${family}: GitHub lists ${ANNOTATIONS_KEPT} errors a step, so more may be failing there`,
    );
  }
  if (unanswered.length === 0) {
    return { lines, refuse: false };
  }
  if (override !== undefined) {
    lines.push(
      `LANDING ONTO RED: ${plural(unanswered.length, "failure")} nobody has answered, landed anyway because: ${override}`,
    );
    return { lines, refuse: false };
  }
  if (back === undefined || back > TOO_FAR_BEHIND) {
    lines.push(
      "that run is too far behind to refuse over; get CI running on the branch",
    );
    return { lines, refuse: false };
  }
  lines.push(
    `${branch} has been red for two finished runs, and this branch does not say it fixes it. One of:`,
    "  - fix it here, with a `Fixes-CI: <failure>` trailer on the commit that does, copied from above",
    `  - add it to scripts/ci-known-failures.json with why and a date within ${KNOWN_FAILURE_DAYS} days, which lets every later landing through too`,
    '  - rerun with --onto-red "<why this cannot wait>"',
  );
  return { lines, refuse: true };
}

if (import.meta.main) {
  const [branch = "main", flag, reason] = process.argv.slice(2);
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      encoding: "utf8",
      maxBuffer: 1 << 28,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  const run = promisify(execFile);
  const root = path.join(import.meta.dirname, "..");
  const say = (lines: string[]) => {
    for (const line of lines) {
      console.log(line.startsWith("  ") ? line : `land: ${line}`);
    }
  };
  try {
    const { lines, refuse } = await ciState({
      behind: (sha) => {
        try {
          return Number(
            git("rev-list", "--count", `${sha}..refs/remotes/origin/${branch}`),
          );
        } catch {
          return undefined;
        }
      },
      branch,
      commitsSince: (sha) =>
        git(
          "log",
          "--no-merges",
          "--name-only",
          "--format=%x1e%H%x1f%s%x1f%B%x1f",
          `${sha}..HEAD`,
        )
          .split("\u001e")
          .filter(Boolean)
          .map((entry) => {
            const [commit = "", subject = "", body = "", files = ""] =
              entry.split("\u001f");
            return {
              body,
              files: files.trim().split("\n"),
              sha: commit,
              subject,
            };
          }),
      github: async (pathname) =>
        JSON.parse(
          (
            await run("gh", ["api", `repos/{owner}/{repo}/${pathname}`], {
              maxBuffer: 1 << 28,
              timeout: 5000,
            })
          ).stdout,
        ) as unknown,
      // `as`: the file is this repo's own, in the shape its entries show.
      known: JSON.parse(
        readFileSync(path.join(root, "scripts/ci-known-failures.json"), "utf8"),
      ) as KnownFailure[],
      now: new Date(),
      override: flag === "--onto-red" ? reason : undefined,
      tip: git("rev-parse", `refs/remotes/origin/${branch}`),
    });
    say(lines);
    process.exitCode = refuse ? 3 : 0;
  } catch (error) {
    const why = error instanceof Error ? error.message.split("\n")[0] : "";
    say([
      `WARNING: could not read CI on ${branch} (${why ?? ""}), so nothing here says whether it is red`,
    ]);
  }
}
