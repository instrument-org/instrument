/**
 * Does a model group its work into activities on its own?
 *
 * `start_activity` only earns its place in the tool list if models reach for it
 * where a person would -- once before a phase of work, several times across a
 * long task, and not at all for a question answered in a sentence. This runs
 * the real agent over four situations chosen to span that range and reports,
 * per model, how many activities appeared, how many tool calls fell under each,
 * and whether any work started before anything was announced.
 *
 *   pnpm eval:activity-grouping --model openai/gpt-5.6-luna
 *
 * Separate from `EVALS` because of what it prints, not because it is
 * provisional: the counts are a guard rail, and the timeline at the end is the
 * finding. Whether "Charting the monthly growth" is the right boundary for the
 * six calls beneath it is a judgement no assertion makes for you.
 */
import "../scripts/lib/define-globals-apply";

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { ulid } from "ulid";

import { AGENT_FILES_LANGUAGE } from "../src/constants";
import { isToolPart } from "../src/lib/is-tool-part";
import { type Session } from "../src/schemas/session";
import { TOOL_NAMES } from "../src/tools/name";
import { type Assertion, defineEval, runEvals, sessionsFor } from "./harness";
import { generateReport } from "./report";
import { c, modelURI } from "./utils";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    concurrency: { default: "4", type: "string" },
    model: { multiple: true, type: "string" },
  },
});

const matchesPattern = (name: string) =>
  positionals.length === 0 ||
  positionals.some((pattern) => name.includes(pattern));

const models =
  values.model && values.model.length > 0
    ? values.model.map((model) =>
        model.includes("?") ? model : modelURI.openRouter(model),
      )
    : [modelURI.openRouter("openai/gpt-5.6-luna")];

// ---------------------------------------------------------------------------
// Reading the grouping back out of a transcript, and asserting on it
// ---------------------------------------------------------------------------

interface Activity {
  calls: string[];
  title: string;
}

interface Timeline {
  activities: Activity[];
  /** Calls made before the model announced anything. */
  unannounced: string[];
}

const ACTIVITY_PART_TYPE = `tool-${TOOL_NAMES.startActivity}` as const;

const activityCount = (count: number) =>
  `${count} ${count === 1 ? "activity" : "activities"}`;

function assertActivityCount({ max, min }: { max: number; min: number }) {
  const text =
    min === max
      ? `Opened exactly ${activityCount(min)}`
      : `Opened ${min}-${max} activities`;
  return {
    check: ({ sessions }) => {
      const { activities } = timelineFor(sessions);
      return {
        evidence:
          activities.length === 0
            ? "No activity at all"
            : activities.map((activity) => activity.title).join(" | "),
        passed: activities.length >= min && activities.length <= max,
        text,
      };
    },
    text,
  } satisfies Assertion;
}

function assistantText(sessions: Session.WithMessagesAndParts[]): string {
  return sessions
    .flatMap((session) =>
      session.messages
        .filter((message) => message.role === "assistant")
        .flatMap((message) =>
          message.parts.flatMap((part) =>
            part.type === "text" ? [part.text] : [],
          ),
        ),
    )
    .join("\n\n");
}

/**
 * Transcript order is the whole of the grouping: a call belongs to the last
 * activity opened before it. That is the contract the tool ships with, so
 * reading it back the same way is what this measures.
 */
function timelineFor(sessions: Session.WithMessagesAndParts[]): Timeline {
  const timeline: Timeline = { activities: [], unannounced: [] };

  for (const session of sessions) {
    for (const message of session.messages) {
      for (const part of message.parts) {
        if (!isToolPart(part)) {
          continue;
        }
        if (part.type === ACTIVITY_PART_TYPE) {
          const title = part.input?.title;
          timeline.activities.push({
            calls: [],
            // A call whose title never arrived is still an activity the model
            // opened, and counting it is what makes that visible.
            title: typeof title === "string" ? title : "(no title)",
          });
          continue;
        }
        const toolName = part.type.replace("tool-", "");
        const current = timeline.activities.at(-1);
        if (current) {
          current.calls.push(toolName);
        } else {
          timeline.unannounced.push(toolName);
        }
      }
    }
  }

  return timeline;
}

