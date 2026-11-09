import {
  dataPartVisibility,
  isAddressableChatFilePath,
  type SessionMessagePart,
} from "@instrument-org/workspace/client";
import { type ReactNode } from "react";

export { dataPartVisibility };

import { FilePathsGrid } from "../agent-files-block";
import { ChatChangesNote } from "../chat-changes-note";
import { FolderChangesNote } from "../folder-changes-note";
import { PermissionAnswerNote } from "../permission-asks";
import { SetupChangesNote } from "../setup-changes-note";
import { TaskEventNote } from "../task-event-note";
import { SentAsksNote } from "../window/ask-pills";

/** The note a row of the transcript draws for a part `turnsOf` kept. */
export function renderDataPart(part: SessionMessagePart.DataPart): ReactNode {
  if (dataPartVisibility(part) !== "always") {
    return null;
  }
  switch (part.type) {
    case "data-permissionAnswer": {
      return <PermissionAnswerNote data={part.data} key={part.metadata.id} />;
    }
    case "data-asks": {
      return <SentAsksNote data={part.data} key={part.metadata.id} />;
    }
    case "data-folderChanges": {
      return <FolderChangesNote data={part.data} key={part.metadata.id} />;
    }
    case "data-fileChanges": {
      // Only the `output/` folder tasks wrote deliverables to when this part
      // was live. The watcher behind it reported everything a turn touched,
      // and the overwhelming majority of that is `work/`: the scripts the
      // agent wrote to make the deliverable, not the deliverable. Showing
      // those is what made the card worth deleting in the first place.
      //
      // A deleted file has nothing to show.
      const paths = part.data.files
        .filter(
          (file) =>
            file.status !== "deleted" &&
            file.filePath.startsWith("output/") &&
            isAddressableChatFilePath(file.filePath),
        )
        .map((file) => file.filePath);

      return paths.length === 0 ? null : (
        <FilePathsGrid key={part.metadata.id} paths={[...new Set(paths)]} />
      );
    }
    case "data-chatChanges": {
      return (
        <ChatChangesNote changes={part.data.changes} key={part.metadata.id} />
      );
    }
    case "data-setupChanges": {
      return (
        <SetupChangesNote changes={part.data.changes} key={part.metadata.id} />
      );
    }
    case "data-taskEvent": {
      // The conversation was woken by it; what it says about it is its reply.
      // A note the app's quit or the user's stop left wakes nothing, so no
      // reply follows it and it is the only word in the chat that the task
      // ended.
      return part.data.events.some(
        (event) => event.stoppedBy === "app" || event.stoppedBy === "person",
      ) ? (
        <TaskEventNote data={part.data} key={part.metadata.id} />
      ) : null;
    }
    default: {
      return null;
    }
  }
}
