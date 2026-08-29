import { type ImageSourceKind } from "@/client/lib/image-policy";
import { cn } from "@/client/lib/utils";
import { type TaskId } from "@instrument-org/workspace/client";
import { type Ref } from "react";

import { Markdown } from "./markdown";

export const SessionMarkdown = ({
  assetBaseUrl,
  assetVersion,
  className,
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
        "prose prose-custom font-sans text-sm/relaxed wrap-break-word dark:prose-invert prose-headings:font-sans! prose-headings:leading-snug! prose-h1:text-xl! prose-h2:text-lg! prose-h3:text-base! prose-h4:text-sm! prose-h5:text-xs! prose-h6:text-xs! prose-figcaption:text-sm prose-kbd:text-inherit prose-code:text-inherit prose-pre:text-sm prose-table:text-sm",
        className,
      )}
      ref={ref}
    >
      <Markdown
        assetBaseUrl={assetBaseUrl}
        assetVersion={assetVersion}
        hideImages={hideImages}
        imageKinds={imageKinds}
        isStreaming={isStreaming}
        markdown={markdown}
        taskId={taskId}
      />
    </div>
  );
};
