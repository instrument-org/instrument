import {
  attachedFolderChangesModelNote,
  browserStatusModelNote,
  externalFileChangesModelNote,
  maxStepsModelNote,
  type SessionMessagePart,
} from "@instrument-org/workspace/client";
import { type ReactNode } from "react";

import { type RenderPartContext } from "./chat-stream-render-part";
import { FileChangesCard } from "./file-changes-card";
import { ModelContextDebugCard } from "./model-context-debug-card";
import { ProjectChangesNote } from "./project-changes-note";

type DataPartType = SessionMessagePart.DataPart["type"];

// How each harness data part surfaces in the chat stream. Single source of
// truth for visibility, shared by `renderDataPart`, `isVisibleAssistantPart`,
// and `isRenderableInlinePart` so the three can't drift apart.
// - "always": user-facing card, counts as visible content
// - "dev": developer-mode-only debug peek, not counted as visible content
// - "hidden": never rendered (surfaced to the model, not the user)
type DataPartVisibility = "always" | "dev" | "hidden";

const DATA_PART_DISPLAY: Record<DataPartType, DataPartVisibility> = {
  "data-attachedFolderChanges": "dev",
  "data-attachments": "hidden",
  "data-browserStatus": "dev",
  "data-externalFileChanges": "dev",
  "data-fileChanges": "always",
  "data-intent": "dev",
  "data-maxSteps": "dev",
  "data-projectChanges": "always",
  "data-projectContext": "hidden",
};

export function dataPartVisibility(type: DataPartType): DataPartVisibility {
  return DATA_PART_DISPLAY[type];
}

export function isDataPart(
  part: SessionMessagePart.Type,
): part is SessionMessagePart.DataPart {
  return part.type.startsWith("data-");
}

export function renderDataPart({
  browserStatusContextAdded,
  ctx,
  part,
}: {
  browserStatusContextAdded: boolean;
  ctx: RenderPartContext;
  part: SessionMessagePart.DataPart;
}): ReactNode {
  if (DATA_PART_DISPLAY[part.type] === "dev" && !ctx.isDeveloperMode) {
    return null;
  }

  switch (part.type) {
    case "data-attachedFolderChanges": {
      const note = attachedFolderChangesModelNote(part.data);
      return note ? (
        <ModelContextDebugCard
          className="mt-2"
          key={part.metadata.id}
          text={note}
        />
      ) : null;
    }
    case "data-attachments":
    case "data-projectContext": {
      return null;
    }
    case "data-browserStatus": {
      if (!browserStatusContextAdded) {
        return null;
      }
      return (
        <ModelContextDebugCard
          className="mt-2"
          key={part.metadata.id}
          text={browserStatusModelNote(part.data)}
        />
      );
    }
    case "data-externalFileChanges": {
      const note = externalFileChangesModelNote(part.data);
      return note ? (
        <ModelContextDebugCard
          className="mt-2"
          key={part.metadata.id}
          text={note}
        />
      ) : null;
    }
    case "data-fileChanges": {
      return (
        <FileChangesCard
          assetBaseUrl={ctx.assetBaseUrl}
          className="mt-2"
          files={part.data.files}
          key={part.metadata.id}
          taskId={ctx.task.id}
        />
      );
    }
    case "data-intent": {
      return (
        <ModelContextDebugCard
          className="mt-2"
          key={part.metadata.id}
          text={part.data.text}
        />
      );
    }
    case "data-maxSteps": {
      return (
        <ModelContextDebugCard
          className="mt-2"
          key={part.metadata.id}
          text={maxStepsModelNote(part.data)}
        />
      );
    }
    case "data-projectChanges": {
      return <ProjectChangesNote data={part.data} key={part.metadata.id} />;
    }
    default: {
      // A new data-part type must be handled above (and classified in
      // DATA_PART_DISPLAY); this fails the build otherwise.
      const _exhaustiveCheck: never = part;
      return _exhaustiveCheck;
    }
  }
}
