import {
  draftKeyString,
  type PromptDraftKey,
} from "@/client/atoms/prompt-value";
import { getAssetUrl } from "@/client/lib/get-asset-url";
import { MESSAGE_FOOTER_ICON_SIZE, SHARED } from "@/client/lib/styles";
import { cn } from "@/client/lib/utils";
import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import { renderSkillMentionsAsText } from "@instrument-org/shared/skill-mention";
import {
  type FileUpload,
  type FolderAttachment,
  type SessionMessage,
  type SessionMessagePart,
  type StoreId,
  type TaskId,
} from "@instrument-org/workspace/client";
import { CaretUpIcon, PencilSimpleIcon } from "@phosphor-icons/react";
import { debounce } from "radashi";
import { memo, useEffect, useRef, useState } from "react";

import { CopyButton } from "./copy-button";
import { PromptInput, type PromptInputInitialItem } from "./prompt-input";
import { RelativeTime } from "./relative-time";
import { SkillMentionText } from "./skill-mention-text";
import { useReleaseAutoScroll } from "./transcript-scroll-context";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

// The height a collapsed message clamps to, chosen so the fade lands in the
// middle of a line rather than between two. One constant rather than a class
// and a number, because the height the bubble clamps at and the height the
// overflow check measures against have to be the same: a message taller than
// one and shorter than the other gets a fade and a click-to-expand target over
// text that was never cut off.
const COLLAPSED_MAX_HEIGHT_PX = 216;

export interface UserMessageEditSubmit {
  files?: FileUpload.Input[];
  folders?: { access: FolderAttachment.Access; path: string }[];
  keepFilePaths?: string[];
  modelURI: AIGatewayModelURI.Type;
  prompt: string;
}

