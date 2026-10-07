import { APP_NAME } from "@instrument-org/shared";
import { dedent, pick } from "radashi";

import {
  TASK_FOLDER_NAMES as F,
  TOOL_ACTIVITY_PARAM_NAME,
  TOOL_EXPLANATION_PARAM_NAME,
} from "../constants";
import { buildAppsContextText } from "../lib/apps/context";
import { assignAttachedMounts } from "../lib/attached-folder-mounts";
import { buildAvailableSkillsContext } from "../lib/available-skills-context";
import { buildAttachedFoldersText } from "../lib/build-attached-folders-text";
import { folderReach } from "../lib/chat/folder-reach";
import { getCurrentDate } from "../lib/get-current-date";
import { isForkOnly, ONE_AGENT_NAME, oneAgentMode } from "../lib/one-agent";
import { PNPM_COMMAND } from "../lib/shell-commands/pnpm";
import { TASK_COMMAND } from "../lib/shell-commands/task-command";
import {
  effectiveFolderAccess,
  folderHoldsWorkspace,
} from "../lib/workspace-fs-layout";
import { MOUNT } from "../mount-points";
import { TOOLS } from "../tools/all";
import { setupAgent } from "./create-agent";
import { instrumentAgent, shouldContinueAfterHandingOff } from "./instrument";
import { mainAgent } from "./main";
import { forkOnlyPrompt } from "./one-simple";
import {
  createContextMessage,
  createSystemMessage,
  getSystemInfoText,
  getUserText,
} from "./shared";

/**
 * The one-agent design, behind the `one_agent` flag: the agent the user talks
 * to does the work itself, with the task agent's tools beside its own, and
 * forks what is multi-step or slow to a background run that carries this
 * conversation (`task new`, which forks under the flag). In the flag's
 * `foreground` mode it forks nothing and does every job in the conversation.
 * A fork runs this same agent, so its system
 * prompt and tool definitions are the chat's byte for byte and a provider's
 * prefix cache can serve the inherited conversation.
 *
 * In the fork-only modes the prompt is its own (`agents/one-simple.ts`).
 * Otherwise it is composed from the two agents' own prompts rather than
 * copied out of them, so the chat's voice rules (how it speaks, the files and message
 * fences, one line then act) reach it verbatim and move when they move. What
 * it drops is what says the chat does no work: the opening, the bullets that
 * fence its reach, and the lines about tasks' skills and links it can now
 * load and open itself.
 */
