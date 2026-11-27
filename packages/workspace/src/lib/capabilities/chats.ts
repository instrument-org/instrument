import path from "node:path";
import { sleep } from "radashi";
import { z } from "zod";

import { FOLDER_VARIABLES, PROJECT_FILE_NAME } from "../../constants";
import {
  CHATS_ARE_THE_CHATS,
  CHATS_COMMAND,
} from "../../model-text/commands/chats-command";
import { type ChatId } from "../../schemas/chat-id";
import { recordChatChange } from "../chat-changes";
import { cappedTitle } from "../folder-name";
import {
  type Chat,
  chatById,
  chatIsWorking,
  chatRecordTitle,
  listChats,
  markChatRead,
  markChatUnread,
  renameChat,
  setChatProject,
  setChatStarred,
  unarchiveChat,
} from "../chat/chats";
import { ChatStateSchema, chatStateOf, day } from "../chat/chat-state";
import { type ArchivedChat, archiveChatAndTabs } from "../chat/organize";
import { listProjects, type Project, projectsDir } from "../chat/projects";
import {
  chatLatestWords,
  chatStandingWords,
} from "../../model-text/notes/chat-state-model-text";
import { PROJECTS_COMMAND } from "../../model-text/commands/projects-command";
import { hasSomethingToStop, stopChat } from "../chat/stop-chat";
import { resolveChat } from "../record-folders";
import { shellPath } from "../shell-path";
import { getWorkspaceActorRef } from "../workspace-actor-ref";
import { getWorkspaceConfig } from "../workspace-config";
import { TASK_COMMAND } from "../../model-text/commands/task-command";
import { defineCapability } from "./define";
import { projectsInUse } from "./projects";

const NAME = CHATS_COMMAND.name;

/** Organizing the person's chats is the chat's, from what a task reports. */
const CHATS = { roleRefusal: CHATS_ARE_THE_CHATS, roles: ["chat"] } as const;

/** The word that files a chat under no project. */
const NO_PROJECT = "none";

const ListedChat = ChatStateSchema.extend({
  /** The day it began, YYYY-MM-DD. */
  began: z.string(),
  id: z.string(),
  /** Whether it has a name yet; one without shows its opening words. */
  named: z.boolean(),
  /** The project it is filed under, by name. */
  project: z.string().optional(),
  /** Set on the chat running the command, so a request about another chat never lands on it. */
  this_chat: z.literal(true).optional(),
  title: z.string(),
});

/** What a change came to for one chat: done, or why not. */
const Outcome = z.object({
  failed: z.boolean(),
  id: z.string(),
  said: z.string(),
});
type Outcome = z.output<typeof Outcome>;

const Outcomes = z.array(Outcome);

/** Each chat's line: what was done on stdout, each failure on stderr, exit 1 when any failed. */
function renderOutcomes(outcomes: readonly Outcome[]) {
  const failed = outcomes.filter((each) => each.failed);
  return {
    exitCode: failed.length > 0 ? 1 : 0,
    stderr: failed.map((each) => `${NAME}: ${each.said}\n`).join(""),
    stdout:
      outcomes.length === 0
        ? "No chat to change.\n"
        : outcomes
            .filter((each) => !each.failed)
            .map((each) => `${each.said}\n`)
            .join(""),
  };
}

function outcomesText(outcomes: readonly Outcome[]) {
  return outcomes.map((each) => each.said).join("\n");
}

function namedProjects(projects: readonly Project[]): string {
  return projects.length === 0
    ? "There are no projects yet."
    : `The projects: ${projects.map((project) => project.name).join(", ")}.`;
}

/** The project a word names, by its name whatever its case, or by its id. */
function projectNamed(projects: readonly Project[], word: string) {
  const lowered = word.toLowerCase();
  return projects.find(
    (project) => project.id === word || project.name.toLowerCase() === lowered,
  );
}

/** How many lines of a project's instructions the chat filing itself under it is shown. */
const INSTRUCTIONS_LINES_SHOWN = 5;

/**
 * What the chat running the command is told when it files itself under a
 * project, since the project's note reaches it only with the next message:
 * the project's folder, and how its instructions begin.
 */
function filedHere(project: Project): string {
  const folder = shellPath(path.join(projectsDir(), project.name));
  const lines = project.instructions?.trim().split("\n") ?? [];
  const instructions =
    lines.length === 0 || lines[0] === ""
      ? `It has no ${PROJECT_FILE_NAME}.`
      : `Its ${PROJECT_FILE_NAME}, which every chat under it follows, begins:\n${lines.slice(0, INSTRUCTIONS_LINES_SHOWN).join("\n")}${lines.length > INSTRUCTIONS_LINES_SHOWN ? `\n[The rest is in ${folder}/${PROJECT_FILE_NAME}.]` : ""}`;
  return `This chat's project folder is ${folder}/, $${FOLDER_VARIABLES.project} from your next command. ${instructions}`;
}

