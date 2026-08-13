import {
  attachedFolderChangesModelNote,
  backgroundProcessesModelNote,
  browserStatusModelNote,
  isAddressableTaskFilePath,
  maxStepsModelNote,
  paneTabsModelNote,
  type SessionMessagePart,
  TASK_FOLDER_NAMES,
} from "@instrument-org/workspace/client";
import { type ReactNode } from "react";

import { FilePathsGrid } from "./agent-files-block";
import { type RenderPartContext } from "./chat-stream-render-part";
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
  // Deliberately not "always". This part is a persisted record of what was
  // running when the turn began, and a card in the transcript saying "2 still
  // running" is wrong the moment one stops -- the same staleness that kept live
  // status out of tool results. The header pill is the live surface; this is
  // context for the model, and a debug peek for us.
  "data-backgroundProcesses": "dev",
  "data-browserStatus": "dev",
  // Retired, and shown to everyone rather than to developers, which is the
  // opposite of where it ended up before it was deleted. It was demoted to
  // "dev" because it was a live change card nobody wanted; what it is now is
  // the only record a pre-fence conversation has of what a turn produced, and
  // the person who wants that is the person whose task it is.
  "data-fileChanges": "always",
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
  pathsAlreadyShown,
}: {
  browserStatusContextAdded: boolean;
  ctx: RenderPartContext;
  part: SessionMessagePart.DataPart;
  /**
   * Files this message already puts on screen, so the retired file-changes grid
   * does not draw a second copy of one. Computed once for the message rather
   * than per part.
   */
  pathsAlreadyShown?: ReadonlySet<string>;
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
    case "data-backgroundProcesses": {
      return (
        <ModelContextDebugCard
          className="mt-2"
          key={part.metadata.id}
          text={backgroundProcessesModelNote(part.data)}
        />
      );
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
      // Only `output/`. The watcher behind this part reported everything a turn
      // touched, and the overwhelming majority of that is `work/`: the scripts
      // the agent wrote to make the deliverable, not the deliverable. Showing
      // those is what made the card worth deleting in the first place.
      //
      // A deleted file has nothing to show, and one the reply already fenced or
      // linked is on screen already.
      const paths = part.data.files
        .filter(
          (file) =>
            file.status !== "deleted" &&
            file.filePath.startsWith(`${TASK_FOLDER_NAMES.output}/`) &&
            isAddressableTaskFilePath(file.filePath) &&
            pathsAlreadyShown?.has(file.filePath) !== true,
        )
        .map((file) => file.filePath);

      return paths.length === 0 ? null : (
        <FilePathsGrid key={part.metadata.id} paths={[...new Set(paths)]} />
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