export const UserMessage = memo(function UserMessage({
  assetBaseUrl,
  discardCount = 0,
  isEditing = false,
  isEditPending = false,
  message,
  modelURI,
  onCancelEdit,
  onModelChange,
  onStartEdit,
  onSubmitEdit,
  part,
  selectedSessionId,
  taskId,
}: {
  assetBaseUrl?: string;
  discardCount?: number;
  isEditing?: boolean;
  isEditPending?: boolean;
  message: SessionMessage.UserWithParts;
  modelURI?: AIGatewayModelURI.Type;
  onCancelEdit?: () => void;
  onModelChange?: (modelURI: AIGatewayModelURI.Type) => void;
  onStartEdit?: () => void;
  onSubmitEdit?: (value: UserMessageEditSubmit) => void;
  part: SessionMessagePart.TextPart;
  selectedSessionId?: StoreId.Session;
  taskId?: TaskId;
}) {
  const releaseAutoScroll = useReleaseAutoScroll();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const messageText = part.text;
  const canEdit =
    onStartEdit != null && onSubmitEdit != null && onModelChange != null;

  const handleCopy = async () => {
    // Copy what is on screen. Neither form round trips back into the composer
    // as a token, so the serialized one is only noise to whoever pastes it.
    await navigator.clipboard.writeText(renderSkillMentionsAsText(messageText));
  };

  useEffect(() => {
    const element = contentRef.current;
    if (!element) {
      return;
    }

    // `scrollHeight` is the full content height under either clamp, so this
    // answers the same question expanded or collapsed without borrowing the
    // element's styles to measure through.
    const checkOverflow = () => {
      setIsOverflowing(element.scrollHeight > COLLAPSED_MAX_HEIGHT_PX);
    };

    checkOverflow();

    const debouncedCheckOverflow = debounce({ delay: 100 }, checkOverflow);
    const resizeObserver = new ResizeObserver(debouncedCheckOverflow);
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, [messageText]);

  if (isEditing && canEdit && taskId) {
    const draftKey = {
      id: `edit:${message.id}`,
      scope: "transient",
    } as const;

    return (
      <EditMessageComposer
        discardCount={discardCount}
        draftKey={draftKey}
        initialItems={initialItemsFromMessage({ assetBaseUrl, message })}
        isEditPending={isEditPending}
        modelURI={modelURI}
        onCancelEdit={onCancelEdit}
        onModelChange={onModelChange}
        onSubmitEdit={onSubmitEdit}
        selectedSessionId={selectedSessionId}
        taskId={taskId}
      />
    );
  }

  return (
    <div className="group flex w-full flex-col items-end">
      <div
        className={cn(
          "relative max-w-[80%] rounded-tl-xl rounded-tr rounded-br-xl rounded-bl-xl bg-linear-to-b from-card to-gray-25 px-4 py-2 text-foreground shadow-sm transition-[box-shadow,background-color] dark:from-card dark:to-card",
          canEdit &&
            "cursor-pointer hover:ring-1 hover:ring-black/10 dark:hover:ring-white/10",
        )}
        onClick={() => {
          if (!canEdit) {
            return;
          }
          releaseAutoScroll();
          onStartEdit();
        }}
        onKeyDown={(event) => {
          if (!canEdit) {
            return;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            releaseAutoScroll();
            onStartEdit();
          }
        }}
        role={canEdit ? "button" : undefined}
        tabIndex={canEdit ? 0 : undefined}
        {...(canEdit ? { "aria-label": "Edit message" } : {})}
      >
        {canEdit && (
          <PencilSimpleIcon className="pointer-events-none absolute top-2 right-2 size-3.5 text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100" />
        )}

        <Collapsible
          onOpenChange={(open) => {
            // Editing owns the press; expand stays available only after the
            // message is already open via its own collapse control.
            if (canEdit && !isExpanded) {
              return;
            }
            releaseAutoScroll();
            setIsExpanded(open);
          }}
          open={isExpanded}
        >
          <div
            className={cn(
              isExpanded ? "max-h-128 overflow-y-auto" : "overflow-hidden",
              canEdit && "pr-6",
            )}
            data-slot="user-message-content"
            ref={contentRef}
            style={
              isExpanded ? undefined : { maxHeight: COLLAPSED_MAX_HEIGHT_PX }
            }
          >
            <div className="text-sm break-words whitespace-pre-wrap">
              <SkillMentionText text={messageText} />
            </div>
          </div>

          {!canEdit && !isExpanded && isOverflowing && (
            <CollapsibleTrigger asChild>
              {/* Covers the clipped message so a press anywhere on it expands.
                  It draws nothing, so the label is the only thing it is: with
                  no children and no `aria-label` it announced as a button with
                  no name at all. */}
              <button
                aria-label="Show the full message"
                className="absolute inset-0 cursor-pointer"
                data-slot="user-message-expand"
                type="button"
              />
            </CollapsibleTrigger>
          )}

          {!isExpanded && isOverflowing && (
            <div className="pointer-events-none absolute right-0 bottom-0 left-0 h-12 rounded-br-xl rounded-bl-xl bg-linear-to-t from-gray-25 from-50% to-gray-25/0 dark:from-card dark:to-card/0" />
          )}

          <CollapsibleContent>
            {/* The other half of the pair above, and it has to be a control for
                the same reason: expanding was reachable and collapsing was not,
                so a message opened from the keyboard could not be closed again.
                The trigger carries the state, so no handler of its own. */}
            <CollapsibleTrigger asChild>
              <button
                className="flex w-full cursor-pointer items-center justify-center gap-1 pt-2 text-xs text-muted-foreground hover:text-foreground"
                data-slot="user-message-collapse"
                onClick={(event) => {
                  event.stopPropagation();
                }}
                type="button"
              >
                <span>Collapse</span>
                <CaretUpIcon className="size-3" />
              </button>
            </CollapsibleTrigger>
          </CollapsibleContent>
        </Collapsible>
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground opacity-0 group-hover:opacity-100">
        <RelativeTime
          className="cursor-default"
          date={part.metadata.createdAt}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <CopyButton
              className={SHARED.messageFooterButton}
              iconSize={MESSAGE_FOOTER_ICON_SIZE}
              onCopy={handleCopy}
            />
          </TooltipTrigger>
          <TooltipContent>Copy message</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
});

function EditMessageComposer({
  discardCount,
  draftKey,
  initialItems,
  isEditPending,
  modelURI,
  onCancelEdit,
  onModelChange,
  onSubmitEdit,
  selectedSessionId,
  taskId,
}: {
  discardCount: number;
  draftKey: PromptDraftKey;
  initialItems: PromptInputInitialItem[];
  isEditPending: boolean;
  modelURI?: AIGatewayModelURI.Type;
  onCancelEdit?: () => void;
  onModelChange: (modelURI: AIGatewayModelURI.Type) => void;
  onSubmitEdit: (value: UserMessageEditSubmit) => void;
  selectedSessionId?: StoreId.Session;
  taskId: TaskId;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!onCancelEdit || isEditPending) {
      return;
    }

    // pointerdown rather than click: a click waits for mouseup, and by then a
    // menu or picker that opened on the same press can have moved focus. Skip
    // anything inside this composer or a portalled overlay it owns (model
    // picker, slash menu, folder tray menus).
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (containerRef.current?.contains(target)) {
        return;
      }
      if (target.closest('[data-slot="portal-container"]')) {
        return;
      }
      onCancelEdit();
    };

    // Escape is also handled inside the editor, but focus can land on the
    // action row (model picker, + menu). Listen here so it still dismisses,
    // and defer when something else already consumed the key (open menu,
    // slash popover, dialog).
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return;
      }
      if (
        document.querySelector(
          '[data-slot="portal-container"] [role="dialog"], [data-slot="portal-container"] [data-radix-menu-content], [data-slot="portal-container"] [data-radix-popper-content-wrapper]',
        )
      ) {
        return;
      }
      event.preventDefault();
      onCancelEdit();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isEditPending, onCancelEdit]);

  return (
    <div
      className="flex w-full flex-col items-stretch gap-2"
      ref={containerRef}
    >
      <PromptInput
        autoFocus
        autoResizeMaxHeight={320}
        draftKey={draftKey}
        enableWindowFileDrop={false}
        folderTrayPlacement="above"
        id={taskId}
        initialItems={initialItems}
        isLoading={isEditPending}
        isSubmittable={!isEditPending}
        key={draftKeyString(draftKey)}
        modelURI={modelURI}
        onCancel={onCancelEdit}
        onModelChange={onModelChange}
        onSubmit={({
          files,
          folders,
          keepFilePaths,
          modelURI: nextModel,
          prompt,
        }) => {
          onSubmitEdit({
            files,
            folders,
            keepFilePaths,
            modelURI: nextModel,
            prompt,
          });
        }}
        placeholder="Edit message"
        selectedSessionId={selectedSessionId}
      />
      {discardCount > 0 && (
        <p className="text-center text-xs text-muted-foreground/60">
          Editing from here will discard newer messages
        </p>
      )}
    </div>
  );
}

function initialItemsFromMessage({
  assetBaseUrl,
  message,
}: {
  assetBaseUrl?: string;
  message: SessionMessage.UserWithParts;
}): PromptInputInitialItem[] {
  const attachmentsPart = message.parts.find(
    (messagePart) => messagePart.type === "data-attachments",
  );
  if (attachmentsPart?.type !== "data-attachments") {
    return [];
  }

  const items: PromptInputInitialItem[] = [];

  for (const folder of attachmentsPart.data.folders ?? []) {
    if (folder.source === "project") {
      continue;
    }
    items.push({
      access: folder.access,
      path: folder.path,
      type: "folder",
    });
  }

  for (const file of attachmentsPart.data.files) {
    items.push({
      mimeType: file.mimeType,
      name: file.filename,
      relativePath: file.filePath,
      size: file.size,
      type: "file",
      url:
        assetBaseUrl == null
          ? undefined
          : getAssetUrl({
              assetBase: assetBaseUrl,
              filePath: file.filePath,
            }),
    });
  }

  return items;
}