const WHICH_CHATS = `which chats? ${NAME} list names them.`;

const ids = z.array(z.string(), { error: WHICH_CHATS }).min(1, WHICH_CHATS);

/**
 * Runs one change over each chat named, in order: a chat that is not there,
 * or whose change answers that it could not be made, fails its own line and
 * the rest go on.
 */
async function eachChat(
  named: readonly string[],
  change: (chat: Chat) => Promise<string | { couldNot: string }>,
): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  for (const id of new Set(named)) {
    // An id is read off the records folder's names, so one that is not a
    // chat's is a slip to say, never a shape to refuse.
    const chatId = resolveChat(id as ChatId);
    const chat = chatId && (await chatById(chatId));
    const came = chat
      ? await change(chat)
      : { couldNot: `no chat with the id ${id}. ${NAME} list names them.` };
    outcomes.push(
      typeof came === "string"
        ? { failed: false, id, said: came }
        : { failed: true, id, said: came.couldNot },
    );
  }
  return outcomes;
}

/** Where a chat stands and its latest line, after its title. */
function standingText(chat: z.output<typeof ListedChat>): string {
  const words = chatStandingWords(chat);
  const latest = chatLatestWords(chat);
  return `${words.length === 0 ? "" : `  (${words.join(", ")})`}${latest === "" ? "" : `  latest: ${latest}`}`;
}

export const chatsList = defineCapability({
  input: z.object({
    archived: z
      .boolean()
      .default(false)
      .describe("the chats put away, in place of the ones in the inbox"),
    project: z
      .string()
      .optional()
      .describe(`only the chats under this project, or "${NO_PROJECT}"`),
    unnamed: z
      .boolean()
      .default(false)
      .describe("only the chats that have no name yet"),
    unread: z
      .boolean()
      .default(false)
      .describe("only the unread chats, with any others asked for beside it"),
    waiting: z
      .boolean()
      .default(false)
      .describe("only the chats waiting on the user, in the same way"),
    working: z
      .boolean()
      .default(false)
      .describe("only the chats still working, in the same way"),
  }),
  name: "chats.list",
  output: z.array(ListedChat),
  async run({ archived, project, unnamed, unread, waiting, working }, ctx) {
    const projects = await listProjects();
    const names = new Map(projects.map((each) => [each.id, each.name]));
    let under: null | string | undefined;
    if (project !== undefined && project !== NO_PROJECT) {
      const found = projectNamed(projects, project);
      if (!found) {
        throw new Error(
          `no project named "${project}". ${namedProjects(projects.filter((each) => each.retired !== true))}`,
        );
      }
      under = found.id;
    } else if (project === NO_PROJECT) {
      under = null;
    }
    const asked = (chat: Chat) =>
      !(unread || waiting || working) ||
      (unread && chat.unread) ||
      (waiting && chat.status === "waiting") ||
      (working && chat.working);
    return (await listChats())
      .filter(
        (chat) =>
          chat.archived === archived &&
          (!unnamed || !chat.titled) &&
          asked(chat) &&
          (under === undefined || (chat.project ?? null) === under),
      )
      .toSorted((a, b) => b.updatedAt - a.updatedAt)
      .map((chat) => {
        const name = chat.project && names.get(chat.project);
        return {
          ...chatStateOf(chat),
          began: day(chat.createdAt),
          id: chat.id,
          named: chat.titled,
          ...(name ? { project: name } : {}),
          ...(chat.id === ctx.chatId ? { this_chat: true as const } : {}),
          title: chat.title,
        };
      });
  },
  summary:
    "The user's chats, newest first: each one's id, the day it began and the day it was last active, its project, its title, whether it is working, waiting on the user or unread, and its latest line.",
  surfaces: {
    cli: {
      help: `A chat's id is also its folder's name under $INSTRUMENT_CHATS, where what
was said in it can be read. A chat that began and was last active on the same
day was never come back to. The latest line is the one its row shows: the step it
is on while it works, its question while it waits, else its last reply. What
needs the user is list --unread --waiting.`,
      words: ["chats", "list"],
    },
    script: {},
  },
  text: (chats) =>
    chats.length === 0
      ? "No chats match."
      : `${chats.length} ${chats.length === 1 ? "chat" : "chats"}, newest first (id, began, last active, title, where it stands, latest line):\n${chats
          .map(
            (chat) =>
              `  ${chat.id}  ${chat.began}  ${chat.last_activity}  ${chat.project ? `[${chat.project}]  ` : ""}${chat.title}${chat.named ? "" : "  (unnamed)"}${chat.starred ? "  (starred)" : ""}${chat.this_chat ? "  (this chat)" : standingText(chat)}`,
          )
          .join("\n")}`,
  where: CHATS,
});

