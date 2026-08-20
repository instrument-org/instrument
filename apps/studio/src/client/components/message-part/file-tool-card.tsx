import { type TaskId } from "@instrument-org/workspace/client";
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react/ArrowsOutSimple";

import { useTaskPaneActions } from "../../hooks/use-task-pane";
import { getLanguageFromFilePath } from "../../lib/file-extension-to-language";
import { filenameFromFilePath } from "../../lib/path-utils";
import { CodeBlock } from "../code-block";
import { FileIcon } from "../file-icon";
import { IconButton } from "../icon-button";
import { useToolCallSession } from "./tool-call-session";
import {
  ToolCard,
  ToolCardActions,
  ToolCardEmpty,
  ToolCardHeader,
  ToolCardSection,
} from "./tool-card";

/**
 * How tall a file body stands before it is opened, matching the other sections
 * so a card of output and a card of file are the same height until asked.
 */
const COLLAPSED_HEIGHT = 176;

export function FileToolCard({
  content,
  filePath,
  id,
  language,
  modifiedAt,
}: {
  content: string;
  filePath: string;
  id: TaskId;
  language?: string;
  modifiedAt?: number;
}) {
  const { isStreaming } = useToolCallSession();

  const filename = filenameFromFilePath(filePath);
  const detectedLanguage = language ?? getLanguageFromFilePath(filePath);
  const { openFiles } = useTaskPaneActions(id);

  const cleanedContent =
    !isStreaming && content.endsWith("\n") ? content.slice(0, -1) : content;

  const handleExpand = () => {
    if (modifiedAt === undefined) {
      return;
    }
    openFiles([filePath]);
  };

  if (!content) {
    return <ToolCardEmpty message="There is nothing to show." />;
  }

  return (
    <ToolCard>
      <ToolCardHeader className="flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <FileIcon
            className="size-3 shrink-0 text-muted-foreground"
            filename={filename}
          />
          <span className="truncate text-xs font-medium text-muted-foreground">
            {filename}
          </span>
        </div>

        {/* Opening the file is the one action that belongs beside its name:
            it acts on the whole card, and the header is the only place that
            says which file "this" is. Copy sits on the body instead, where
            what it takes is the text under it rather than a guess. */}
        {!isStreaming && modifiedAt !== undefined && (
          <ToolCardActions>
            <IconButton
              className="size-5 shrink-0 p-0.5 text-foreground/50 hover:text-foreground/80"
              icon={ArrowsOutSimpleIcon}
              onClick={handleExpand}
              tooltip="Open in panel"
              variant="ghost"
            />
          </ToolCardActions>
        )}
      </ToolCardHeader>

      {/* An ordinary section, laid out in full: the tools that fill this cap
          what they return -- a read stops at 2000 lines or 50KB, a listing at
          200 entries, a diff and a write at what the model produced -- so the
          body is bounded before it gets here, and the clamp is what keeps a
          bounded-but-long one from taking over the transcript.

          `copyText` carries no `modifiedAt` gate, unlike opening: that one
          needs a file on disk to open, while the text is already on screen
          either way. It is what lets a directory listing be copied. */}
      <ToolCardSection
        collapsedHeight={COLLAPSED_HEIGHT}
        copyText={isStreaming ? undefined : cleanedContent}
        wrappable
      >
        {/* Sized here because nothing under it is: the highlighter's `<pre>`
            takes `1em` from preflight and inherits the rest, and a card is not
            inside the prose that sizes a markdown fence. The same 14px the pane
            reads a whole file at, so opening the file changes nothing but the
            room it has. */}
        <div className="text-sm">
          <CodeBlock code={cleanedContent} language={detectedLanguage} />
        </div>
      </ToolCardSection>
    </ToolCard>
  );
}
