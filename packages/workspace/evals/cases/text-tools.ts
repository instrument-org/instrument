import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ulid } from "ulid";

import { type Session } from "../../src/schemas/session";
import { type Assertion, defineEval } from "../harness";

/**
 * Text work over a folder of reports, the shape of the questions where the
 * record shows models reaching for `sort -g`, `grep -H`/`-L`, `uniq -c`,
 * `cmp` and `xargs`. Scored on the answers; the bash calls the shell turned
 * down (an option it lacks, a command it does not have) are counted in the
 * evidence, which is what running the GNU text commands on the bundled
 * uutils is meant to remove. Run once as is and once with
 * EVAL_BUILTINS_ONLY=1 to compare.
 */
const FIXTURES = path.join(os.tmpdir(), `text-tools-evals-${ulid()}`);
const REPORTS = path.join(FIXTURES, "Field Reports");

const REGIONS = ["North", "South", "East", "West"];
const INSPECTORS = ["Hana Ito", "Raj Patel", "Lee Wu", "Ana Silva"];

const SITES = Array.from({ length: 40 }, (_, index) => {
  const id = `S-${String(index + 1).padStart(2, "0")}`;
  return {
    flags: index % 9 === 4 ? undefined : index % 3 === 0 ? "erosion" : "none",
    id,
    // Uneven, so each count has to be read rather than guessed from a split.
    inspector: INSPECTORS[[0, 0, 0, 1, 1, 2, 3][index % 7] ?? 0] ?? "Hana Ito",
    region: REGIONS[index % 4] ?? "North",
    turbidity: Number((((index * 37) % 97) * 1.25 + 0.4).toFixed(2)),
  };
});
const TOP_FIVE = SITES.toSorted((a, b) => b.turbidity - a.turbidity).slice(
  0,
  5,
);
const NO_FLAGS = SITES.filter((site) => site.flags === undefined);
const PER_INSPECTOR = Object.fromEntries(
  INSPECTORS.map((name) => [
    name,
    SITES.filter((site) => site.inspector === name).length,
  ]),
);
/** The line where the backup differs from readings.csv, counting the header. */
const DIFFERING_LINE = 137;

fs.mkdirSync(REPORTS, { recursive: true });
for (const site of SITES) {
  fs.writeFileSync(
    path.join(REPORTS, `${site.id}.md`),
    [
      `# Site report: ${site.id}`,
      `Region: ${site.region}`,
      `Inspector: ${site.inspector}`,
      `Turbidity (NTU): ${site.turbidity}`,
      ...(site.flags === undefined ? [] : [`Flags: ${site.flags}`]),
      "",
      "Notes: water clear at the inlet, sediment near the bank.",
      "",
    ].join("\n"),
  );
}
const readings = [
  "site,date,ph,turbidity",
  ...Array.from(
    { length: 200 },
    (_, index) =>
      `S-${String((index % 40) + 1).padStart(2, "0")},2026-0${(index % 9) + 1}-1${index % 10},${(6.5 + (index % 15) / 10).toFixed(1)},${((index * 13) % 50) + 0.5}`,
  ),
];
fs.writeFileSync(
  path.join(REPORTS, "readings.csv"),
  `${readings.join("\n")}\n`,
);
fs.writeFileSync(
  path.join(REPORTS, "readings-backup.csv"),
  `${readings
    .map((line, index) =>
      index === DIFFERING_LINE - 1 ? line.replace(/,[^,]*$/, ",99.9") : line,
    )
    .join("\n")}\n`,
);

function replyText(sessions: Session.WithMessagesAndParts[]): string {
  return sessions
    .flatMap((session) => session.messages)
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.parts)
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
}

function bashOutcomes(sessions: Session.WithMessagesAndParts[]) {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "tool-bash" && part.output
          ? [{ command: part.input.command, text: part.output.output }]
          : [],
      ),
    ),
  );
}

/** What the shell prints when it turns a command down rather than runs it. */
const TURNED_DOWN =
  /(?:invalid option|unrecognized option|unknown option|unknown predicate|illegal option|command not found)/;

const fewTurnedDown: Assertion = {
  check: ({ sessions }) => {
    const calls = bashOutcomes(sessions);
    const turnedDown = calls.filter((call) => TURNED_DOWN.test(call.text));
    return {
      evidence: `${turnedDown.length} of ${calls.length} bash calls turned down${turnedDown.length > 0 ? `: ${turnedDown.map((call) => call.command.slice(0, 80)).join(" | ")}` : ""}`,
      passed: turnedDown.length === 0,
      text: "no command turned down for an option or a missing command",
    };
  },
  text: "no command turned down for an option or a missing command",
};

const answer = (
  text: string,
  test: (reply: string) => { detail: string; passed: boolean },
): Assertion => ({
  check: ({ sessions }) => {
    const { detail, passed } = test(replyText(sessions));
    return { evidence: detail, passed, text };
  },
  text,
});

export const TEXT_TOOLS_EVALS = [
  defineEval({
    assertions: [
      answer("named the five murkiest sites", (reply) => {
        const missing = TOP_FIVE.filter(
          (site) =>
            !reply.includes(site.id) || !reply.includes(String(site.turbidity)),
        );
        return {
          detail:
            missing.length === 0
              ? "all five with their values"
              : `missing ${missing.map((site) => `${site.id} ${site.turbidity}`).join(", ")}`,
          passed: missing.length === 0,
        };
      }),
      answer("counted each inspector's reports", (reply) => {
        const wrong = INSPECTORS.filter((name) => {
          const count = String(PER_INSPECTOR[name] ?? 0);
          return !new RegExp(
            `${name}[^\\n]{0,40}\\b${count}\\b|\\b${count}\\b[^\\n]{0,40}${name}`,
          ).test(reply);
        });
        return {
          detail:
            wrong.length === 0
              ? JSON.stringify(PER_INSPECTOR)
              : `no count beside ${wrong.join(", ")}; expected ${JSON.stringify(PER_INSPECTOR)}`,
          passed: wrong.length === 0,
        };
      }),
      answer("listed the reports with no Flags line", (reply) => {
        const missing = NO_FLAGS.filter((site) => !reply.includes(site.id));
        return {
          detail:
            missing.length === 0
              ? NO_FLAGS.map((site) => site.id).join(", ")
              : `missing ${missing.map((site) => site.id).join(", ")}`,
          passed: missing.length === 0,
        };
      }),
      answer("found where the backup differs", (reply) => ({
        detail: `expected line ${DIFFERING_LINE}`,
        passed: new RegExp(`\\b${DIFFERING_LINE}\\b`).test(reply),
      })),
      fewTurnedDown,
    ],
    folders: [{ path: REPORTS }],
    name: "text-tools-reports",
    prompt:
      "My Field Reports folder has one report per site plus two CSVs. Using the shell: which five sites have the highest turbidity, with their values? How many reports did each inspector file? Which reports have no Flags line? And are readings.csv and readings-backup.csv identical? If not, give the first line number where they differ.",
  }),
];