export const chatsRename = defineCapability({
  input: z.object({
    id: z.string({ error: `rename: which chat? ${NAME} list names them.` }),
    title: z
      .string({ error: "rename: a title is required." })
      .trim()
      .min(1, "rename: a title is required."),
  }),
  name: "chats.rename",
  output: Outcomes,
  render: renderOutcomes,
  run: ({ id, title }) =>
    eachChat([id], async (chat) => {
      const before = await chatRecordTitle(chat.id);
      const after = cappedTitle(title);
      if (before === undefined || !(await renameChat(chat.id, title))) {
        throw new Error(`rename: ${id} could not be renamed.`);
      }
      recordChatChange({
        after,
        before,
        chat: chat.id,
        field: "title",
      });
      return `Renamed ${id}: ${after}`;
    }),
  summary: "Name a chat, in a few words that say what it is about.",
  surfaces: {
    cli: {
      help: "",
      positional: ["id", "title"],
      rest: true,
      words: ["chats", "rename"],
    },
  },
  text: outcomesText,
  where: CHATS,
});

/** The chats a command's words name: their ids, or with `--all` every chat it would change. */
async function namedOf(
  { all = false, ids: named }: { all?: boolean; ids: readonly string[] },
  changes: (chat: Chat) => boolean,
): Promise<readonly string[]> {
  if (all) {
    if (named.length > 0) {
      throw new Error("--all takes every chat, so give no ids with it.");
    }
    return (await listChats()).filter(changes).map((chat) => chat.id);
  }
  if (named.length === 0) {
    throw new Error(WHICH_CHATS);
  }
  return named;
}

/** A command that sets one yes-or-no mark on each chat named. */
function markCapability({
  all,
  already,
  did,
  field,
  mark,
  notThisChat,
  summary,
  to,
  word,
}: {
  /** What `--all` takes in place of ids, for a mark set on every chat at once. */
  all?: string;
  /** What a chat with nothing to change is said to be: "already archived". */
  already: string;
  /** What a line says was done: "Archived". */
  did: string;
  field: "archived" | "starred" | "unread";
  /** Whether the mark was set, or what else setting it did, said after the line. */
  mark: (chatId: ChatId) => Promise<boolean | { also: readonly string[] }>;
  /** Why the chat running the command is left as it is, where marking it would end the turn marking it. */
  notThisChat?: string;
  summary: string;
  to: boolean;
  word: string;
}) {
  return defineCapability({
    input:
      all === undefined
        ? z.object({ ids })
        : z.object({
            all: z.boolean().default(false).describe(all),
            ids: z.array(z.string()).default([]),
          }),
    name: `chats.${word.replace("-", "_")}`,
    output: Outcomes,
    render: renderOutcomes,
    run: async (input, ctx) =>
      eachChat(
        await namedOf(input, (chat) => chat[field] !== to),
        async (chat) => {
          if (notThisChat !== undefined && chat.id === ctx.chatId) {
            return { couldNot: `${word}: ${chat.id} ${notThisChat}` };
          }
          if (chat[field] === to) {
            return `${chat.id} was ${already}: ${chat.title}`;
          }
          const marked = await mark(chat.id);
          if (!marked) {
            return { couldNot: `${word}: ${chat.id} could not be changed.` };
          }
          recordChatChange({ after: to, before: !to, chat: chat.id, field });
          const also =
            marked === true || marked.also.length === 0
              ? ""
              : ` (${marked.also.join(", ")})`;
          return `${did} ${chat.id}: ${chat.title}${also}`;
        },
      ),
    summary,
    surfaces: {
      cli: { help: "", positional: ["ids"], words: ["chats", word] },
    },
    text: outcomesText,
    where: CHATS,
  });
}

/** What archiving a chat stopped and closed, each only when it did. */
function archivedAlso({
  archived,
  asksClosed,
  stoppedWork,
  tabsClosed,
}: ArchivedChat) {
  return (
    archived && {
      also: [
        ...(stoppedWork ? ["its turn and tasks stopped"] : []),
        ...(asksClosed === 1 ? ["its open question closed"] : []),
        ...(asksClosed > 1 ? [`its ${asksClosed} open questions closed`] : []),
        ...(tabsClosed === 1 ? ["1 tab closed"] : []),
        ...(tabsClosed > 1 ? [`${tabsClosed} tabs closed`] : []),
      ],
    }
  );
}

export const chatsArchive = markCapability({
  already: "already archived",
  did: "Archived",
  field: "archived",
  mark: async (chatId) => archivedAlso(await archiveChatAndTabs(chatId)),
  notThisChat:
    "is this chat, which archiving would stop mid-turn; the user archives it.",
  summary:
    "Put chats away, as the user's own Archive does: out of the inbox, still there to find, and stopped where working or waiting on the user.",
  to: true,
  word: "archive",
});

