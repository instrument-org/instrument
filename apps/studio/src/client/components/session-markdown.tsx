import { type ImageSourceKind } from "@/client/lib/image-policy";
import { type ChatId } from "@instrument-org/workspace/client";
import { type ComponentProps, type Ref } from "react";

import { Markdown } from "./markdown";
import { Prose } from "./prose";

/**
 * Markdown from a chat, as prose: a reply, a tool's output, a file the chat
 * shows. Sized and given headings through {@link Prose}; a reply in 14px
 * text with the session heading scale unless the surface says otherwise.
 */
export const SessionMarkdown = ({
  assetVersion,
  className,
  documentUrl,
  headings = "session",
  hideImages,
  imageKinds,
  isStreaming,
  markdown,
  ref,
  size = "sm",
  chatId,
}: {
  assetVersion?: string;
  className?: string;
  documentUrl?: string;
  headings?: ComponentProps<typeof Prose>["headings"];
  hideImages?: boolean;
  imageKinds?: readonly ImageSourceKind[];
  isStreaming?: boolean;
  markdown: string;
  ref?: Ref<HTMLDivElement>;
  size?: ComponentProps<typeof Prose>["size"];
  chatId?: ChatId;
}) => {
  return (
    <Prose className={className} headings={headings} ref={ref} size={size}>
      <Markdown
        assetVersion={assetVersion}
        documentUrl={documentUrl}
        hideImages={hideImages}
        imageKinds={imageKinds}
        isStreaming={isStreaming}
        markdown={markdown}
        chatId={chatId}
      />
    </Prose>
  );
};