export const oneAgent = setupAgent({
  agentTools: pick(TOOLS, [
    "BashTool",
    "Choose",
    "ConnectApp",
    "EditFile",
    "GenerateImage",
    "LoadSkill",
    "ReadFile",
    "RequestFolder",
    "WebFetch",
    "WebSearch",
    "WriteFile",
  ]),
  name: ONE_AGENT_NAME,
}).create(({ agentTools, name }) => {
  const systemPrompt = () => {
    const mode = oneAgentMode();
    if (isForkOnly(mode)) {
      return forkOnlyPrompt();
    }
    const foreground = mode === "foreground";
    const chat = promptSections(instrumentAgent.systemPrompt());
    const task = promptSections(mainAgent.systemPrompt());

    const howYouWork = withoutBullets(chat.get("How you work"), [
      "You do no lasting work yourself",
      "Files you may touch yourself",
      "Stay short.",
      ...(foreground ? ["One chat, many tasks.", "Never take turns"] : []),
    ]);
    const memory = withoutBullets(chat.get("Memory"), [
      "A message that asks for work and tells you something standing",
    ]);
    const tasks = tasksSection(chat.get("Tasks"));
    const toolsUsage = withoutBullets(task.get("Tools Usage Guidance"), [
      `Use the \`${TOOL_EXPLANATION_PARAM_NAME}\` parameter`,
      `Every call carries an \`${TOOL_ACTIVITY_PARAM_NAME}\``,
      "When an answer would be long, structured, or worth keeping",
    ]);
    const selfFolder = `- The home folder is read-only through its mount, and a folder inside it is not: \`${TASK_COMMAND.name} folder self --add ${MOUNT.attachedFolders}/<home>/<folder>\` gives you read and write on it, at the path the command prints. Use it when the work writes there; never for the whole home.`;

    return [
      foreground
        ? `You are ${APP_NAME}: the one agent the user talks to in this app. You do the work yourself, with your own files, shell, browser, web search, and skills, here in this conversation: every job, quick or long, is done in your reply, and there is nothing in the background to hand it to.`
        : `You are ${APP_NAME}: the one agent the user talks to in this app. You do the work yourself, with your own files, shell, browser, web search, and skills, and you keep this conversation answering: what takes seconds you do on the spot, and what is multi-step or slow you fork to the background, where a copy of you carries it out with this conversation in hand while you keep answering here. The user never sees a background run; they see you.`,
      `# How you work\n${[
        foreground
          ? `- Do the work yourself, in this reply, whatever its size: an answer, a file, a search, a page, a script, a build, research across several sources. Say in a line what you are doing, do it, and say what came of it. Where a section below says a task does something, you do it yourself, here. Keep replies terse: a line or two of text around the work.`
          : `- Do it yourself when it takes seconds: an answer, a file read or written, a search, a page looked at, a command or a short script, anything a handful of tool calls finishes, is yours, in this reply. Fork it to the background when it is multi-step or slow (many files, a build, research across several sources, a long download or install, anything that would keep the user waiting): \`${TASK_COMMAND.name} new\`, and you keep answering while it runs. Where a section below says a task does something, you do it yourself, or fork it when it is slow; a fork needs no brief. Never wait on background work inside a turn, no sleeping and no polling: you are told when it finishes, as a note at the start of a later turn. Keep replies terse: a line or two of text around the work.`,
        howYouWork,
      ].join("\n")}`,
      foreground
        ? `# Doing the work\n${[
            `- There is no background here and no task to start: whatever the user asks, you carry out in this conversation, start to finish, however many steps it takes.`,
            selfFolder,
          ].join("\n")}`
        : dedent`
            # Background work
              ${TASK_COMMAND.name} new --name '<title>' <<'EOF'
              <what to do now, in a line or a few>
              EOF
            - \`${TASK_COMMAND.name} new\` forks you: a copy of you that starts with this conversation as it stands (the user's words, your memories, what you already found), works in this same folder, and reaches your folders at the same paths. So stdin says what to do now and repeats none of the background. It is one of this chat's tasks: it reports back the way a task does, and \`${TASK_COMMAND.name} send\`, \`stop\`, \`show\` and \`log\` reach it.
            - \`--folder ${MOUNT.attachedFolders}/<home>/<folder>\` gives a fork read and write on a folder inside the home folder, \`--tab <id>\` hands it a tab of the user's, and \`--app <slug>\` names a connected app it uses. Always pass stdin through the quoted heredoc.
            - \`${TASK_COMMAND.name} new --fresh\` is only for a job unrelated to this conversation: it starts with a clean context, so its stdin is a whole brief.
            ${selfFolder}
          `,
      section("Chats", chat),
      `# Memory\n${memory.trimEnd()}\n${
        foreground
          ? `- A message that asks for work and tells you something standing about the user along the way ("I'm vegetarian, so find me dinners") gets the save first, then the work, in the same reply. Never tell the user you have remembered something you have not saved: the line and the save go together, or neither does.`
          : `- A message that asks for work and tells you something standing about the user along the way ("I'm vegetarian, so find me dinners") gets the save first, then the work. When the work is a fork, the save and the fork go in one command, the save first (\`memory save decaf-only <<'EOF'\` ... \`EOF\`, then \`${TASK_COMMAND.name} new\` with its own heredoc), because your turn ends the moment a fork starts. Never tell the user you have remembered something you have not saved: the line and the save go together, or neither does.`
      }`,
      foreground ? "" : `# Tasks\n${tasks}`,
      appsSection(section("Apps", chat)),
      foreground ? "" : section("When a task finishes", chat),
      dedent`
        # Your folder
        Your working directory is this chat's own folder (\`${MOUNT.task}\`): \`${F.work}/\` for scratch, scripts, and what you build, \`${F.attachments}/\` for the files the user sent. It is a package root, so \`${PNPM_COMMAND.name} add\` there resolves anywhere inside it. A finished file the user should keep goes where they said, or in the workspace folder (\`${MOUNT.attachedFolders}/Instrument\`) in a subfolder named for the job, placed in one \`cp\` or \`mv\` once you have checked it. Use relative paths for your own folder and mount paths for the rest, never host paths.
      `,
      section("Your Role: Automation on the User's Behalf", task),
      importantLines(mainAgent.systemPrompt()),
      section("Files you write", task),
      section("Sources in what you write", task),
      `# Tools Usage Guidance\n${toolsUsage}`,
      section("Scripts and Running Code", task),
      section("File Changes", task),
      section("How you speak", chat),
    ]
      .map((part) => part.trim())
      .filter(Boolean)
      .join("\n\n");
  };

  return {
    getMessages: async ({ sessionId, taskId }) => {
      const now = getCurrentDate();

      const systemMessage = createSystemMessage({
        agentName: name,
        now,
        sessionId,
        text: systemPrompt(),
      });

      const attached = assignAttachedMounts(await folderReach(taskId));
      const foldersText =
        attached.length > 0
          ? buildAttachedFoldersText({
              folders: attached.map(({ folder, mountPoint }) => {
                const access = effectiveFolderAccess(folder);
                return {
                  access,
                  mountPoint,
                  path: folder.path,
                  writableInside:
                    access === "read-only" &&
                    folder.access === "read-write" &&
                    folderHoldsWorkspace(folder.path),
                };
              }),
              intro:
                "These are the user's folders this conversation reaches: their home folder, the workspace folder where results go when nobody said where, and any folder they sent or filed the conversation's topic with. Each is mounted for you at the path shown:",
            })
          : `No folder is mounted for you yet. Work that needs the user's files needs one first; ask for it with ${agentTools.RequestFolder.name}. Folders attached later are announced on the message they arrive with.`;

      const userMessage = createContextMessage({
        agentName: name,
        now,
        sessionId,
        textParts: [
          getSystemInfoText(),
          await getUserText(),
          foldersText,
          await buildAppsContextText(),
          await buildAvailableSkillsContext(),
        ],
      });

      return [systemMessage, userMessage];
    },
    onFinish: () => Promise.resolve(),
    onStart: () => Promise.resolve(),
    shouldContinue: shouldContinueAfterHandingOff,
    systemPrompt,
  };
});

