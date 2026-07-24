import { defineCommand } from "just-bash";
import fs from "node:fs/promises";
import { dedent } from "radashi";

import { type AbsolutePath } from "../../schemas/paths";
import { absolutePathJoin } from "../absolute-path-join";
import { pathExists } from "../path-exists";
import { findSkills, getSkillSources } from "../skills";
import {
  type SkillFinding,
  type SkillReport,
  validateSkill,
} from "../validate-skill";
import { getWorkspaceConfig } from "../workspace-config";
import {
  getWorkspaceSkillsDir,
  SKILLS_MOUNT_POINT,
} from "../workspace-fs-layout";

export const VALIDATE_SKILL_COMMAND = {
  description: dedent`
    Check a skill written under \`${SKILLS_MOUNT_POINT}/\` and report what is wrong with it.
    Errors are what the runtime already acts on: a skill that is never discovered, or one \`load_skill\` refuses. Warnings are authoring rules and context budgets.
    Run it after writing or editing a skill -- a skill with broken frontmatter fails silently, by simply never appearing anywhere.
    Usage: \`validate-skill [<name>...] [--json]\`. With no name it checks every skill in the workspace. Exits non-zero when there are errors.
  `.trim(),
  name: "validate-skill",
} as const;

export function createValidateSkillCommand() {
  return defineCommand(VALIDATE_SKILL_COMMAND.name, async (args, ctx) => {
    const skillsDir = getWorkspaceSkillsDir();

    const json = args.includes("--json");
    const requested = args.filter((arg) => !arg.startsWith("-"));
    const names = requested.map(toSkillName);
    if (names.includes(null)) {
      return fail(`only skills under ${SKILLS_MOUNT_POINT}/ can be checked.`);
    }

    const targets =
      names.length > 0
        ? names.filter((name) => name !== null)
        : await skillDirectoryNames(skillsDir);
    if (targets.length === 0) {
      return {
        exitCode: 0,
        stderr: "",
        stdout: `No skills in ${SKILLS_MOUNT_POINT}/ to check.\n`,
      };
    }

    const missing = await findMissing(skillsDir, targets);
    if (missing) {
      return fail(`no skill named "${missing}" in ${SKILLS_MOUNT_POINT}/.`);
    }

    // The catalog and duplicate-name checks are about this skill's place among
    // all the others, so discovery has to run over every source, not just the
    // workspace.
    const installed = await findSkills(
      getSkillSources(getWorkspaceConfig()),
    ).catch(() => []);
    const signal = ctx.signal ?? AbortSignal.timeout(30_000);

    const reports: SkillReport[] = [];
    for (const name of targets) {
      reports.push(
        await validateSkill({
          installed,
          signal,
          skillDir: absolutePathJoin(skillsDir, name),
          skillName: name,
        }),
      );
    }

    const errors = reports.flatMap((report) =>
      report.findings.filter((finding) => finding.level === "error"),
    );

    return {
      exitCode: errors.length > 0 ? 1 : 0,
      stderr: "",
      stdout: json
        ? `${JSON.stringify(reports.map(withSandboxPath), null, 2)}\n`
        : reports.map(formatReport).join("\n"),
    };
  });
}

function fail(message: string) {
  return {
    exitCode: 1,
    stderr: `${VALIDATE_SKILL_COMMAND.name}: ${message}\n`,
    stdout: "",
  };
}

async function findMissing(skillsDir: AbsolutePath, names: string[]) {
  for (const name of names) {
    if (!(await pathExists(absolutePathJoin(skillsDir, name)))) {
      return name;
    }
  }
  return;
}

function formatFinding(finding: SkillFinding) {
  const where = finding.file ? ` ${finding.file}:` : "";
  return `  ${finding.level}:${where} ${finding.message} (${finding.rule})`;
}

function formatReport(report: SkillReport) {
  const { descriptionChars, fileCount, skillFileLines, skillFileTokens } =
    report.stats;
  const measurements = `  ${skillFileLines} lines, ~${skillFileTokens} tokens, ${descriptionChars}-character description, ${fileCount} file(s)`;

  if (report.findings.length === 0) {
    return `${report.name}: ok\n${measurements}\n`;
  }

  // Errors first: when a skill is never discovered, its warnings are moot.
  const errors = report.findings.filter((f) => f.level === "error");
  const warnings = report.findings.filter((f) => f.level === "warning");

  return [
    `${report.name}: ${errors.length} error(s), ${warnings.length} warning(s)`,
    measurements,
    ...[...errors, ...warnings].map(formatFinding),
    "",
  ].join("\n");
}

/**
 * Directory names, not discovered skills.
 *
 * A skill whose frontmatter does not parse is absent from discovery, and those
 * are the ones this command exists to find -- listing through `findSkills`
 * would skip exactly them.
 */
async function skillDirectoryNames(skillsDir: string) {
  const entries = await fs
    .readdir(skillsDir, { withFileTypes: true })
    .catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Accept a bare name or a path under the skills mount, and nothing else.
 *
 * Skills elsewhere on the machine belong to other tools and are read-only to
 * us, so reporting on one would only be advice nobody here can act on.
 */
function toSkillName(argument: string): null | string {
  const normalized = argument.replace(/\/+$/, "");
  const prefix = `${SKILLS_MOUNT_POINT}/`;
  const rest = normalized.startsWith(prefix)
    ? normalized.slice(prefix.length)
    : normalized;
  return rest === "" || rest.includes("/") ? null : rest;
}

/**
 * Address the skill the way the agent can: its real location is a host path
 * that does not exist inside the sandbox and must not leak into output.
 */
function withSandboxPath(report: SkillReport) {
  return { ...report, path: `${SKILLS_MOUNT_POINT}/${report.name}` };
}
