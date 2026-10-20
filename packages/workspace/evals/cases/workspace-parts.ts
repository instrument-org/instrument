/**
 * Does the agent know the parts of the person's Instrument folder for what
 * they are?
 *
 * Topics, memories, skills and apps are folders the app keeps for the
 * person, and the prompt names each and where it lives. Without that, "my
 * Travel topic" named nothing the agent knew, and it went looking in Notes
 * on the Mac, asking for access to search it. And a skill published for
 * other agents comes with install steps naming their folders, which here all
 * mean the workspace's skills folder. What these measure:
 *
 * - **A topic is edited where it lives.** Asked to add to "my Travel topic",
 *   the agent changes `Topics/Travel/TOPIC.md` and reaches for no app.
 * - **A skill from a link is installed into the workspace's skills.** Given
 *   a skills.sh page, the skill lands in the workspace's skills folder, and
 *   in no other agent's.
 *
 * Both write into the run's workspace, which every trial of one run shares,
 * so sample them by running again with a fresh `INSTRUMENT_EVAL_HOME`
 * rather than with `--repeat`.
 */
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { TOPIC_FILE_NAME } from "../../src/constants";
import { createTopic, topicsDir } from "../../src/lib/chat/topics";
import { getWorkspaceSkillsDir } from "../../src/lib/workspace-skills-dir";
import { type Session } from "../../src/schemas/session";
import { type Assertion, type AssertionResult, defineEval } from "../harness";

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

const editedTheTopicFile: Assertion = {
  check: () => {
    const text = "added the preference to Topics/Travel/TOPIC.md";
    const file = path.join(topicsDir(), "Travel", TOPIC_FILE_NAME);
    const body = existsSync(file) ? readFileSync(file, "utf8") : "";
    return result(/train/i.test(body), text, body.slice(-200));
  },
  text: "added the preference to Topics/Travel/TOPIC.md",
};

const reachedForNoApp: Assertion = {
  check: ({ sessions }) => {
    const text = "looked for the topic in no app";
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
  text: "looked for the topic in no app",
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

export const WORKSPACE_PARTS_EVALS = [
  defineEval({
    assertions: [editedTheTopicFile, reachedForNoApp],
    kind: "chat",
    name: "workspace-parts-edits-a-topic",
    prompt:
      "Add to my Travel topic that I prefer trains over flights for trips under four hours.",
    setup: async () => {
      await createTopic({
        instructions: "Plan trips with a day of slack.",
        name: "Travel",
      });
    },
  }),

  defineEval({
    assertions: [installedIntoWorkspaceSkills, installedNowhereElse],
    kind: "chat",
    name: "workspace-parts-installs-a-skill",
    prompt:
      "Install this skill for me: https://www.skills.sh/mattpocock/skills/grill-me",
  }),
];