/**
 * The chat's Tasks section as the one agent reads it: its command forms with
 * \`new\` as the fork, and without the bullets on writing a brief, handing a
 * task folders and files, and the task's skills and links, none of which a
 * fork needs. A brief is still how \`new --fresh\` starts, which the
 * Background work section says.
 */
function tasksSection(body: string | undefined): string {
  if (body === undefined) {
    throw new Error("one agent: no Tasks section to compose from");
  }
  const bullets = body.indexOf("\n- ");
  const forms = body.slice(0, bullets);
  const newForm = /^ {2}task new [^\n]*\n {2}<the brief[^\n]*\n/m;
  if (!newForm.test(forms)) {
    throw new Error("one agent: no `task new` form to replace");
  }
  return `${forms.replace(
    newForm,
    `  ${TASK_COMMAND.name} new --name '<title>' [--folder <mount>/<folder>[:rw|:ro]]... [--file <path>]... [--app <slug>]... [--tab <id>]... [--fresh] <<'EOF'\n  <what to do now>\n`,
  )}${withoutBullets(body.slice(bullets), [
    "Brief a task the way",
    "Say what, not how.",
    "A finished task hands you its last message whole",
    "Skills: a task has skills",
    "A link the user gave you",
    "Always pass the brief",
    "Folders: the user's home folder",
    "Files: a file the user sends",
  ])}`;
}

/**
 * The chat's Apps section with the two places it sends app work to a task
 * made the one agent's own: the research for an unknown service's endpoint,
 * and a call that changes something.
 */
function appsSection(text: string): string {
  return [
    [
      "`task new` a short research task that finds the service's MCP endpoint or API base and how it signs in, then write the folder from what it reports.",
      "look up the service's MCP endpoint or API base and how it signs in, then write the folder from what you found.",
    ],
    [
      "is a task's, however small: `task new` with the app on the command as `--app <slug>`, never only in the brief, since a task reaches the apps it was handed and no other.",
      "is made only for a change the user asked for, and you make it yourself.",
    ],
    [
      "goes to a task with `--app linear`, and the page only tells you which issue.",
      "goes through the app, and the page only tells you which issue.",
    ],
  ].reduce((composed, [from = "", to = ""]) => {
    if (!composed.includes(from)) {
      throw new Error(`one agent: no "${from}" in the Apps section to replace`);
    }
    return composed.replace(from, to);
  }, text);
}

/** A rendered prompt's top-level (`# `) sections by heading, each body as written. */
function promptSections(text: string): Map<string, string> {
  const sections = new Map<string, string>();
  for (const chunk of text.split(/^# /m).slice(1)) {
    const newline = chunk.indexOf("\n");
    sections.set(chunk.slice(0, newline).trim(), chunk.slice(newline + 1));
  }
  return sections;
}

/** One section whole, under its heading; a section missing from the source throws, so a renamed heading fails the build's tests rather than the prompt. */
function section(heading: string, sections: Map<string, string>): string {
  const body = sections.get(heading);
  if (body === undefined) {
    throw new Error(`one agent: no "# ${heading}" section to compose from`);
  }
  return `# ${heading}\n${body}`;
}

/**
 * A section's body without the top-level bullets that open with any of
 * `prefixes`. A bullet runs to the next line that starts one; its indented
 * continuation lines go with it. Each prefix has to match a bullet, so an
 * edit to the source that renames one fails loudly.
 */
function withoutBullets(body: string | undefined, prefixes: string[]): string {
  if (body === undefined) {
    throw new Error("one agent: a section to compose from is missing");
  }
  const chunks = body.split(/\n(?=- )/);
  for (const prefix of prefixes) {
    if (!chunks.some((chunk) => chunk.startsWith(`- ${prefix}`))) {
      throw new Error(`one agent: no bullet opening "${prefix}" to drop`);
    }
  }
  return chunks
    .filter(
      (chunk) => !prefixes.some((prefix) => chunk.startsWith(`- ${prefix}`)),
    )
    .join("\n");
}

/** The task agent's standing refusals, which open with `IMPORTANT:`. */
function importantLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => line.startsWith("IMPORTANT: "))
    .join("\n");
}
