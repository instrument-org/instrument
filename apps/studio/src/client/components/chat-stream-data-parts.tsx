import {
  backgroundProcessesModelNote,
  dateChangeModelNote,
  environmentChangeModelNote,
  dataPartVisibility,
  isAddressableChatFilePath,
  jobEventModelNote,
  maxStepsModelNote,
  messageGapModelNote,
  outputLimitModelNote,
  type SessionMessagePart,
  setupNewsModelNote,
} from "@instrument-org/workspace/client";
import { type ReactNode } from "react";

export { dataPartVisibility };

import { FilePathsGrid } from "./agent-files-block";
import { AppEventNote } from "./app-event-note";
import { FolderChangesNote } from "./folder-changes-note";
import { ChatDevOnly } from "./dev-mode-card";
import { type RenderPartContext } from "./chat-stream-render-part";
import { PermissionAnswerNote } from "./permission-asks";
import { ModelChangeNote } from "./model-change-note";
import { ModelContextDebugCard } from "./model-context-debug-card";
import { SetupChangesNote } from "./setup-changes-note";
import { TaskEventNote } from "./task-event-note";
import { SentAsksNote } from "./window/ask-pills";

export function isDataPart(
  part: SessionMessagePart.Type,
): part is SessionMessagePart.DataPart {
  return part.type.startsWith("data-");
}

