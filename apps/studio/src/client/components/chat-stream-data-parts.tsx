import { isSurfacedTaskFile } from "@/client/lib/task-file-visibility";
import {
  attachedFolderChangesModelNote,
  browserStatusModelNote,
  externalFileChangesModelNote,
  maxStepsModelNote,
  type SessionMessageDataPart,
  type SessionMessagePart,
} from "@instrument-org/workspace/client";
import { type ReactNode } from "react";

import { type RenderPartContext } from "./chat-stream-render-part";
import { ConnectorChangesNote } from "./connector-changes-note";
import { FileChangesCard } from "./file-changes-card";
import { ModelContextDebugCard } from "./model-context-debug-card";
import { ProjectChangesNote } from "./project-changes-note";
import { SkillChangesCard } from "./skill-changes-card";

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
  "data-connectorChanges": "always",
  "data-externalFileChanges": "dev",
  "data-fileChanges": "always",
  "data-intent": "dev",
  "data-maxSteps": "dev",
  "data-projectChanges": "always",
  "data-projectContext": "hidden",
  "data-skillChanges": "always",
  "data-skillMentions": "dev",
};

export function dataPartVisibility(
  part: SessionMessagePart.DataPart,
): DataPartVisibility {
  // File changes confined to paths the grid never surfaces (skill files copied
  // into `work/`, say) have no card to draw. Reporting them as hidden keeps them
  // from counting as visible content and from leaving an empty gap in the
  // message column.
  if (
    part.type === "data-fileChanges" &&
    !part.data.files.some(isSurfacedFileChange)
  ) {
    return "hidden";
  }

  return DATA_PART_DISPLAY[part.type];
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
  const visibility = dataPartVisibility(part);
  if (
    visibility === "hidden" ||
    (visibility === "dev" && !ctx.isDeveloperMode)
  ) {
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
    case "data-connectorChanges": {
      return <ConnectorChangesNote data={part.data} key={part.metadata.id} />;
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
    case "data-skillChanges": {
      return (
        // Wider than the file grid's mt-2: that grid is a block of its own and
        // reads as separate at 8px, while a single slim card sits close enough
        // to the text above to look glued to it.
        <SkillChangesCard
          className="mt-3"
          data={part.data}
          key={part.metadata.id}
        />
      );
    }
    case "data-skillMentions": {
      return (
        <ModelContextDebugCard
          className="mt-2"
          key={part.metadata.id}
          text={`Skills mentioned: ${part.data.names.join(", ")}`}
        />
      );
    }
    default: {
      // A new data-part type must be handled above (and classified in
      // DATA_PART_DISPLAY); this fails the build otherwise.
      const _exhaustiveCheck: never = part;
      return _exhaustiveCheck;
    }
  }
}

function isSurfacedFileChange(
  file: SessionMessageDataPart.FileChangeDataPartItem,
) {
  // Deleted files have nothing to preview, matching `FileChangesCard`.
  return file.status !== "deleted" && isSurfacedTaskFile(file.filePath);
}
