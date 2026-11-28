// Says where CI stands on the branch a landing goes onto. scripts/land.sh
// prints it before its own checks and lands whatever it says: the landing
// session fixes a failure its branch touches and names the rest in its report.
//
//   node scripts/ci-state.ts <branch>
//
// The last finished run can be commits behind, since runs take minutes and a
// later push may have replaced one, so it says how far back that run is and
// what became of the newest push's. Without gh, the network or an answer
// within seconds it says so.
import { execFile, execFileSync } from "node:child_process";
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

/** GitHub keeps this many of a step's errors as annotations and drops the rest. */
const ANNOTATIONS_KEPT = 10;

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

export async function ciState({
  behind,
  branch,
  github,
  tip,
}: {
  /** How many commits the branch has past a run's, or undefined for one git lacks. */
  behind: (sha: string) => number | undefined;
  branch: string;
  github: GitHub;
  /** The newest commit pushed to the branch. */
  tip: string;
}): Promise<string[]> {
  const { workflow_runs } = (await github(
    `actions/workflows/ci.yml/runs?branch=${encodeURIComponent(branch)}&per_page=50`,
  )) as { workflow_runs: Run[] };
  // A fork's pull request can come from a branch of main's name.
  const runs = workflow_runs.filter(
    ({ conclusion, event }) =>
      conclusion !== "skipped" &&
      (event === "push" || (event === "pull_request" && branch !== "main")),
  );
  const last = runs.find(
    ({ conclusion, status }) =>
      status === "completed" &&
      ["failure", "startup_failure", "success", "timed_out"].includes(
        conclusion ?? "",
      ),
  );
  const lines: string[] = [];

  const newest = runs.find(({ head_sha }) => head_sha === tip);
  if (!newest) {
    lines.push(`the newest push (${tip.slice(0, 9)}) has no CI run`);
  } else if (newest.status !== "completed") {
    lines.push(`CI is still running on the newest push (${tip.slice(0, 9)})`);
  } else if (newest !== last) {
    lines.push(
      `CI on the newest push (${tip.slice(0, 9)}) was ${newest.conclusion ?? "left unfinished"}`,
    );
  }
  if (!last) {
    lines.push(`no finished CI run on ${branch}`);
    return lines;
  }

  const back = behind(last.head_sha);
  const where = `${last.head_sha.slice(0, 9)}, ${
    back === undefined
      ? "a commit not here"
      : back === 0
        ? "the newest push"
        : `${plural(back, "commit")} back`
  }`;
  const { failures, truncated } = await failuresOfRun(github, last);
  if (failures.length === 0 && last.conclusion === "success") {
    lines.push(`CI is green on ${branch} (${where})`);
    return lines;
  }
  lines.push(`CI is red on ${branch} (${where}): ${last.html_url}`);
  // A run whose failed jobs named nothing is still red.
  for (const failure of failures.length > 0
    ? failures
    : ["CI: the run itself"]) {
    lines.push(`  ${failure}`);
  }
  for (const family of truncated) {
    lines.push(
      `  ${family}: GitHub lists ${ANNOTATIONS_KEPT} errors a step, so more may be failing there`,
    );
  }
  return lines;
}

if (import.meta.main) {
  const [branch = "main"] = process.argv.slice(2);
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  const run = promisify(execFile);
  let lines: string[];
  try {
    lines = await ciState({
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
      github: async (pathname) =>
        JSON.parse(
          (
            await run("gh", ["api", `repos/{owner}/{repo}/${pathname}`], {
              maxBuffer: 1 << 28,
              timeout: 5000,
            })
          ).stdout,
        ) as unknown,
      tip: git("rev-parse", `refs/remotes/origin/${branch}`),
    });
  } catch (error) {
    const why = error instanceof Error ? error.message.split("\n")[0] : "";
    lines = [`could not read CI on ${branch} (${why ?? ""})`];
  }
  for (const line of lines) {
    console.log(line.startsWith("  ") ? line : `land: ${line}`);
  }
}
