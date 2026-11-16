/**
 * Does the agent know the parts of the person's Instrument folder for what
 * they are?
 *
 * Projects, memories, skills and apps are folders the app keeps for the
 * person, and the prompt names each and where it lives. Without that, "my
 * Travel project" named nothing the agent knew, and it went looking in Notes
 * on the Mac, asking for access to search it. And a skill published for
 * other agents comes with install steps naming their folders, which here all
 * mean the workspace's skills folder. What these measure:
 *
 * - **A project is edited where it lives.** Asked to add to "my Travel project",
 *   the agent changes `Projects/Travel/AGENTS.md` and reaches for no app, and
 *   makes the file where the project has no instructions yet, so none.
 * - **A skill from a link is installed into the workspace's skills.** Given
 *   a skills.sh page, the skill lands in the workspace's skills folder, and
 *   in no other agent's.
 * - **Instructions for every chat go in the top-level `AGENTS.md`.** The file
 *   has no screen in the app, and until it has text no note names it, so
 *   only the prompt says where it is.
 * - **"Draft" is a message, not the Drafts folder.** A drafted email is a
 *   message card, and nothing lands in the user's reply boxes.
 *
 * Both write into the run's workspace, which every trial of one run shares,
 * so sample them by running again with a fresh `INSTRUMENT_EVAL_HOME`
 * rather than with `--repeat`.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { AGENT_MESSAGE_LANGUAGE, PROJECT_FILE_NAME } from "../../src/constants";
import { createProject, projectsDir } from "../../src/lib/chat/projects";
import { getWorkspaceConfig } from "../../src/lib/workspace-config";
import { getWorkspaceSkillsDir } from "../../src/lib/workspace-skills-dir";
import { workspaceLayout } from "../../src/lib/workspace-layout";
import { type Session } from "../../src/schemas/session";
import { type Assertion, type AssertionResult, defineEval } from "../harness";
import { said } from "./handoff";

function commands(sessions: Session.WithMessagesAndParts[]): string[] {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) => {
        if (part.type === "tool-bash") {
          const command: string | undefined = part.input?.command;
          return command === undefined ? [] : [command];
        }
        if (part.type === "tool-ask_permission") {
          return [`ask_permission ${JSON.stringify(part.input ?? {})}`];
        }
        return [];
      }),
    ),
  );
}

function result(
  passed: boolean,
  text: string,
  evidence: string,
): AssertionResult {
  return { evidence, passed, text };
}

const editedTheProjectFile: Assertion = {
  check: () => {
    const text = "added the preference to Projects/Travel/AGENTS.md";
    const file = path.join(projectsDir(), "Travel", PROJECT_FILE_NAME);
    const body = existsSync(file) ? readFileSync(file, "utf8") : "";
    return result(/train/i.test(body), text, body.slice(-200));
  },
  text: "added the preference to Projects/Travel/AGENTS.md",
};

const reachedForNoApp: Assertion = {
  check: ({ sessions }) => {
    const text = "looked for the project in no app";
    const reached = commands(sessions).filter((command) =>
      /instrument (?:notes|reminders|calendar)\b|ask_permission .*"kind":"app"/.test(
        command,
      ),
    );
    return result(
      reached.length === 0,
      text,
      reached.length === 0 ? "none" : reached.join(" | "),
    );
  },
  text: "looked for the project in no app",
};

const installedIntoWorkspaceSkills: Assertion = {
  check: () => {
    const text = "installed grill-me into the workspace's skills folder";
    const file = path.join(getWorkspaceSkillsDir(), "grill-me", "SKILL.md");
    return result(existsSync(file), text, file);
  },
  text: "installed grill-me into the workspace's skills folder",
};

const installedNowhereElse: Assertion = {
  check: () => {
    const text = "left nothing in another agent's skills folder";
    const elsewhere = [".claude", ".codex", ".agents", ".cursor"]
      .map((folder) => path.join(os.homedir(), folder, "skills", "grill-me"))
      .filter((folder) => existsSync(folder));
    return result(
      elsewhere.length === 0,
      text,
      elsewhere.length === 0 ? "none" : elsewhere.join(", "),
    );
  },
  text: "left nothing in another agent's skills folder",
};

const wroteWorkspaceInstructions: Assertion = {
  check: () => {
    const text = "added the rule to the workspace's own AGENTS.md";
    const file = path.join(getWorkspaceConfig().rootDir, PROJECT_FILE_NAME);
    const body = existsSync(file) ? readFileSync(file, "utf8") : "";
    return result(
      /celsius/i.test(body) && /fahrenheit/i.test(body),
      text,
      body ? JSON.stringify(body.slice(0, 300)) : "no file",
    );
  },
  text: "added the rule to the workspace's own AGENTS.md",
};

const leftDraftsAlone: Assertion = {
  check: () => {
    const text = "put nothing in the Drafts folder";
    const dir = workspaceLayout(getWorkspaceConfig().rootDir).draftsDir;
    const entries = existsSync(dir)
      ? readdirSync(dir, { recursive: true }).map(String)
      : [];
    return result(
      entries.length === 0,
      text,
      entries.length === 0 ? "empty" : entries.join(", "),
    );
  },
  text: "put nothing in the Drafts folder",
};

const showedAMessage: Assertion = {
  check: ({ sessions }) => {
    const text = "showed the email as a message card";
    const reply = said(sessions)
      .map((one) => one.text)
      .join("\n");
    return result(
      reply.includes(`\`\`\`${AGENT_MESSAGE_LANGUAGE}`),
      text,
      JSON.stringify(reply.slice(0, 300)),
    );
  },
  text: "showed the email as a message card",
};

export const WORKSPACE_PARTS_EVALS = [
  defineEval({
    assertions: [editedTheProjectFile, reachedForNoApp],
    kind: "chat",
    name: "workspace-parts-edits-a-project",
    prompt:
      "Add to my Travel project that I prefer trains over flights for trips under four hours.",
    setup: async () => {
      await createProject({
        instructions: "Plan trips with a day of slack.",
        name: "Travel",
      });
    },
  }),

  // A project with no instructions is its folder alone, with no AGENTS.md.
  defineEval({
    assertions: [editedTheProjectFile, reachedForNoApp],
    kind: "chat",
    name: "workspace-parts-starts-a-project-file",
    prompt:
      "Add to my Travel project that I prefer trains over flights for trips under four hours.",
    setup: async () => {
      await createProject({ emoji: "🧳", name: "Travel" });
    },
  }),

  defineEval({
    assertions: [installedIntoWorkspaceSkills, installedNowhereElse],
    kind: "chat",
    name: "workspace-parts-installs-a-skill",
    prompt:
      "Install this skill for me: https://www.skills.sh/mattpocock/skills/grill-me",
  }),

  defineEval({
    assertions: [wroteWorkspaceInstructions],
    kind: "chat",
    name: "workspace-parts-instructions-for-every-chat",
    prompt:
      "Add to the instructions every chat in this workspace follows: give temperatures in both Celsius and Fahrenheit.",
  }),

  defineEval({
    assertions: [leftDraftsAlone, showedAMessage],
    kind: "chat",
    name: "workspace-parts-draft-is-a-message",
    prompt:
      "Draft an email to my landlord asking him to fix the kitchen sink this week.",
  }),
];
