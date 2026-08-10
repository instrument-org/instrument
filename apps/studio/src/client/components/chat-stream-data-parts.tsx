import { isSurfacedTaskFile } from "@/client/lib/task-file-visibility";
import {
  attachedFolderChangesModelNote,
  browserStatusModelNote,
  maxStepsModelNote,
  paneTabsModelNote,
  type SessionMessageDataPart,
  type SessionMessagePart,
} from "@instrument-org/workspace/client";
import { type ReactNode } from "react";

import { type RenderPartContext } from "./chat-stream-render-part";
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
  // Superseded by the ```files fence, which is the agent's own account of what
  // it produced. The two overlap almost exactly -- the agent names the files it
  // just wrote, which are the files the watcher just saw -- so a turn showed
  // each one twice. Demoted rather than deleted while fence adherence is still
  // being measured: seeing what the watcher found next to what the agent named
  // is exactly the comparison that measurement wants. The part itself, its
  // schema, and `consumeTurnChanges` go together once that lands.
  "data-fileChanges": "dev",
  "data-intent": "dev",
  "data-maxSteps": "dev",
  "data-paneTabs": "dev",
  "data-projectChanges": "always",
  "data-projectContext": "hidden",
  "data-skillChanges": "always",
  "data-skillMentions": "dev",
  "data-unknown": "dev",
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

  return declaredVisibility(part.type);
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
    case "data-paneTabs": {
      return (
        <ModelContextDebugCard
          className="mt-2"
          key={part.metadata.id}
          text={paneTabsModelNote(part.data)}
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
    case "data-unknown": {
      // Not a failure the reader can do anything about, so it stays a
      // developer-mode row: the part is from a build that wrote a shape this one
      // cannot read, and the reason is the useful half.
      return (
        <ModelContextDebugCard
          className="mt-2"
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
function declaredVisibility(type: string): DataPartVisibility {
  const declared: Record<string, DataPartVisibility | undefined> =
    DATA_PART_DISPLAY;

  return declared[type] ?? "hidden";
}

function isSurfacedFileChange(
  file: SessionMessageDataPart.FileChangeDataPartItem,
) {
  // Deleted files have nothing to preview, matching `FileChangesCard`.
  return file.status !== "deleted" && isSurfacedTaskFile(file.filePath);
}