/**
 * The per-call label the UI puts on a row. A row is a label, not a sentence
 * addressed to anyone, so the failure worth counting is the first person: a
 * model narrating "I'm copying the CSV" reads as chat where the design wants
 * "Copying the CSV".
 */
const FIRST_PERSON =
  /^\s*(?:I|I'm|I am|I'll|I will|We|We're|We'll|Let me|Let's|Now I)\b/iu;

const assertExplanationVoice: Assertion = {
  check: ({ sessions }) => {
    const explanations = sessions.flatMap((session) =>
      session.messages.flatMap((message) =>
        message.parts.flatMap((part) => {
          if (!isToolPart(part) || part.type === ACTIVITY_PART_TYPE) {
            return [];
          }
          const explanation = (
            part.input as undefined | { explanation?: unknown }
          )?.explanation;
          return typeof explanation === "string" && explanation !== ""
            ? [explanation]
            : [];
        }),
      ),
    );
    const firstPerson = explanations.filter((text) => FIRST_PERSON.test(text));
    return {
      evidence:
        explanations.length === 0
          ? "No explanations to read"
          : firstPerson.length === 0
            ? `All ${explanations.length} in the third person`
            : `${firstPerson.length}/${explanations.length} first person: ${firstPerson.slice(0, 3).join(" | ")}`,
      passed: explanations.length > 0 && firstPerson.length === 0,
      text: "Labelled every call without narrating in the first person",
    };
  },
  text: "Labelled every call without narrating in the first person",
};

const assertNoActivity: Assertion = {
  check: ({ sessions }) => {
    const { activities } = timelineFor(sessions);
    return {
      evidence:
        activities.length === 0
          ? "No activity, as expected for a reply that uses no tools"
          : `Unwanted: ${activities.map((activity) => activity.title).join(" | ")}`,
      passed: activities.length === 0,
      text: "Left the activity out when there was no work to group",
    };
  },
  text: "Left the activity out when there was no work to group",
};

/** The failure this guards against is one activity per tool call. */
const assertGroupsSeveralCalls: Assertion = {
  check: ({ sessions }) => {
    const { activities } = timelineFor(sessions);
    const calls = activities.reduce(
      (total, activity) => total + activity.calls.length,
      0,
    );
    const perActivity = activities.length === 0 ? 0 : calls / activities.length;
    return {
      evidence: `${calls} call(s) under ${activityCount(activities.length)}, ${perActivity.toFixed(1)} each`,
      passed: activities.length > 0 && perActivity >= 2,
      text: "Grouped several calls under each activity",
    };
  },
  text: "Grouped several calls under each activity",
};

/**
 * The other half of the mean: a run can average well and still have one
 * activity swallowing a whole task. The prompt says roughly six calls, so this
 * fails a little past that rather than at it.
 */
const MAX_CALLS_PER_ACTIVITY = 8;

const assertActivityCadence: Assertion = {
  check: ({ sessions }) => {
    const { activities } = timelineFor(sessions);
    const overrun = activities.filter(
      (activity) => activity.calls.length > MAX_CALLS_PER_ACTIVITY,
    );
    return {
      evidence:
        overrun.length === 0
          ? `Longest activity covered ${Math.max(0, ...activities.map((activity) => activity.calls.length))} call(s)`
          : overrun
              .map(
                (activity) =>
                  `${activity.title}: ${activity.calls.length} calls`,
              )
              .join(" | "),
      passed: activities.length > 0 && overrun.length === 0,
      text: `Started the next activity within ${MAX_CALLS_PER_ACTIVITY} calls`,
    };
  },
  text: `Started the next activity within ${MAX_CALLS_PER_ACTIVITY} calls`,
};

/** Announcing a phase and then yielding is the early-stopping failure. */
const assertNoEmptyActivity: Assertion = {
  check: ({ sessions }) => {
    const { activities } = timelineFor(sessions);
    const empty = activities.filter((activity) => activity.calls.length === 0);
    return {
      evidence:
        empty.length === 0
          ? `All ${activityCount(activities.length)} were followed by work`
          : `Announced with nothing under it: ${empty.map((activity) => activity.title).join(" | ")}`,
      passed: activities.length > 0 && empty.length === 0,
      text: "Did the work it announced",
    };
  },
  text: "Did the work it announced",
};

const assertAnnouncedBeforeWorking: Assertion = {
  check: ({ sessions }) => {
    const { unannounced } = timelineFor(sessions);
    return {
      evidence:
        unannounced.length === 0
          ? "Work began under an activity"
          : `${unannounced.length} call(s) before the first activity: ${unannounced.join(", ")}`,
      passed: unannounced.length === 0,
      text: "Opened an activity before starting work",
    };
  },
  text: "Opened an activity before starting work",
};

const MAX_TITLE_WORDS = 10;

const assertTitlesAreHeadings: Assertion = {
  check: ({ sessions }) => {
    const { activities } = timelineFor(sessions);
    const long = activities.filter(
      (activity) => activity.title.split(/\s+/u).length > MAX_TITLE_WORDS,
    );
    return {
      evidence:
        long.length === 0
          ? `All ${activities.length} title(s) within ${MAX_TITLE_WORDS} words`
          : `Too long: ${long.map((activity) => activity.title).join(" | ")}`,
      passed: long.length === 0,
      text: `Kept every title under ${MAX_TITLE_WORDS} words`,
    };
  },
  text: `Kept every title under ${MAX_TITLE_WORDS} words`,
};

/**
 * The regression this exists to catch as much as anything: a new tool in
 * the list must not cost the behavior the last one bought. A reply naming a
 * file still has to show it.
 */
const assertStillShowsItsFiles: Assertion = {
  check: ({ sessions }) => {
    const fences = [
      ...assistantText(sessions).matchAll(
        new RegExp(
          String.raw`^[ \t]*\x60{3,}[ \t]*${AGENT_FILES_LANGUAGE}[ \t]*$`,
          "gmu",
        ),
      ),
    ];
    return {
      evidence: `${fences.length} \`\`\`${AGENT_FILES_LANGUAGE} fence(s) in the reply`,
      passed: fences.length > 0,
      text: "Still showed the files it produced",
    };
  },
  text: "Still showed the files it produced",
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOTES = {
  "meeting-2026-03-02.md":
    "# Sync\n\nBudget approved for the spring campaign. Nothing decided on venues.\n",
  "onboarding.md":
    "# Onboarding\n\nDay one: accounts, laptop, reading list. No launch content here.\n",
  "roadmap.md":
    "# Roadmap\n\nQ2: pricing rework. Q3: partner API. Launch dates tracked elsewhere.\n",
  "travel.md":
    "# Travel\n\nHelsinki launch is set for 14 September 2026. Flights not booked yet.\n",
};

const SALES_CSV = [
  "month,revenue",
  "2026-01,48200",
  "2026-02,51150",
  "2026-03,60400",
  "2026-04,57300",
  "2026-05,71900",
  "2026-06,83250",
].join("\n");

async function buildFixtures() {
  const root = path.join(os.tmpdir(), `activity-grouping-${ulid()}`);
  const reports = path.join(root, "Reports");
  const notes = path.join(root, "Notes");

  await fs.mkdir(reports, { recursive: true });
  await fs.mkdir(notes, { recursive: true });
  await fs.writeFile(path.join(reports, "sales.csv"), SALES_CSV, "utf8");
  for (const [name, body] of Object.entries(NOTES)) {
    await fs.writeFile(path.join(notes, name), body, "utf8");
  }

  return { notes, reports, root };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const fixtures = await buildFixtures();
process.stdout.write(`${c.dim}Fixtures  :${c.reset} ${fixtures.root}\n`);

const EVAL_CASES = [
  // Long enough that one activity for the whole run would be the wrong answer:
  // reading the data, building the chart, and checking it are three objectives.
  defineEval({
    assertions: [
      assertActivityCount({ max: 6, min: 2 }),
      assertAnnouncedBeforeWorking,
      assertActivityCadence,
      assertExplanationVoice,
      assertGroupsSeveralCalls,
      assertNoEmptyActivity,
      assertTitlesAreHeadings,
      assertStillShowsItsFiles,
    ],
    folders: [{ access: "read-only", path: fixtures.reports }],
    name: "multi-phase-build",
    prompt:
      "Take the sales spreadsheet in my Reports folder, work out the month-over-month growth, and give me a PNG chart of it plus a two-line takeaway. Look at the chart yourself before you tell me it's done.",
  }),
  // Two phases the user named themselves, so the boundary between them is not
  // a matter of taste: an activity that spans both is a real miss.
  defineEval({
    assertions: [
      assertActivityCount({ max: 5, min: 2 }),
      assertAnnouncedBeforeWorking,
      assertActivityCadence,
      assertExplanationVoice,
      assertGroupsSeveralCalls,
      assertNoEmptyActivity,
      assertTitlesAreHeadings,
      assertStillShowsItsFiles,
    ],
    folders: [{ access: "read-only", path: fixtures.notes }],
    name: "find-then-produce",
    prompt:
      "First work out which of the notes in my Notes folder has the Helsinki launch date in it, then write me a one-page markdown brief about that launch.",
  }),
  // The obvious first move -- edit the notes where they sit -- cannot work: the
  // mount is read-only and every write fails. So the phase the model opens is
  // never the phase it ends up doing, which is the only situation in which a
  // heading written up front has anything to correct.
  defineEval({
    assertions: [
      assertActivityCount({ max: 6, min: 2 }),
      assertAnnouncedBeforeWorking,
      assertExplanationVoice,
    ],
    folders: [{ access: "read-only", path: fixtures.notes }],
    name: "derailed-by-a-read-only-folder",
    prompt:
      "Tidy up the notes in my Notes folder: give each one a proper title line and fix the formatting, then tell me what you changed.",
  }),
  // A read and an answer, which is where the unconditional trigger costs
  // something: one activity is the rule, and a second would be noise.
  defineEval({
    assertions: [
      assertActivityCount({ max: 1, min: 1 }),
      assertAnnouncedBeforeWorking,
      assertExplanationVoice,
    ],
    folders: [{ access: "read-only", path: fixtures.notes }],
    name: "single-quick-lookup",
    prompt: "What's the Helsinki launch date in my notes?",
  }),
  defineEval({
    assertions: [assertNoActivity],
    name: "no-tools-conversation",
    prompt:
      "In two sentences, what is the difference between a semaphore and a mutex?",
  }),
];

const selectedCases = EVAL_CASES.filter((evalCase) =>
  matchesPattern(evalCase.name),
);

const { runs, workspaceRootDir } = await runEvals(selectedCases, {
  concurrency: Number.parseInt(values.concurrency, 10),
  models,
});

const outputDir = path.resolve(
  import.meta.dirname,
  "..",
  "eval-results.local",
  `activity-grouping-${new Date().toISOString().replaceAll(/[:.]/gu, "-")}`,
);

const rollup = await generateReport({
  evalCases: selectedCases,
  outputDir,
  runs,
  workspaceRootDir,
});

process.stdout.write(
  [
    "",
    `${c.dim}Transcripts:${c.reset}`,
    ...rollup.results.map(
      (result) =>
        `  ${c.cyan}${result.label}${c.reset}  ${path.relative(process.cwd(), path.join(outputDir, result.outputDir, "session.md"))}`,
    ),
    "",
  ].join("\n"),
);

// Where the model drew the boundaries, verbatim. A pass/fail column can say
// there were three activities; only this says whether they were the right three.
process.stdout.write(`${c.dim}Activities as declared:${c.reset}\n`);
for (const run of runs) {
  const timeline = timelineFor(await sessionsFor(run.taskId));
  const lines = [
    timeline.unannounced.length > 0
      ? `    ${c.red}(unannounced)${c.reset} ${c.dim}${timeline.unannounced.join(", ")}${c.reset}`
      : null,
    ...timeline.activities.map((activity) =>
      [
        `    ${activity.title}`,
        `      ${c.dim}${activity.calls.length === 0 ? "(nothing)" : activity.calls.join(", ")}${c.reset}`,
      ].join("\n"),
    ),
  ].filter((line) => line !== null);

  process.stdout.write(
    `  ${c.cyan}${run.label}${c.reset}\n${
      lines.length === 0
        ? `    ${c.dim}(none)${c.reset}\n`
        : `${lines.join("\n")}\n`
    }`,
  );
}
