import { cn } from "@/client/lib/utils";
import { type TaskId } from "@instrument-org/workspace/client";
import { type Ref } from "react";

import { Markdown } from "./markdown";

export const SessionMarkdown = ({
  assetBaseUrl,
  className,
  hardLineBreaks,
  markdown,
  ref,
  taskId,
}: {
  assetBaseUrl?: string;
  className?: string;
  hardLineBreaks?: boolean;
  markdown: string;
  ref?: Ref<HTMLDivElement>;
  taskId?: TaskId;
}) => {
  return (
    <div
      className={cn(
        "prose max-w-none prose-custom text-sm/relaxed wrap-break-word dark:prose-invert prose-figcaption:text-sm prose-kbd:text-inherit prose-code:text-inherit prose-pre:text-sm prose-table:text-sm",
        className,
      )}
      ref={ref}
    >
      <Markdown
        assetBaseUrl={assetBaseUrl}
        hardLineBreaks={hardLineBreaks}
        markdown={markdown}
        taskId={taskId}
      />
    </div>
  );
};
