import { type ImageSourceKind } from "@/client/lib/image-policy";
import { cn } from "@/client/lib/utils";
import { type TaskId } from "@instrument-org/workspace/client";
import { type Ref } from "react";

import { Markdown } from "./markdown";

export const SessionMarkdown = ({
  assetBaseUrl,
  assetVersion,
  className,
  documentUrl,
  hideImages,
  imageKinds,
  isStreaming,
  markdown,
  ref,
  taskId,
}: {
  assetBaseUrl?: string;
  assetVersion?: string;
  className?: string;
  documentUrl?: string;
  hideImages?: boolean;
  imageKinds?: readonly ImageSourceKind[];
  isStreaming?: boolean;
  markdown: string;
  ref?: Ref<HTMLDivElement>;
  taskId?: TaskId;
}) => {
  return (
    <div
      className={cn(
        "prose-session prose prose-custom font-sans text-sm/relaxed wrap-break-word dark:prose-invert prose-figcaption:text-sm prose-kbd:text-inherit prose-code:text-inherit prose-pre:text-sm prose-table:text-sm",
        className,
      )}
      ref={ref}
    >
      <Markdown
        assetBaseUrl={assetBaseUrl}
        assetVersion={assetVersion}
        documentUrl={documentUrl}
        hideImages={hideImages}
        imageKinds={imageKinds}
        isStreaming={isStreaming}
        markdown={markdown}
        taskId={taskId}
      />
    </div>
  );
};