export function renderDataPart({
  ctx,
  part,
  pathsAlreadyShown,
  stateNote,
}: {
  ctx: RenderPartContext;
  part: SessionMessagePart.DataPart;
  /**
   * Files this message already puts on screen, so the retired file-changes grid
   * does not draw a second copy of one. Computed once for the message rather
   * than per part.
   */
  pathsAlreadyShown?: ReadonlySet<string>;
  /**
   * What the model heard of a `state` part, from the stream's `stateNotes`:
   * none when it heard nothing new, and then there is no card either.
   */
  stateNote: string | undefined;
}): ReactNode {
  const visibility = dataPartVisibility(part);
  if (
    visibility === "hidden" ||
    (visibility === "dev" && !ctx.isDeveloperMode)
  ) {
    return null;
  }

  // The narrow transcript draws a developer note as one line.
  const compact = ctx.presentation === "chat";
  const noteClassName = compact ? "mt-1" : "mt-2";

  switch (part.type) {
    case "data-appEvent": {
      if (ctx.presentation === "chat") {
        return ctx.isDeveloperMode ? (
          <ChatDevOnly key={part.metadata.id}>
            <AppEventNote data={part.data} />
          </ChatDevOnly>
        ) : null;
      }
      return <AppEventNote data={part.data} key={part.metadata.id} />;
    }
    case "data-permissionAnswer": {
      return <PermissionAnswerNote data={part.data} key={part.metadata.id} />;
    }
    case "data-asks": {
      return <SentAsksNote data={part.data} key={part.metadata.id} />;
    }
    case "data-folderChanges": {
      return (
        <FolderChangesNote
          data={part.data}
          isDeveloperMode={ctx.isDeveloperMode}
          key={part.metadata.id}
        />
      );
    }
    case "data-attachments":
    case "data-questionAnswer":
    case "data-reply":
    case "data-signedIn": {
      return null;
    }
    case "data-backgroundProcesses": {
      return (
        <ModelContextDebugCard
          className={noteClassName}
          compact={compact}
          key={part.metadata.id}
          text={backgroundProcessesModelNote(part.data)}
        />
      );
    }
    case "data-browserStatus":
    case "data-topic":
    case "data-viewContext":
    case "data-workspaceInstructions": {
      return stateNote === undefined ? null : (
        <ModelContextDebugCard
          className={noteClassName}
          compact={compact}
          key={part.metadata.id}
          text={stateNote}
        />
      );
    }
    case "data-chatContext": {
      return (
        <ModelContextDebugCard
          className={noteClassName}
          compact={compact}
          key={part.metadata.id}
          text={
            part.data.chats.length === 0
              ? "The first chat"
              : `Other chats: ${part.data.chats.map((chat) => chat.title).join(" · ")}`
          }
        />
      );
    }
    case "data-contextRollover": {
      return (
        <ModelContextDebugCard
          className={noteClassName}
          compact={compact}
          key={part.metadata.id}
          text={`Context rollover: dropped ${part.data.droppedMessages} messages, retained ${part.data.retainedUserMessages} user messages`}
        />
      );
    }
    case "data-dateChange": {
      return (
        <ModelContextDebugCard
          className={noteClassName}
          compact={compact}
          key={part.metadata.id}
          text={dateChangeModelNote(part.data)}
        />
      );
    }
    case "data-environmentChange": {
      return (
        <ModelContextDebugCard
          className={noteClassName}
          compact={compact}
          key={part.metadata.id}
          text={environmentChangeModelNote(part.data) ?? ""}
        />
      );
    }
    case "data-fileChanges": {
      // Only the `output/` folder tasks wrote deliverables to when this part
      // was live. The watcher behind it reported everything a turn touched,
      // and the overwhelming majority of that is `work/`: the scripts the
      // agent wrote to make the deliverable, not the deliverable. Showing
      // those is what made the card worth deleting in the first place.
      //
      // A deleted file has nothing to show, and one the reply already fenced or
      // linked is on screen already.
      const paths = part.data.files
        .filter(
          (file) =>
            file.status !== "deleted" &&
            file.filePath.startsWith("output/") &&
            isAddressableChatFilePath(file.filePath) &&
            pathsAlreadyShown?.has(file.filePath) !== true,
        )
        .map((file) => file.filePath);

      return paths.length === 0 ? null : (
        <FilePathsGrid key={part.metadata.id} paths={[...new Set(paths)]} />
      );
    }
    case "data-fromChat": {
      return (
        <ModelContextDebugCard
          className={noteClassName}
          compact={compact}
          key={part.metadata.id}
          text={`From the chat: ${part.data.text}`}
        />
      );
    }
    case "data-intent": {
      return (
        <ModelContextDebugCard
          className={noteClassName}
          compact={compact}
          key={part.metadata.id}
          text={part.data.text}
        />
      );
    }
    case "data-maxSteps": {
      return (
        <ModelContextDebugCard
          className={noteClassName}
          compact={compact}
          key={part.metadata.id}
          text={maxStepsModelNote(part.data)}
        />
      );
    }
    case "data-memory": {
      const count = part.data.memories.length + part.data.more;
      const texts = part.data.memories.map((memory) => memory.text);
      const text =
        part.data.tells === "changes"
          ? `Memory changed: ${[
              ...texts,
              ...part.data.forgotten.map((name) => `forgot ${name}`),
            ].join(" · ")}`
          : count === 0
            ? "Memory is empty"
            : `Memory (${count}): ${texts.join(" · ")}`;
      return (
        <ModelContextDebugCard
          className={noteClassName}
          compact={compact}
          key={part.metadata.id}
          text={text}
        />
      );
    }
    case "data-messageGap": {
      return (
        <ModelContextDebugCard
          className={noteClassName}
          compact={compact}
          key={part.metadata.id}
          text={messageGapModelNote(part.data)}
        />
      );
    }
    case "data-modelChange": {
      return <ModelChangeNote data={part.data} key={part.metadata.id} />;
    }
    case "data-outputLimit": {
      return (
        <ModelContextDebugCard
          className={noteClassName}
          compact={compact}
          key={part.metadata.id}
          text={outputLimitModelNote(part.data)}
        />
      );
    }
    case "data-setupNews": {
      return (
        <ModelContextDebugCard
          className={noteClassName}
          compact={compact}
          key={part.metadata.id}
          text={setupNewsModelNote(part.data)}
        />
      );
    }
    case "data-setupChanges": {
      return (
        <SetupChangesNote changes={part.data.changes} key={part.metadata.id} />
      );
    }
    case "data-jobEvent": {
      return (
        <ModelContextDebugCard
          className={noteClassName}
          compact={compact}
          key={part.metadata.id}
          text={jobEventModelNote(part.data)}
        />
      );
    }
    case "data-skillMentions": {
      return (
        <ModelContextDebugCard
          className={noteClassName}
          compact={compact}
          key={part.metadata.id}
          text={`Skills mentioned: ${part.data.names.join(", ")}`}
        />
      );
    }
    case "data-taskEvent": {
      // The conversation was woken by it; what it says about it is its reply.
      // A note the app's quit or the user's stop left wakes nothing, so no
      // reply follows it and it is the only word in the chat that the task
      // ended.
      if (
        ctx.presentation === "chat" &&
        !part.data.events.some(
          (event) => event.stoppedBy === "app" || event.stoppedBy === "person",
        )
      ) {
        return ctx.isDeveloperMode ? (
          <ChatDevOnly key={part.metadata.id}>
            <TaskEventNote data={part.data} />
          </ChatDevOnly>
        ) : null;
      }
      return <TaskEventNote data={part.data} key={part.metadata.id} />;
    }
    case "data-unknown": {
      // Not a failure the reader can do anything about, so it stays a
      // developer-mode row: the part is from a build that wrote a shape this one
      // cannot read, and the reason is the useful half.
      return (
        <ModelContextDebugCard
          className={noteClassName}
          compact={compact}
          key={part.metadata.id}
          text={`Could not read a ${part.data.originalType} part: ${part.data.reason}`}
        />
      );
    }
    default: {
      // A new data-part type must be handled above (and classified in
      // DATA_PART_DISPLAY); `satisfies never` fails the build otherwise.
      //
      // Returning the part instead of null is what made an unrecognized type
      // fatal rather than invisible: React was handed a message part as a child
      // and took the whole transcript down with it. Unreachable now that
      // `declaredVisibility` hides what it does not recognize, and cheap to
      // keep correct anyway.
      part satisfies never;
      return null;
    }
  }
}

/**
 * How a part type is classified, or "hidden" for one this build has never heard
 * of.
 *
 * The transcript draws what earlier builds persisted, and a part outlives the
 * feature that wrote it: `data-gitCommit` is still sitting in tasks from before
 * git-based file versioning was removed. Parts are cast to their schema type on
 * read rather than parsed, so nothing upstream filters those out, and the record
 * cannot describe them either -- it is keyed by the types that exist now. So the
 * lookup is widened here, and a type with no classification draws nothing.
 */
