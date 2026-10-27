import { type SessionMessagePart } from "../schemas/session/message-part";

type DataPartType = SessionMessagePart.DataPart["type"];

// How each harness data part surfaces in the chat stream. Single source of
// truth for visibility, shared by `renderDataPart`, `isVisibleAssistantPart`,
// and `isRenderableInlinePart` so the three can't drift apart.
// - "always": user-facing card, counts as visible content
// - "dev": developer-mode-only debug peek, not counted as visible content
// - "hidden": never rendered (surfaced to the model, not the user)
export type DataPartVisibility = "always" | "dev" | "hidden";

const DATA_PART_DISPLAY: Record<DataPartType, DataPartVisibility> = {
  "data-appEvent": "always",
  // The places the user marked in their files, as the pills they sent.
  "data-asks": "always",
  "data-folderChanges": "always",
  "data-permissionAnswer": "always",
  // The card the question was asked on shows the answer.
  "data-questionAnswer": "hidden",
  // The note over the reply box that asked for it is gone once it lands.
  "data-signedIn": "hidden",
  "data-attachments": "hidden",
  // Deliberately not "always". This part is a persisted record of what was
  // running when the turn began, and a card in the transcript saying "2 still
  // running" is wrong the moment one stops -- the same staleness that kept live
  // status out of tool results. The header pill is the live surface; this is
  // context for the model, and a debug peek for us.
  "data-backgroundProcesses": "dev",
  "data-browserStatus": "dev",
  // Developer-mode only, deliberately. What happens here is a rollover, not a
  // compaction: assembly stops sending the model's own earlier turns and
  // carries the user's across verbatim, with nothing summarized. Any wording
  // faithful to that is a wording about our request assembly, which is not a
  // thing to hand a reader mid-task, and the familiar word for it promises a
  // summary that does not exist. The user-facing treatment belongs with the
  // summarizing compaction it would be describing.
  "data-contextRollover": "dev",
  // Developer-mode only, like the rollover: what the model is sent of old tool
  // results is our request assembly, and the transcript still shows them.
  "data-toolResultsCleared": "dev",
  "data-dateChange": "dev",
  "data-environmentChange": "dev",
  // Retired, and shown to everyone rather than to developers, which is the
  // opposite of where it ended up before it was deleted. It was demoted to
  // "dev" because it was a live change card nobody wanted; what it is now is
  // the only record a pre-fence conversation has of what a turn produced, and
  // the person who wants that is the person whose task it is.
  "data-fileChanges": "always",
  // Words the chat wrote to one of its tasks: the assignment a fork starts
  // on, and what it sent later. Shown in the task's transcript, where they
  // are the reason for everything that follows.
  "data-fromChat": "always",
  "data-intent": "dev",
  // The reason a session woke when a command it left running ended. Like a
  // task's finish in the chat, the reply that follows says what came of it,
  // so the note itself is a developer's peek.
  "data-jobEvent": "dev",
  "data-maxSteps": "dev",
  // What the agent is told it remembers about the user. Context for the
  // model; the user's copy is the Memory section of Settings.
  "data-memory": "dev",
  // The same treatment the date correction gets, and for the same reason: a
  // note telling the model how long the user was away, which the user knows
  // better than the model does.
  "data-messageGap": "dev",
  // Shown to everyone, unlike the rollover above it. The model a task runs on
  // is the user's own choice, so naming the moment it changed describes
  // something they did rather than something our assembly did.
  "data-modelChange": "always",
  // The max-steps treatment, for now: a developer's peek at the note the next
  // turn carries. What a reader of a chat gets is the reply stopping mid-word,
  // which is not enough; the card that says so is still to design.
  "data-outputLimit": "dev",
  // Drawn by the chat stream over the user's bubble, not in the part's place
  // under it.
  "data-reply": "hidden",
  // What the turn did to the person's skills, apps and memories, from its own
  // writes; see `setup-changes.ts`.
  "data-setupChanges": "always",
  // What changed in skills and apps since the session last heard, for the
  // agent: the person was told by the chat that made each change.
  "data-setupNews": "dev",
  "data-skillMentions": "dev",
  // Shown for the same reason the folder note is: the change was made in a
  // conversation the reader of this transcript is not looking at, and it is
  // usually what the task had stopped and waited for.
  // The reason a chat woke, shown so a reply that follows nothing the
  // user typed has a visible cause.
  "data-taskEvent": "always",
  // What the agent is told about the chats around this one: the other
  // chats at the moment this one opened, and the topic this one is filed
  // under. Context for the model; the head of the chat is the user's copy.
  "data-chatContext": "dev",
  "data-topic": "dev",
  "data-workspaceInstructions": "dev",
  "data-unknown": "dev",
  "data-viewContext": "dev",
};

export function dataPartVisibility(
  part: SessionMessagePart.DataPart,
): DataPartVisibility {
  return declaredVisibility(part.type);
}

function declaredVisibility(type: string): DataPartVisibility {
  const declared: Record<string, DataPartVisibility | undefined> =
    DATA_PART_DISPLAY;

  return declared[type] ?? "hidden";
}
