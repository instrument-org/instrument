import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ciState } from "./ci-state.ts";

const TIP = "tip0000000";
const WINDOWS_TEST = "packages/workspace/src/lib/script.test.ts";
const WINDOWS_FAILURE = `Tests (Windows): ${WINDOWS_TEST}`;

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
function github(runs: FakeRun[], pull?: { mergeable: boolean }) {
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
    if (pathname.startsWith("pulls?")) {
      return answer(pull ? [{ number: 208 }] : []);
    }
    if (pathname === "pulls/208") {
      return answer({ ...pull, number: 208 });
    }
    throw new Error(`no answer for ${pathname}`);
  };
}

const state = (runs: FakeRun[], given: Partial<State> = {}) =>
  ciState({
    behind: (sha) => (sha === TIP ? 0 : 3),
    branch: "topic",
    commitsSince: () => [],
    github: github(runs),
    known: [],
    now: new Date("2026-11-25T12:00:00Z"),
    override: undefined,
    tip: TIP,
    ...given,
  });

const red: FakeRun[] = [
  { jobs: windows, sha: TIP },
  { jobs: windows, sha: "older00000" },
];

describe("ciState", () => {
  it("says a green branch is green", async () => {
    expect(await state([{ sha: TIP }])).toMatchInlineSnapshot(`
      {
        "lines": [
          "CI is green on topic (tip000000, the newest push)",
        ],
        "refuse": false,
      }
    `);
  });

  it("refuses a failure the last two finished runs both have, over canceled ones", async () => {
    expect(
      await state([
        { conclusion: "cancelled", sha: "canceled00" },
        { jobs: windows, sha: TIP },
        { conclusion: "cancelled", sha: "canceled01" },
        { jobs: windows, sha: "older00000" },
      ]),
    ).toMatchInlineSnapshot(`
      {
        "lines": [
          "CI is red on topic (tip000000, the newest push): https://ci/1",
          "  Tests (Windows): packages/workspace/src/lib/script.test.ts
          in the run before it too",
          "topic has been red for two finished runs, and this branch does not say it fixes it. One of:",
          "  - fix it here, with a \`Fixes-CI: <failure>\` trailer on the commit that does, copied from above",
          "  - add it to scripts/ci-known-failures.json with why and a date within 14 days, which lets every later landing through too",
          "  - rerun with --onto-red "<why this cannot wait>"",
        ],
        "refuse": true,
      }
    `);
  });

  it("finds the same failure in another shard", async () => {
    const moved = { "Tests (Windows 1/4)": windows["Tests (Windows 3/4)"] };
    const { refuse } = await state([
      { jobs: windows, sha: TIP },
      { jobs: moved, sha: "older00000" },
    ]);
    expect(refuse).toBe(true);
  });

  it("only warns of a failure the last run alone has", async () => {
    const { lines, refuse } = await state([
      { jobs: windows, sha: TIP },
      { sha: "older00000" },
    ]);
    expect(refuse).toBe(false);
    expect(lines.join("\n")).toContain(
      "new in this run, so broken by older0000..tip000000 or flaky",
    );
  });

  it.each([
    ["the failure in full", `Fixes-CI: ${WINDOWS_FAILURE}`, [], false],
    ["the test alone", `Fixes-CI: ${WINDOWS_TEST}`, [], false],
    ["by changing the test", "", [WINDOWS_TEST], false],
    ["another failure", "Fixes-CI: Check: check:unused", [], true],
    ["it only in prose", `so Fixes-CI: ${WINDOWS_TEST}`, [], true],
  ])("takes a claim naming %s", async (_, body, files, refused) => {
    const { refuse } = await state(red, {
      commitsSince: () => [
        {
          body: `dx: a fix\n\n${body}`,
          files,
          sha: "fix",
          subject: "dx: a fix",
        },
      ],
    });
    expect(refuse).toBe(refused);
  });

  it("drops a claim once a finished run has its commit", async () => {
    const asked: string[] = [];
    const { refuse } = await state(red, {
      commitsSince: (sha) => {
        asked.push(sha);
        return [];
      },
    });
    expect(asked).toEqual([TIP]);
    expect(refuse).toBe(true);
  });

  it.each([
    ["2026-11-25", false],
    ["2026-12-09", false],
    ["2026-11-24", true],
    ["2026-12-10", true],
  ])("counts a known failure that expires on %s", async (expires, refused) => {
    const { refuse } = await state(red, {
      known: [{ expires, failure: WINDOWS_FAILURE, why: "a slow runner" }],
    });
    expect(refuse).toBe(refused);
  });

  it("refuses a failure beside a known one", async () => {
    const jobs = {
      ...windows,
      "Browser Tests": [{ message: "exit code 1.", path: ".github" }],
      Check: [
        {
          message: "command (/repo/) pnpm run check:unused exited (1)",
          path: ".github",
        },
      ],
    };
    const { lines, refuse } = await state(
      [
        { jobs, sha: TIP },
        { jobs, sha: "older00000" },
      ],
      {
        known: [
          { expires: "2026-12-01", failure: WINDOWS_FAILURE, why: "slow" },
        ],
      },
    );
    expect(refuse).toBe(true);
    expect(lines.filter((line) => line.startsWith("  ") && line.includes("\n")))
      .toMatchInlineSnapshot(`
      [
        "  Browser Tests: Install Chromium
          in the run before it too",
        "  Check: check:unused
          in the run before it too",
        "  Tests (Windows): packages/workspace/src/lib/script.test.ts
          known until 2026-12-01: slow",
      ]
    `);
  });

  it("refuses a run that failed without naming a job", async () => {
    const { refuse } = await state([
      { conclusion: "startup_failure", sha: TIP },
      { conclusion: "startup_failure", sha: "older00000" },
    ]);
    expect(refuse).toBe(true);
  });

  it("lands anyway with a reason, and prints it", async () => {
    const { lines, refuse } = await state(red, { override: "release blocker" });
    expect(refuse).toBe(false);
    expect(lines.at(-1)).toBe(
      "LANDING ONTO RED: 1 failure nobody has answered, landed anyway because: release blocker",
    );
  });

  it.each([41, undefined])(
    "does not refuse over a run %s commits back",
    async (commits) => {
      const { refuse } = await state(red, { behind: () => commits });
      expect(refuse).toBe(false);
    },
  );

  it.each<[string, FakeRun[], { mergeable: boolean }?]>([
    [
      "CI is still running on the newest push (tip000000)",
      [{ conclusion: null, sha: TIP, status: "in_progress" }],
    ],
    [
      "CI on the newest push (tip000000) was cancelled",
      [{ conclusion: "cancelled", sha: TIP }],
    ],
    [
      "the newest push (tip000000) has no CI run: pull request #208 conflicts with its base, so GitHub runs none for it",
      [],
      { mergeable: false },
    ],
    ["the newest push (tip000000) has no CI run", [], { mergeable: true }],
    ["the newest push (tip000000) has no CI run", []],
    // A pull request's run that skipped every job.
    [
      "the newest push (tip000000) has no CI run",
      [{ conclusion: "skipped", event: "pull_request", sha: TIP }],
    ],
  ])("opens with %s", async (first, newest, pull) => {
    const { lines } = await state([], {
      github: github([...newest, { sha: "older00000" }], pull),
    });
    expect(lines).toEqual([
      first,
      "CI is green on topic (older0000, 3 commits back)",
    ]);
  });

  it("counts no pull request's run on main", async () => {
    const { lines } = await state(
      [{ event: "pull_request", jobs: windows, sha: TIP }],
      { branch: "main" },
    );
    expect(lines.at(-1)).toBe("no finished CI run on main");
  });
});

it("warns and lets the landing go on when CI cannot be read", () => {
  // execFileSync throws on any exit code but 0.
  expect(
    execFileSync(
      process.execPath,
      [path.join(import.meta.dirname, "ci-state.ts"), "no-such-branch"],
      { encoding: "utf8" },
    ),
  ).toContain("WARNING: could not read CI on no-such-branch");
});
