/**
 * Does the chat restyle the person's projects with `instrument projects set`
 * when asked, finding icons from the app's set rather than digging through
 * the app's own files?
 *
 * - **projects-restyle.** Four projects marked with emoji, two sharing a
 *   color, and the ask Neil made: an icon in place of each emoji and a color
 *   of its own for each. Scored on what the project files say afterward.
 */
import { isProjectIconName } from "@instrument-org/shared/project-marks";

import { createProject, listProjects } from "../../src/lib/chat/projects";
import { type Assertion, defineEval } from "../harness";
import { fail, pass } from "./handoff";

const NAMES = ["Daily", "Fitness", "Reading", "Money"];

async function seedProjects() {
  await createProject({ color: "#d4bc79", emoji: "☀️", name: "Daily" });
  await createProject({ color: "#e8a7cb", emoji: "🏃", name: "Fitness" });
  await createProject({ color: "#d4bc79", emoji: "📚", name: "Reading" });
  await createProject({ color: "#009178", emoji: "💰", name: "Money" });
}

async function seededProjects() {
  return (await listProjects()).filter((project) =>
    NAMES.includes(project.name),
  );
}

const iconsInPlaceOfEmoji: Assertion = {
  check: async () => {
    const text = "gave each project an icon from the app's set, emoji gone";
    const projects = await seededProjects();
    const evidence = projects
      .map(
        (project) =>
          `${project.name}: ${project.icon ?? "-"} ${project.emoji ?? ""}`,
      )
      .join("; ");
    return projects.length === NAMES.length &&
      projects.every(
        (project) =>
          project.icon !== undefined &&
          isProjectIconName(project.icon) &&
          project.emoji === undefined,
      )
      ? pass(text, evidence)
      : fail(text, evidence);
  },
  text: "gave each project an icon from the app's set, emoji gone",
};

const colorsOfTheirOwn: Assertion = {
  check: async () => {
    const text = "gave each project a color no other has";
    const projects = await seededProjects();
    const colors = projects.map((project) => project.color);
    const evidence = projects
      .map((project) => `${project.name}: ${project.color ?? "-"}`)
      .join("; ");
    return new Set(colors).size === NAMES.length
      ? pass(text, evidence)
      : fail(text, evidence);
  },
  text: "gave each project a color no other has",
};

/** Bash calls before the first `instrument projects set`, and any that read the app's own bundle. Recorded, not scored. */
const howItGotThere: Assertion = {
  check: (ctx) => {
    const text = "how it found the way (recorded, not scored)";
    const commands = ctx.sessions.flatMap((session) =>
      session.messages.flatMap((message) =>
        message.parts.flatMap((part) =>
          part.type === "tool-bash" && typeof part.input?.command === "string"
            ? [part.input.command]
            : [],
        ),
      ),
    );
    const first = commands.findIndex((command) =>
      /\binstrument projects set\b(?![^;&|]*--help)/.test(command),
    );
    const bundle = commands.filter((command) => /\.asar\b/.test(command));
    return pass(
      text,
      `${commands.length} command(s); first projects set at #${first + 1}; ${bundle.length} touched app.asar`,
    );
  },
  text: "how it found the way (recorded, not scored)",
};

export const PROJECTS_RESTYLE_EVALS = [
  defineEval({
    assertions: [iconsInPlaceOfEmoji, colorsOfTheirOwn, howItGotThere],
    kind: "chat",
    name: "projects-restyle",
    prompt:
      "update all my projects to use the nearest match icon (rather than emoji). and make them all have unique colors, right now some of them share colors",
    setup: seedProjects,
  }),
];
