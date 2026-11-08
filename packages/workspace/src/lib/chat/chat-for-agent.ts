import path from "node:path";

import { APP_NAME } from "@instrument-org/shared";

import {
  CHAT_FILE_NAME,
  MEMORY_FOLDER_NAME,
  PROJECT_FILE_NAME,
  PROJECTS_FOLDER_NAME,
  SKILLS_FOLDER_NAME,
} from "../../constants";
import { type ChatId } from "../../schemas/chat-id";
import { chatTitle } from "../chat-info";
import { ChatReads } from "../chat-reads";
import { pathIsWithin } from "../path-is-within";
import { chatDir, chatOwnFolder, sessionOfChat } from "../record-folders";
import { workDir } from "../work-dir";
import { getWorkspaceConfig } from "../workspace-config";
import { chatFolderTheyOpen, outputFolderPath } from "./output-folder";
import { listProjects } from "./projects";

/** Where one chat's things are on this computer, for telling another agent or a developer about it. */
export interface ChatPlaces {
  /** The chat's own folder under `Chats/`, when it is one the person opens. */
  chatFolder?: string;
  id: ChatId;
  /** The person's Instrument folder, when the workspace is one they picked. */
  instrumentFolder?: string;
  /** The project the chat is filed under, and its folder when the person opens it. */
  project?: { folder?: string; name: string };
  recordsFolder: string;
  title: string;
  workFolder: string;
}

/** Reads where a chat's things are. */
export async function chatPlaces(id: ChatId): Promise<ChatPlaces> {
  const records = chatDir(id);
  const { rootDir } = getWorkspaceConfig();
  // A workspace kept in the app's own data is no folder the person opens,
  // and none of its folders is any use to name.
  const instrumentFolder = pathIsWithin(rootDir, outputFolderPath())
    ? rootDir
    : undefined;
  const name = await projectName(id);
  return {
    chatFolder: chatFolderTheyOpen(chatOwnFolder(records)),
    id,
    instrumentFolder,
    project:
      name === undefined
        ? undefined
        : {
            folder:
              instrumentFolder &&
              path.join(instrumentFolder, PROJECTS_FOLDER_NAME, name),
            name,
          },
    recordsFolder: records,
    title: (await chatTitle(id)) ?? "Untitled",
    workFolder: workDir(id),
  };
}

/** The name of the project a chat is filed under, if it is. */
async function projectName(id: ChatId): Promise<string | undefined> {
  const sessionId = sessionOfChat(id);
  if (!sessionId) {
    return undefined;
  }
  const session = await ChatReads.session({ chatId: id, sessionId });
  const filed = session.isOk() ? session.value.project : undefined;
  if (filed === undefined) {
    return undefined;
  }
  return (await listProjects()).find((entry) => entry.id === filed)?.name;
}

const folder = (place: string) => `${place}${path.sep}`;

/**
 * What the person pastes to another agent to hand it a chat: what the app
 * is, and what each of the chat's folders has, so it can read the
 * conversation and find what the chat made without asking.
 */
export function chatForAgentText(places: ChatPlaces): string {
  const blocks = [
    `This is a chat from ${APP_NAME}, a desktop app where a person works with an AI agent on their own computer. They copied it so you can pick up from what it did.`,
    [
      `Chat: ${places.title}`,
      places.project && `Project: ${places.project.name}`,
    ]
      .filter(Boolean)
      .join("\n"),
  ];
  if (places.chatFolder) {
    blocks.push(
      [
        `Its folder: ${folder(places.chatFolder)}`,
        `  ${CHAT_FILE_NAME} there is the whole conversation in Markdown. Read it first. ${APP_NAME} rewrites it as the chat goes on, so changes to it won't last.`,
        "  Everything else there is what the chat made.",
      ].join("\n"),
    );
  }
  if (places.project?.folder) {
    blocks.push(
      [
        `Its project's folder: ${folder(places.project.folder)}`,
        `  ${PROJECT_FILE_NAME} there has the standing instructions this chat followed. A chat filed under a project saves its lasting files here.`,
      ].join("\n"),
    );
  }
  blocks.push(
    [
      `Its work folder: ${folder(places.workFolder)}`,
      "  Scratch space on this computer: downloads, drafts and in-between files the chat didn't keep. It may not exist if the chat left nothing there.",
    ].join("\n"),
  );
  if (places.instrumentFolder) {
    blocks.push(
      `The person's ${APP_NAME} folder is ${folder(places.instrumentFolder)}. ${MEMORY_FOLDER_NAME}/ there has one Markdown file per thing ${APP_NAME} remembers about them, and ${SKILLS_FOLDER_NAME}/ has the skills its agent uses. Leave .instrument/ alone, since it has the app's own records.`,
    );
  }
  return blocks.join("\n\n");
}

/** What a developer pastes to a coding agent about a chat, beyond what an agent the person uses needs. */
export function chatDeveloperDetailsText(
  places: ChatPlaces,
  more: {
    app: string;
    computer: string;
    mainThread?: string;
    startedWith?: string;
  },
): string {
  return [
    `Chat: ${places.title}`,
    `Chat ID: ${places.id}`,
    places.chatFolder && `Chat folder: ${folder(places.chatFolder)}`,
    `Work folder: ${folder(places.workFolder)}`,
    `Records folder: ${folder(places.recordsFolder)}`,
    "  One log per thread per computer, settings, and attachments.",
    places.project && `Project: ${places.project.name}`,
    more.mainThread && `Main thread: ${more.mainThread}`,
    more.mainThread &&
      "  The chat's own conversation. Each task is a thread of its own beside it.",
    `App: ${more.app}${more.startedWith ? `, chat started on ${more.startedWith}` : ""}`,
    `Computer: ${more.computer}`,
  ]
    .filter(Boolean)
    .join("\n");
}
