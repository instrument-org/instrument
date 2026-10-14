import fs from "node:fs";
import path from "node:path";

import { outputFolderPath } from "../../src/lib/chat/output-folder";
import { SKILL_NAMES } from "../../src/lib/skill-names";
import { workDir } from "../../src/lib/work-dir";
import { type Session } from "../../src/schemas/session";
import { type Assertion, defineEval } from "../harness";

/**
 * A skill is read where it is: `load_skill` names its folder, the shell
 * calls it `$INSTRUMENT_SKILL_DIR`, and `python` runs a script there in the
 * skill's own environment, and the agent's own code in it too where no
 * `.venv` is near. A unit test shows the variable is set and the
 * environment picked; only a model shows whether it runs the scripts where
 * they are, without copying them or installing their packages again.
 */

/** Every bash command the task ran, in order. */
function bashCommands(sessions: Session.WithMessagesAndParts[]): string[] {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) => {
        if (part.type !== "tool-bash") {
          return [];
        }
        const command: string | undefined = part.input?.command;
        return command === undefined ? [] : [command];
      }),
    ),
  );
}

/** The folders a skill the task loaded was read from. */
function loadedSkillDirs(sessions: Session.WithMessagesAndParts[]): string[] {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "tool-load_skill" &&
        part.state === "output-available" &&
        part.output.state === "success"
          ? [part.output.skillDir]
          : [],
      ),
    ),
  );
}

/** Every file under `root`, by its path relative to it. */
function filesUnder(root: string): string[] {
  try {
    return fs
      .readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) =>
        path.relative(root, path.join(entry.parentPath, entry.name)),
      );
  } catch {
    return [];
  }
}

/**
 * What the task made: the files in its work folder and in the output
 * folder changed since its session began. The eval home's output folder
 * holds what other runs left.
 */
function madeFiles({
  chatId,
  sessions,
}: {
  chatId: Parameters<typeof workDir>[0];
  sessions: Session.WithMessagesAndParts[];
}): string[] {
  const since = Math.min(
    ...sessions.map((session) => session.createdAt.getTime()),
  );
  return [
    ...filesUnder(workDir(chatId)).map((file) =>
      path.join(workDir(chatId), file),
    ),
    ...filesUnder(outputFolderPath()).map((file) =>
      path.join(outputFolderPath(), file),
    ),
  ].filter((file) => fs.statSync(file).mtimeMs >= since);
}

function loadsSkill(name: string): Assertion {
  const text = `Loads the ${name} skill`;
  return {
    check: ({ sessions }) => {
      const dirs = loadedSkillDirs(sessions);
      return {
        evidence:
          dirs.length > 0 ? `Read from ${dirs.join(", ")}` : "Loaded no skill",
        passed: dirs.some((dir) => dir.length > 0),
        text,
      };
    },
    text,
  };
}

const runsScriptsInPlace: Assertion = {
  check: ({ sessions }) => {
    const dirs = loadedSkillDirs(sessions);
    const ran = bashCommands(sessions).filter(
      (command) =>
        /\$\{?INSTRUMENT_SKILL_DIR\}?\/scripts\//.test(command) ||
        dirs.some((dir) => command.includes(`${dir}/scripts/`)),
    );
    return {
      evidence:
        ran.length > 0
          ? `Ran ${ran.join(" | ")}`
          : `No command ran a script in ${dirs.join(", ") || "the skill's folder"}`,
      passed: ran.length > 0,
      text: "Runs one of the skill's scripts where it is",
    };
  },
  text: "Runs one of the skill's scripts where it is",
};

const copiesNoSkill: Assertion = {
  check: ({ chatId, sessions }) => {
    const copied = filesUnder(workDir(chatId)).filter(
      (file) => path.basename(file) === "SKILL.md",
    );
    const copies = bashCommands(sessions).filter((command) =>
      /\b(?:cp|rsync)\b[^|;&\n]*(?:INSTRUMENT_SKILL_DIR|\/skills\/)/.test(
        command,
      ),
    );
    return {
      evidence:
        copied.length + copies.length === 0
          ? "Nothing of the skill in the work folder"
          : `Copied: ${[...copied, ...copies].join(" | ")}`,
      passed: copied.length + copies.length === 0,
      text: "Leaves the skill where it is, with no copy in the work folder",
    };
  },
  text: "Leaves the skill where it is, with no copy in the work folder",
};

function installsNothingTheSkillHas(packages: RegExp): Assertion {
  const text = "Installs none of the packages the skill provides";
  return {
    check: ({ sessions }) => {
      const installs = bashCommands(sessions).filter(
        (command) =>
          /\b(?:pip3?|uv pip)\s+install\b/.test(command) &&
          packages.test(command),
      );
      return {
        evidence:
          installs.length === 0
            ? "Installed nothing the skill has"
            : `Installed again: ${installs.join(" | ")}`,
        passed: installs.length === 0,
        text,
      };
    },
    text,
  };
}

const TENANT = "Jordan Alvarez";

const fillsTheForm: Assertion = {
  check: ({ chatId, sessions }) => {
    const filled = madeFiles({ chatId, sessions }).filter(
      (file) =>
        file.toLowerCase().endsWith(".pdf") &&
        fs.readFileSync(file).toString("latin1").includes(TENANT),
    );
    return {
      evidence:
        filled.length > 0
          ? `Filled ${filled.join(", ")}`
          : "No PDF it made holds the tenant's name",
      passed: filled.length > 0,
      text: "Makes a copy of the form with the tenant's name filled in",
    };
  },
  text: "Makes a copy of the form with the tenant's name filled in",
};

const buildsTheWorkbook: Assertion = {
  check: ({ chatId, sessions }) => {
    const workbooks = madeFiles({ chatId, sessions }).filter((file) =>
      file.toLowerCase().endsWith(".xlsx"),
    );
    return {
      evidence:
        workbooks.length > 0
          ? `Made ${workbooks.join(", ")}`
          : "No .xlsx in the work or output folder",
      passed: workbooks.length > 0,
      text: "Makes the workbook",
    };
  },
  text: "Makes the workbook",
};

const leasePath = path.resolve(
  import.meta.dirname,
  "../fixtures/pdf-forms/lease.pdf",
);

export const SKILLS_IN_PLACE_EVALS = [
  defineEval({
    assertions: [
      loadsSkill(SKILL_NAMES.pdf),
      runsScriptsInPlace,
      copiesNoSkill,
      installsNothingTheSkillHas(/\b(?:pypdf|pdfplumber|pymupdf|reportlab)\b/i),
      fillsTheForm,
    ],
    files: [
      {
        content: fs.readFileSync(leasePath).toString("base64"),
        filename: "lease.pdf",
      },
    ],
    name: "skills-in-place-pdf-form",
    prompt: `Fill in the lease form I sent: the tenant is ${TENANT}, the lease starts March 1, 2027, and the rent is $2,340 a month.`,
  }),
  defineEval({
    assertions: [
      loadsSkill(SKILL_NAMES.spreadsheet),
      copiesNoSkill,
      installsNothingTheSkillHas(/\b(?:openpyxl|pandas)\b/i),
      buildsTheWorkbook,
    ],
    name: "skills-in-place-spreadsheet",
    prompt:
      "Make me an Excel workbook of this year's quarterly sales with a total row and the money formatted as dollars: Q1 $120,000, Q2 $135,500, Q3 $128,250, Q4 $151,000.",
  }),
];
