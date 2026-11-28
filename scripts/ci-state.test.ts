import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ciState } from "./ci-state.ts";

const TIP = "tip0000000";

type State = Parameters<typeof ciState>[0];
/** A run by what its jobs say went wrong: one entry per annotation. */
type FakeRun = {
  conclusion?: null | string;
  event?: string;
  jobs?: Record<string, { message?: string; path: string; title?: string }[]>;
  sha: string;
  status?: string;
};

const windows = {
  "Tests (Windows 3/4)": [
    { message: "Process completed with exit code 1.", path: ".github" },
    {
      path: "packages/workspace/src/test/setup.ts",
      title: "src/lib/script.test.ts > a script > stops",
    },
    {
      message:
        "command (D:\\a\\packages\\workspace) pnpm.CMD run test:ci --shard=3/4 exited (1)",
      path: ".github",
    },
  ],
};

/** GitHub's answers, in the shapes `gh api` gives them, for runs newest first. */
function github(runs: FakeRun[]) {
  return (pathname: string): Promise<unknown> => {
    const answer = (value: unknown) => Promise.resolve(value);
    if (pathname.startsWith("actions/workflows/ci.yml/runs?")) {
      return answer({
        workflow_runs: runs.map((run, id) => ({
          conclusion:
            run.conclusion === undefined
              ? run.jobs
                ? "failure"
                : "success"
              : run.conclusion,
          event: run.event ?? "push",
          head_sha: run.sha,
          html_url: `https://ci/${id}`,
          id,
          status: run.status ?? "completed",
        })),
      });
    }
    const jobs = /^actions\/runs\/(\d+)\/jobs/.exec(pathname);
    if (jobs) {
      const id = Number(jobs[1]);
      return answer({
        jobs: Object.keys(runs[id]?.jobs ?? {}).map((name, index) => ({
          conclusion: "failure",
          id: id * 100 + index,
          name,
          steps: [
            { conclusion: "success", name: "Set up job" },
            { conclusion: "failure", name: "Install Chromium" },
          ],
        })),
      });
    }
    const notes = /^check-runs\/(\d+)\/annotations/.exec(pathname);
    if (notes) {
      const id = Number(notes[1]);
      return answer(
        Object.values(runs[Math.floor(id / 100)]?.jobs ?? {})[id % 100]?.map(
          (each) => ({
            annotation_level: "failure",
            message: "",
            title: null,
            ...each,
          }),
        ),
      );
    }
    throw new Error(`no answer for ${pathname}`);
  };
}

const state = (runs: FakeRun[], given: Partial<State> = {}) =>
  ciState({
    behind: (sha) => (sha === TIP ? 0 : 3),
    branch: "topic",
    github: github(runs),
    tip: TIP,
    ...given,
  });

describe("ciState", () => {
  it("says a green branch is green", async () => {
    expect(await state([{ sha: TIP }])).toEqual([
      "CI is green on topic (tip000000, the newest push)",
    ]);
  });

  it("names what a red run failed on, past canceled runs", async () => {
    expect(
      await state([
        { conclusion: "cancelled", sha: "canceled00" },
        { jobs: windows, sha: "older00000" },
      ]),
    ).toMatchInlineSnapshot(`
      [
        "the newest push (tip000000) has no CI run",
        "CI is red on topic (older0000, 3 commits back): https://ci/1",
        "  Tests (Windows): packages/workspace/src/lib/script.test.ts",
      ]
    `);
  });

  it("names a failed step when a job left no test or task", async () => {
    expect(await state([{ jobs: { "Browser Tests": [] }, sha: TIP }]))
      .toMatchInlineSnapshot(`
      [
        "CI is red on topic (tip000000, the newest push): https://ci/0",
        "  Browser Tests: Install Chromium",
      ]
    `);
  });

  it("says a run that failed without naming a job is red", async () => {
    expect(await state([{ conclusion: "startup_failure", sha: TIP }]))
      .toMatchInlineSnapshot(`
      [
        "CI is red on topic (tip000000, the newest push): https://ci/0",
        "  CI: the run itself",
      ]
    `);
  });

  it("says GitHub may have cut a step's errors short", async () => {
    const many = Array.from({ length: 10 }, (_, index) => ({
      path: `apps/studio/src/a${index.toString()}.test.ts`,
    }));
    const lines = await state([
      { jobs: { "Tests (Linux 1/4)": many }, sha: TIP },
    ]);
    expect(lines.at(-1)).toBe(
      "  Tests (Linux): GitHub lists 10 errors a step, so more may be failing there",
    );
  });

  it.each<[string, FakeRun[]]>([
    [
      "CI is still running on the newest push (tip000000)",
      [{ conclusion: null, sha: TIP, status: "in_progress" }],
    ],
    [
      "CI on the newest push (tip000000) was cancelled",
      [{ conclusion: "cancelled", sha: TIP }],
    ],
    ["the newest push (tip000000) has no CI run", []],
    // A pull request's run that skipped every job.
    [
      "the newest push (tip000000) has no CI run",
      [{ conclusion: "skipped", event: "pull_request", sha: TIP }],
    ],
  ])("opens with %s", async (first, newest) => {
    expect(await state([...newest, { sha: "older00000" }])).toEqual([
      first,
      "CI is green on topic (older0000, 3 commits back)",
    ]);
  });

  it("counts no pull request's run on main", async () => {
    const lines = await state(
      [{ event: "pull_request", jobs: windows, sha: TIP }],
      { branch: "main" },
    );
    expect(lines.at(-1)).toBe("no finished CI run on main");
  });
});

it("says so, and exits 0, when CI cannot be read", () => {
  // execFileSync throws on any exit code but 0.
  expect(
    execFileSync(
      process.execPath,
      [path.join(import.meta.dirname, "ci-state.ts"), "no-such-branch"],
      { encoding: "utf8" },
    ),
  ).toContain("land: could not read CI on no-such-branch");
});