export const chatsUnarchive = markCapability({
  already: "not archived",
  did: "Unarchived",
  field: "archived",
  mark: unarchiveChat,
  summary: "Bring chats back into the inbox.",
  to: false,
  word: "unarchive",
});

export const chatsStar = markCapability({
  already: "already starred",
  did: "Starred",
  field: "starred",
  mark: (chatId) => setChatStarred(chatId, true),
  summary: "Star chats.",
  to: true,
  word: "star",
});

export const chatsUnstar = markCapability({
  already: "not starred",
  did: "Unstarred",
  field: "starred",
  mark: (chatId) => setChatStarred(chatId, false),
  summary: "Take the star off chats.",
  to: false,
  word: "unstar",
});

export const chatsMarkRead = markCapability({
  all: "every unread chat",
  already: "already read",
  did: "Marked as read",
  field: "unread",
  mark: markChatRead,
  summary: "Mark chats as read, by id, or every unread chat with --all.",
  to: false,
  word: "mark-read",
});

export const chatsMarkUnread = markCapability({
  already: "already unread",
  did: "Marked as unread",
  field: "unread",
  mark: (chatId) => markChatUnread(chatId, { byUser: true }),
  summary:
    "Mark chats as unread, as the user's own Mark as Unread does: it holds until they come back to the chat.",
  to: true,
  word: "mark-unread",
});

/** How long `stop` waits to see the chats it stopped come to rest. */
const STOP_CONFIRM_MS = 3000;
const STOP_POLL_MS = 100;

export const chatsStop = defineCapability({
  input: z.object({ ids }),
  name: "chats.stop",
  output: Outcomes,
  render: renderOutcomes,
  async run({ ids: named }, ctx) {
    const stopped: ChatId[] = [];
    const outcomes = await eachChat(named, async (chat) => {
      if (chat.id === ctx.chatId) {
        return {
          couldNot: `stop: ${chat.id} is this chat; ending your turn ends it, and \`${TASK_COMMAND.name} stop\` a task of yours.`,
        };
      }
      if (!chat.working && !(await hasSomethingToStop(chat.id))) {
        return `${chat.id} was not working or waiting on the user: ${chat.title}`;
      }
      await stopChat(chat.id, {
        captureException: getWorkspaceConfig().captureException,
        workspaceRef: getWorkspaceActorRef(),
      });
      stopped.push(chat.id);
      return `Stopped ${chat.id}: ${chat.title}`;
    });
    // So a list read right after shows them as they are.
    const until =
      Date.now() + Math.min(STOP_CONFIRM_MS, ctx.remainingYieldMs() / 2);
    for (const id of stopped) {
      while ((await chatIsWorking(id)) && Date.now() < until) {
        await sleep(STOP_POLL_MS);
      }
    }
    return outcomes;
  },
  summary:
    "Stop chats that are working or waiting on the user, only ones the user asked to stop, as their own Stop does: the chat's turn and its tasks end where they are, what waits on the user closes, and what they did stays.",
  surfaces: {
    cli: { help: "", positional: ["ids"], words: ["chats", "stop"] },
  },
  text: outcomesText,
  where: CHATS,
});

export const chatsProject = defineCapability({
  input: z.object({
    ids,
    project: z.string({
      error: `project: which project, or "${NO_PROJECT}"? ${PROJECTS_COMMAND.name} names them.`,
    }),
  }),
  name: "chats.project",
  output: Outcomes,
  render: renderOutcomes,
  async run({ ids: named, project }, ctx) {
    const projects = await projectsInUse();
    const found =
      project === NO_PROJECT ? undefined : projectNamed(projects, project);
    if (project !== NO_PROJECT && !found) {
      throw new Error(
        `project: no project named "${project}", so nothing was filed. ${namedProjects(projects)}`,
      );
    }
    const after = found?.id ?? null;
    return eachChat(named, async (chat) => {
      const before = chat.project ?? null;
      const where = found ? `under ${found.name}` : "under no project";
      if (before === after) {
        return `${chat.id} was already ${where}: ${chat.title}`;
      }
      if (!(await setChatProject(chat.id, after))) {
        return { couldNot: `project: ${chat.id} could not be filed.` };
      }
      recordChatChange({ after, before, chat: chat.id, field: "project" });
      const filed = `Filed ${chat.id} ${where}: ${chat.title}`;
      return found && chat.id === ctx.chatId
        ? `${filed}\n${filedHere(found)}`
        : filed;
    });
  },
  summary: `File chats under a project that exists, or under "${NO_PROJECT}".`,
  surfaces: {
    cli: {
      help: "",
      positional: ["project", "ids"],
      words: ["chats", "project"],
    },
  },
  text: outcomesText,
  where: CHATS,
});
