import { type TurnOpener, type ChatId } from "@instrument-org/workspace/client";
import { useEffect, useEffectEvent, useLayoutEffect, useRef } from "react";

import {
  type AttachedItem,
  PromptInput,
  type PromptInputRef,
} from "../prompt-input";
import { normalizeAttachmentFilePath } from "../sent-file-chips";
import { Button } from "../ui/button";
import { type MessageEditing } from "./message-editing";
import { useTranscriptHostPaths } from "./transcript-data";

/**
 * A message the person sent, open in a box like the reply box where it
 * stands, with the files that went with it. Nothing is stopped or replaced
 * until Send; Cancel and Escape put the message back.
 */
export function EditMessageBox({
  chatId,
  editing,
  opener,
}: {
  chatId: ChatId;
  editing: MessageEditing;
  opener: TurnOpener;
}) {
  const ref = useRef<PromptInputRef>(null);
  const { id } = opener.message;
  const files = opener.files.map((file) => ({
    ...file,
    filePath: normalizeAttachmentFilePath(file.filePath),
  }));
  const hostPaths = useTranscriptHostPaths(
    files.map((file) => file.filePath),
    chatId,
  );
  const words = opener.text?.text ?? "";
  const startWith = useEffectEvent(() => {
    ref.current?.swapIn({
      items: opener.folders.map(
        (folder): AttachedItem => ({
          id: folder.path,
          path: folder.path,
          type: "folder",
        }),
      ),
      prompt: words,
    });
    ref.current?.focusEnd();
  });
  useLayoutEffect(() => {
    startWith();
  }, []);
  // Where each file is comes a moment after the box, once for each, so one
  // taken out of the box stays out.
  const placed = useRef(new Set<string>());
  useEffect(() => {
    const arrived = files.flatMap((file): AttachedItem[] => {
      const path = hostPaths[file.filePath];
      if (!path || placed.current.has(file.filePath)) {
        return [];
      }
      placed.current.add(file.filePath);
      return [
        {
          id: file.filePath,
          mimeType: file.mimeType,
          name: file.filename,
          path,
          size: file.size,
          type: "file",
        },
      ];
    });
    if (arrived.length > 0) {
      ref.current?.mergeItems({ added: arrived, gone: [] });
    }
  });
  return (
    <div
      data-slot="edit-message-box"
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          !editing.isSending
        ) {
          event.preventDefault();
          event.stopPropagation();
          editing.onCancel();
        }
      }}
    >
      <PromptInput
        autoResizeMaxHeight={400}
        besidePlus={
          <Button
            disabled={editing.isSending}
            onClick={editing.onCancel}
            size="sm"
            variant="ghost"
          >
            Cancel
          </Button>
        }
        draftKey={{ id: `edit:${id}`, scope: "transient" }}
        isLoading={editing.isSending}
        modelChoice={editing.modelChoice}
        modelURI={editing.modelURI}
        onEscape={editing.isSending ? undefined : editing.onCancel}
        onModelChange={editing.onModelChange}
        onModelChoiceChange={editing.onModelChoiceChange}
        onSubmit={(value) => {
          editing.onSend(id, value);
        }}
        placeholder="Your message"
        ref={ref}
      />
    </div>
  );
}
