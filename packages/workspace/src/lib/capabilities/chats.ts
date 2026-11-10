import { z } from "zod";

import {
  CHATS_ARE_THE_CHATS,
  CHATS_COMMAND,
} from "../../model-text/commands/chats-command";
import { type ChatId } from "../../schemas/chat-id";
import { recordChatChange } from "../chat-changes";
import { cappedTitle } from "../chat-folders/folder-name";
import {
  type Chat,
  chatById,
  chatRecordTitle,
  listChats,
  setChatProject,
  setChatStarred,
  unarchiveChat,
} from "../chat/chats";
import { archiveChatAndTabs, renameChatAndFolder } from "../chat/organize";
import { listProjects, type Project } from "../chat/projects";
import { PROJECTS_COMMAND } from "../../model-text/commands/projects-command";
import { resolveChat } from "../record-folders";
import { defineCapability } from "./define";
import { projectsInUse } from "./projects";

const NAME = CHATS_COMMAND.name;

/** Organizing the person's chats is the chat's, from what a task reports. */
const CHATS = { roleRefusal: CHATS_ARE_THE_CHATS, roles: ["chat"] } as const;

/** The word that files a chat under no project. */
const NO_PROJECT = "none";

const ListedChat = z.object({
  archived: z.boolean(),
  /** The day it began, YYYY-MM-DD. */
  began: z.string(),
  id: z.string(),
  /** The day anything last happened in it, YYYY-MM-DD. */
  last_activity: z.string(),
  /** Whether it has a name yet; one without shows its opening words. */
  named: z.boolean(),
  /** The project it is filed under, by name. */
  project: z.string().optional(),
  starred: z.boolean(),
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
    stdout: outcomes
      .filter((each) => !each.failed)
      .map((each) => `${each.said}\n`)
      .join(""),
  };
}

function outcomesText(outcomes: readonly Outcome[]) {
  return outcomes.map((each) => each.said).join("\n");
}

function day(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
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

const ids = z
  .array(z.string(), { error: `which chats? ${NAME} list names them.` })
  .min(1, `which chats? ${NAME} list names them.`);

/**
 * Runs one change over each chat named, in order: a chat that is not there
 * fails its own line and the rest go on.
 */
async function eachChat(
  named: readonly string[],
  change: (chat: Chat) => Promise<string>,
): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  for (const id of new Set(named)) {
    // An id is read off the records folder's names, so one that is not a
    // chat's is a slip to say, never a shape to refuse.
    const chatId = resolveChat(id as ChatId);
    const chat = chatId && (await chatById(chatId));
    outcomes.push(
      chat
        ? { failed: false, id, said: await change(chat) }
        : {
            failed: true,
            id,
            said: `no chat with the id ${id}. ${NAME} list names them.`,
          },
    );
  }
  return outcomes;
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
  }),
  name: "chats.list",
  output: z.array(ListedChat),
  async run({ archived, project, unnamed }, ctx) {
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
    return (await listChats())
      .filter(
        (chat) =>
          chat.archived === archived &&
          (!unnamed || !chat.titled) &&
          (under === undefined || (chat.project ?? null) === under),
      )
      .toSorted((a, b) => b.updatedAt - a.updatedAt)
      .map((chat) => {
        const name = chat.project && names.get(chat.project);
        return {
          archived: chat.archived,
          began: day(chat.createdAt),
          id: chat.id,
          last_activity: day(chat.updatedAt),
          named: chat.titled,
          ...(name ? { project: name } : {}),
          starred: chat.starred,
          ...(chat.id === ctx.chatId ? { this_chat: true as const } : {}),
          title: chat.title,
        };
      });
  },
  summary:
    "The user's chats, newest first: each one's id, the day it began and the day it was last active, its project, and its title.",
  surfaces: {
    cli: {
      help: `A chat's id is also its folder's name under $INSTRUMENT_CHATS, where what
was said in it can be read. A chat that began and was last active on the same
day was never come back to.`,
      words: ["chats", "list"],
    },
    script: {},
  },
  text: (chats) =>
    chats.length === 0
      ? "No chats match."
      : `${chats.length} ${chats.length === 1 ? "chat" : "chats"}, newest first (id, began, last active, title):\n${chats
          .map(
            (chat) =>
              `  ${chat.id}  ${chat.began}  ${chat.last_activity}  ${chat.project ? `[${chat.project}]  ` : ""}${chat.title}${chat.named ? "" : "  (unnamed)"}${chat.starred ? "  (starred)" : ""}${chat.this_chat ? "  (this chat)" : ""}`,
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
      if (
        before === undefined ||
        !(await renameChatAndFolder(chat.id, title))
      ) {
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

/** A command that sets one yes-or-no mark on each chat named. */
function markCapability({
  already,
  did,
  field,
  mark,
  summary,
  to,
  word,
}: {
  /** What a chat with nothing to change is said to be: "already archived". */
  already: string;
  /** What a line says was done: "Archived". */
  did: string;
  field: "archived" | "starred";
  mark: (chatId: ChatId) => Promise<boolean>;
  summary: string;
  to: boolean;
  word: string;
}) {
  return defineCapability({
    input: z.object({ ids }),
    name: `chats.${word}`,
    output: Outcomes,
    render: renderOutcomes,
    run: ({ ids: named }) =>
      eachChat(named, async (chat) => {
        if (chat[field] === to) {
          return `${chat.id} was ${already}: ${chat.title}`;
        }
        if (!(await mark(chat.id))) {
          throw new Error(`${word}: ${chat.id} could not be changed.`);
        }
        recordChatChange({ after: to, before: !to, chat: chat.id, field });
        return `${did} ${chat.id}: ${chat.title}`;
      }),
    summary,
    surfaces: {
      cli: { help: "", positional: ["ids"], words: ["chats", word] },
    },
    text: outcomesText,
    where: CHATS,
  });
}

export const chatsArchive = markCapability({
  already: "already archived",
  did: "Archived",
  field: "archived",
  mark: archiveChatAndTabs,
  summary: "Put chats away: out of the inbox, still there to find.",
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
  async run({ ids: named, project }) {
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
        throw new Error(`project: ${chat.id} could not be filed.`);
      }
      recordChatChange({ after, before, chat: chat.id, field: "project" });
      return `Filed ${chat.id} ${where}: ${chat.title}`;
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
