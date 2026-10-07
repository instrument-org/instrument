import { openFilePreviewAtom } from "@/client/atoms/file-preview";
import { dismissedModelOffersAtom } from "@/client/atoms/dismissed-model-offers";
import { openLogin } from "@/client/atoms/login-modal";
import { type ComposerApp } from "@/client/components/app-mention";
import { AttachedFilePreview } from "@/client/components/attached-file-preview";
import { AttachedItemPreview } from "@/client/components/attached-item-preview";
import {
  type ComposerAction,
  ComposerAddMenu,
  type ComposerMenuView,
  type ComposerPlaces,
} from "@/client/components/composer-add-menu";
import { ComposerFrame } from "@/client/components/composer-frame";
import { MacFolderIcon } from "@/client/components/icons/mac-folder";
import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { ModelNoticeRow } from "@/client/components/model-notice";
import { ModelPicker } from "@/client/components/model-picker";
import { Button } from "@/client/components/ui/button";
import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import {
  type DroppedFolder,
  useFileDropRegion,
} from "@/client/hooks/use-file-drop-region";
import { appMentionToken } from "@/client/lib/app-mention";
import {
  type ModelAction,
  noticeFor,
  readModelStatus,
} from "@/client/lib/model-status";
import { ITEM_IN } from "@/client/lib/motion";
import { shouldAttachClipboardItem } from "@/client/lib/paste-clipboard";
import { displayPath, folderLabel } from "@/client/lib/path-utils";
import { SKILL_LIST_STALE_TIME_MS } from "@/client/lib/skill-query";
import { captureException } from "@/client/lib/telemetry";
import { splitTransferItems } from "@/client/lib/transfer-items";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import { skillMentionToken } from "@instrument-org/shared/skill-mention";
import {
  type FileUpload,
  type StoreId,
  type TaskId,
} from "@instrument-org/workspace/client";
import { safe } from "@orpc/client";
import { ArrowUpIcon } from "@phosphor-icons/react/ArrowUp";
import { CpuIcon } from "@phosphor-icons/react/Cpu";
import { DesktopIcon } from "@phosphor-icons/react/Desktop";
import { FolderIcon } from "@phosphor-icons/react/Folder";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { PaperclipIcon } from "@phosphor-icons/react/Paperclip";
import { useQuery } from "@tanstack/react-query";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { AnimatePresence, motion } from "motion/react";
import {
  Fragment,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { ulid } from "ulid";

import { featuresAtom } from "../atoms/features";
import {
  draftKeyString,
  promptDraftAtom,
  type PromptDraftKey,
  promptDraftRefAtom,
  removeTransientDraft,
} from "../atoms/prompt-value";
import { PromptEditor, type PromptEditorRef } from "./prompt-editor";
import { SessionContextRing } from "./session-context-ring";
import { Spinner } from "./ui/spinner";

type AttachedItem =
  | {
      content: string;
      id: string;
      mimeType: string;
      name: string;
      size: number;
      type: "file";
      url?: string;
    }
  | {
      id: string;
      mimeType: string;
      name: string;
      path: string;
      size: number;
      type: "file";
      url?: string;
    }
  | {
      id: string;
      path: string;
      type: "folder";
    };

const MAX_PASTE_TEXT_LENGTH = 5000;
const MAX_FILE_PREVIEW_SIZE = 10 * 1024 * 1024;

/** Everything a submit clears, so a rejected one can put it back, and everything a surface keeps of a composer it puts away. */
export interface PromptInputDraft {
  items: AttachedItem[];
  prompt: string;
}

export interface PromptInputRef {
  clear: () => void;
  focus: () => void;
  /** Insert at the caret, spaced off from whatever it lands between; a token's wire form becomes its chip. */
  insertText: (text: string) => void;
  /** Opens the file chooser, the way the plus menu's "Add files" does. */
  pickFiles: () => void;
  /** Opens the folder chooser, the way the plus menu's "Work in a local folder" does. */
  pickFolder: () => void;
  restore: (draft: PromptInputDraft) => void;
  snapshot: () => PromptInputDraft;
}

interface PromptInputProps {
  /**
   * An element of the host's the button row is drawn into rather than along
   * the box's foot: a head over the words that carries the plus, the model
   * and the arrow. Given, the box keeps only its words and attachments.
   */
  actionsInto?: HTMLElement | null;
  /** Whether the plus is drawn in the button row; off where the host offers its own ways in. A typed slash still offers what the plus would. */
  addMenu?: boolean;
  /**
   * Keep the row open whether or not the caret is in it. For a composer that
   * sits beside the work rather than under it: switching to another tab would
   * otherwise fold the row shut and unfold it again on the focus that follows.
   */
  alwaysOpen?: boolean;
  /** What goes with the words besides files, drawn first in the row attached files land in: places marked in a file, say. */
  attachmentsLead?: React.ReactNode;
  autoFocus?: boolean;
  /** Where the box stops growing and the draft starts scrolling. Defaults by variant. */
  autoResizeMaxHeight?: number;
  className?: string;
  disabled?: boolean;
  draftKey: PromptDraftKey;
  /** Whether `attachmentsLead` holds anything, which is enough to send with no words. */
  hasAttachmentsLead?: boolean;
  id?: TaskId;
  isLoading: boolean;
  /** A chip at the head of the box, before any attached file: what goes with the prompt besides its words. */
  lead?: React.ReactNode;
  modelURI?: AIGatewayModelURI.Type;
  onModelChange: (modelURI: AIGatewayModelURI.Type) => void;
  onSubmit: (value: {
    files?: FileUpload.Input[];
    folders?: { path: string }[];
    modelURI: AIGatewayModelURI.Type;
    prompt: string;
  }) => void;
  placeholder?: string;
  /**
   * A chat's places, for its plus to open beside it (the web, the computer)
   * and the apps to name. Given these, the plus leads with them as tiles.
   */
  places?: Omit<ComposerPlaces, "apps" | "onNameApp">;
  ref?: React.Ref<PromptInputRef>;
  selectedSessionId?: StoreId.Session;
  /** A pill is one row, the height of a text field, that grows with the draft; bare is the block with no box drawn around it, for a host that draws its own. */
  variant?: "bare" | "block" | "pill";
}

export const PromptInput = ({
  actionsInto,
  addMenu = true,
  alwaysOpen,
  attachmentsLead,
  autoFocus = false,
  autoResizeMaxHeight,
  className,
  disabled = false,
  draftKey,
  hasAttachmentsLead = false,
  id,
  isLoading,
  lead,
  modelURI,
  onModelChange,
  onSubmit,
  placeholder,
  places,
  ref,
  selectedSessionId,
  variant = "block",
}: PromptInputProps) => {
  const features = useAtomValue(featuresAtom);
  const isActiveTab = useIsActiveTab();
  const [attachedItems, setAttachedItems] = useState<AttachedItem[]>([]);
  const [menuView, setMenuView] = useState<ComposerMenuView | null>(null);
  // A pill is one row until it is written in, then opens a row for the rest.
  const [pillFocused, setPillFocused] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const openFilePreview = useSetAtom(openFilePreviewAtom);
  const promptEditorRef = useRef<PromptEditorRef>(null);
  // The box the prompt is written in: what this composer's menus are sized and
  // placed against, so they read as an extension of the prompt rather than as
  // something dropped on top of it. The frame itself rather than everything
  // around it, so the target is the same on every surface whether or not a
  // folder tray is out. Held in state rather than a ref because the menus
  // measure it from their own layout effects, which run before a ref on this
  // element would have been attached.
  const [composerBounds, setComposerBounds] = useState<HTMLDivElement | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useAtom(promptDraftAtom(draftKey));
  const setInputRef = useSetAtom(promptDraftRefAtom(draftKey));

  const {
    data: modelsData,
    isError: modelsIsError,
    isLoading: modelsIsLoading,
    refetch: modelsRefetch,
  } = useQuery(rpcClient.gateway.models.live.list.experimental_liveOptions());
  const { errors: modelsErrors, models } = modelsData ?? {};
  const { data: hasToken } = useQuery(
    rpcClient.auth.live.hasToken.experimental_liveOptions(),
  );
  const { data: skills = [] } = useQuery(
    rpcClient.workspace.skill.list.queryOptions({
      staleTime: SKILL_LIST_STALE_TIME_MS,
    }),
  );
  const userInvocableSkills = skills.filter((skill) => skill.userInvocable);
  // The apps the workspace has, for a slash to name: any standing, since a
  // message can be about an app before it is connected.
  const { data: appList } = useQuery(
    rpcClient.apps.live.list.experimental_liveOptions(),
  );
  const composerApps: ComposerApp[] = (appList?.apps ?? []).map((app) => ({
    icon: app.icon,
    name: app.name,
    site: app.site,
    slug: app.slug,
  }));

  const selectedModel = models?.find((model) => model.uri === modelURI);
  const [dismissedOffers, setDismissedOffers] = useAtom(
    dismissedModelOffersAtom,
  );
  // Read on every render rather than at pick time: a selection made before a
  // policy change, a withdrawn model or a newer release can change underneath
  // the user without anything here being touched.
  const modelStatus = readModelStatus({
    dismissedOffers: new Set(dismissedOffers),
    errors: modelsErrors,
    isError: modelsIsError,
    isLoading: modelsIsLoading,
    models,
    modelURI,
  });
  const modelNotice = noticeFor(modelStatus);
  const addProvider = () => {
    openLogin(hasToken ? { reason: "provider-required" } : undefined);
  };
  const handleModelAction = (action: ModelAction) => {
    switch (action.kind) {
      case "add-provider": {
        addProvider();
        break;
      }
      case "choose": {
        setPickerOpen(true);
        break;
      }
      case "retry": {
        void modelsRefetch();
        break;
      }
      case "switch": {
        onModelChange(action.model.uri);
        break;
      }
    }
  };
  const dismissOffer =
    modelStatus.kind === "newer"
      ? () => {
          setDismissedOffers((current) => [...current, modelStatus.offerKey]);
        }
      : undefined;
  const noticeRow = modelNotice && (
    <ModelNoticeRow
      notice={modelNotice}
      onAction={handleModelAction}
      onDismiss={dismissOffer}
    />
  );

  useEffect(() => {
    setInputRef(promptEditorRef.current);
    return () => {
      setInputRef(null);
    };
  }, [setInputRef]);

  // A transient draft belongs to the surface that mounted it, so drop it when
  // that surface goes away or re-keys. Without this it would outlive the page
  // and follow the user to the next skill.
  const transientDraftId =
    draftKey.scope === "transient" ? draftKey.id : undefined;
  useEffect(() => {
    if (transientDraftId === undefined) {
      return;
    }
    return () => {
      removeTransientDraft(transientDraftId);
    };
  }, [transientDraftId]);

  useLayoutEffect(() => {
    if (!autoFocus || !isActiveTab) {
      return;
    }
    promptEditorRef.current?.focus();
    promptEditorRef.current?.moveCaretToEnd();
  }, [autoFocus, isActiveTab]);

  const processFiles = (files: File[] | FileList) => {
    for (const file of files) {
      const shouldCreatePreview =
        file.size <= MAX_FILE_PREVIEW_SIZE && file.type.startsWith("image/");
      const filePath = window.api.getFilePath(file);
      const shouldUsePath = filePath.trim().length > 0;

      if (shouldUsePath && !shouldCreatePreview) {
        setAttachedItems((prev) => [
          ...prev,
          {
            id: ulid(),
            mimeType: file.type,
            name: file.name,
            path: filePath,
            size: file.size,
            type: "file",
          },
        ]);
        continue;
      }

      const reader = new FileReader();
      reader.addEventListener("load", () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1] ?? "";
        setAttachedItems((prev) => [
          ...prev,
          shouldUsePath
            ? {
                id: ulid(),
                mimeType: file.type,
                name: file.name,
                path: filePath,
                size: file.size,
                type: "file",
                url: dataUrl,
              }
            : {
                content: base64,
                id: ulid(),
                mimeType: file.type,
                name: file.name,
                size: file.size,
                type: "file",
                url: shouldCreatePreview ? dataUrl : undefined,
              },
        ]);
      });
      reader.readAsDataURL(file);
    }
  };

  const attachFolders = (folders: DroppedFolder[]) => {
    // Split the drop against the rendered list so the toast happens here,
    // once, rather than inside the updater -- React may call an updater more
    // than once and would repeat the notification.
    const existingPaths = new Set(
      attachedItems.filter((i) => i.type === "folder").map((i) => i.path),
    );
    const duplicates: string[] = [];
    const newFolders: Extract<AttachedItem, { type: "folder" }>[] = [];

    for (const folder of folders) {
      if (existingPaths.has(folder.path)) {
        duplicates.push(folderLabel(folder.path));
      } else {
        newFolders.push({
          id: ulid(),
          path: folder.path,
          type: "folder",
        });
      }
    }

    if (duplicates.length > 0) {
      const names = duplicates.join(", ");
      toast.info(
        duplicates.length === 1
          ? `“${names}” is already added`
          : `Some folders are already added`,
        {
          description:
            duplicates.length === 1
              ? "That folder is already attached."
              : `${names} are already attached.`,
        },
      );
    }

    if (newFolders.length === 0) {
      return;
    }

    // `attachedItems` is a render-old snapshot, so re-check inside the
    // updater: back-to-back drops of the same folder both read the same
    // snapshot and would otherwise each append it.
    setAttachedItems((prev) => {
      const paths = new Set(
        prev.filter((i) => i.type === "folder").map((i) => i.path),
      );
      const unseen = newFolders.filter((f) => !paths.has(f.path));
      return unseen.length > 0 ? [...prev, ...unseen] : prev;
    });
  };

  useFileDropRegion({
    enabled: isActiveTab,
    note: "Drop to attach to your message",
    onFilesDropped: processFiles,
    onFoldersDropped: attachFolders,
  });

  const removeAttachedItem = (attachedItemId: string) => {
    setAttachedItems((prev) =>
      prev.filter((item) => item.id !== attachedItemId),
    );
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) {
      return;
    }

    processFiles(files);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleFolderPick = async () => {
    const [error, result] = await safe(
      rpcClient.utils.showFolderPicker.call({}),
    );
    if (error) {
      toast.error("Failed to open folder picker");
      return;
    }
    if (!result) {
      return;
    }
    const folderPath = result.path;

    // Notify outside the updater: React may run an updater more than once, and
    // a duplicate pick would then toast twice.
    if (
      attachedItems.some((i) => i.type === "folder" && i.path === folderPath)
    ) {
      toast.info(`“${folderLabel(folderPath)}” is already added`, {
        description: "That folder is already attached.",
      });
      return;
    }

    setAttachedItems((prev) =>
      prev.some((i) => i.type === "folder" && i.path === folderPath)
        ? prev
        : [
            ...prev,
            {
              id: ulid(),
              path: folderPath,
              type: "folder",
            },
          ],
    );
  };

  useImperativeHandle(ref, () => ({
    clear: () => {
      promptEditorRef.current?.clear();
      setAttachedItems([]);
    },
    focus: () => {
      promptEditorRef.current?.focus();
    },
    insertText: (text) => {
      promptEditorRef.current?.insertText(text);
    },
    pickFiles: () => {
      fileInputRef.current?.click();
    },
    pickFolder: () => {
      void handleFolderPick();
    },
    // Only into a composer the user left alone: a send can fail after they have
    // started the next prompt, and their new words outrank the rejected ones.
    restore: (draft) => {
      if (
        promptEditorRef.current?.getValue().trim() ||
        attachedItems.length > 0
      ) {
        return;
      }
      promptEditorRef.current?.setValue(draft.prompt);
      setAttachedItems(draft.items);
    },
    snapshot: () => ({
      items: attachedItems,
      prompt: promptEditorRef.current?.getValue() ?? "",
    }),
  }));

  const attachedFiles = attachedItems.filter((i) => i.type === "file");
  const attachedFolders = attachedItems.filter((i) => i.type === "folder");

  const actions: ComposerAction[] = [
    {
      icon: PaperclipIcon,
      id: "add-files",
      label: places ? "Attach files" : "Add files",
      onSelect: () => {
        fileInputRef.current?.click();
      },
    },
    {
      icon: FolderIcon,
      id: "work-in-folder",
      label: places ? "Add a folder" : "Work in a local folder",
      onSelect: () => {
        void handleFolderPick();
      },
    },
    // A pill has no room for the model beside the words, so the menu offers
    // it, and the picker opens where the menu was.
    ...(variant === "pill"
      ? [
          {
            // The picker opens once this menu has closed, and takes the caret
            // from there.
            handsOff: true,
            icon: CpuIcon,
            // Where the chosen model is billed, as the draft's model control
            // shows it, so the entry says which model before it is read.
            ...(selectedModel && {
              iconElement: (
                <AIProviderIcon
                  className="size-4 shrink-0"
                  type={selectedModel.params.provider}
                />
              ),
            }),
            id: "model",
            label: selectedModel
              ? `Model · ${selectedModel.name.trim()}`
              : "Choose a model",
            onSelect: () => {
              setPickerOpen(true);
            },
          },
        ]
      : []),
  ];

  // A typed slash offers what the plus does: in a chat, the places it opens
  // beside the chat lead the list.
  const slashActions: ComposerAction[] = places
    ? [
        {
          icon: GlobeIcon,
          id: "open-browser",
          label: "Browser",
          onSelect: places.onOpenWeb,
        },
        {
          icon: DesktopIcon,
          id: "open-computer",
          label: places.computerName,
          onSelect: places.onOpenComputer,
        },
        ...actions,
      ]
    : actions;

  const composerPlaces: ComposerPlaces | undefined = places && {
    ...places,
    apps: composerApps,
    onNameApp: (app) => {
      promptEditorRef.current?.insertText(appMentionToken(app));
    },
  };

  const canSubmit =
    !disabled &&
    !isLoading &&
    (value.trim() || attachedItems.length > 0 || hasAttachmentsLead) &&
    modelURI &&
    selectedModel;

  // Open while the caret is in it, a menu of its is up, or a draft is waiting:
  // the model and the message's context have nowhere else to go, and a row
  // that folded away mid-draft would take them with it.
  const pillOpen =
    variant === "pill" &&
    (alwaysOpen ||
      pillFocused ||
      pickerOpen ||
      menuView !== null ||
      value.trim().length > 0 ||
      attachedItems.length > 0 ||
      hasAttachmentsLead);

  // A pill stands beside the work in a column it shares with the conversation
  // it is part of, so it gives way to that conversation sooner than a block on
  // a page of its own does: a handful of lines, then the draft scrolls.
  const maxHeight = autoResizeMaxHeight ?? (variant === "pill" ? 200 : 400);

  const validateSubmission = () => {
    if (modelStatus.kind === "loading") {
      toast.info("Loading models", { description: "Send again in a moment." });
      return false;
    }
    // The same sentence and the same fix the notice row shows, so a send that
    // refuses says nothing the composer was not already saying.
    if (modelNotice?.tone === "problem") {
      const { action, detail, text } = modelNotice;
      toast.error(text, {
        ...(action && {
          action: {
            label: action.label,
            onClick: () => {
              handleModelAction(action);
            },
          },
        }),
        ...(detail && { description: detail }),
        duration: 7000,
      });
      return false;
    }
    return Boolean(canSubmit);
  };

  const handleSubmit = () => {
    if (!validateSubmission() || !modelURI) {
      return;
    }

    const trimmedPrompt = value.trim();
    const hasAttachments =
      attachedFiles.length > 0 || attachedFolders.length > 0;
    const prompt =
      !trimmedPrompt && hasAttachments
        ? `Review the ${attachedFiles.length > 0 ? `${attachedFiles.length} added file${attachedFiles.length === 1 ? "" : "s"}` : ""}${attachedFiles.length > 0 && attachedFolders.length > 0 ? " and " : ""}${attachedFolders.length > 0 ? `${attachedFolders.length} attached folder${attachedFolders.length === 1 ? "" : "s"}` : ""} to help with this request.`
        : trimmedPrompt;

    onSubmit({
      files:
        attachedFiles.length > 0
          ? attachedFiles.map((f) => ({
              filename: f.name,
              ...("path" in f
                ? {
                    mimeType: f.mimeType,
                    path: f.path,
                    size: f.size,
                  }
                : { content: f.content }),
            }))
          : undefined,
      folders:
        attachedFolders.length > 0
          ? attachedFolders.map((folder) => ({ path: folder.path }))
          : undefined,
      modelURI,
      prompt,
    });
  };

  const handlePaste = (e: ClipboardEvent) => {
    const clipboardData = e.clipboardData;
    if (!clipboardData) {
      return false;
    }
    const text = clipboardData.getData("text/plain");
    const hasText = text.trim().length > 0;

    // A folder copied in Finder or Explorer pastes as an item of kind `file`,
    // so it goes to the same folder handler a dropped one does.
    const { files, folders, unresolvedFolders } = splitTransferItems({
      getFilePath: window.api.getFilePath,
      items: clipboardData.items,
      shouldAttachFile: (item) => shouldAttachClipboardItem({ hasText, item }),
    });

    if (unresolvedFolders > 0 && folders.length === 0) {
      captureException(
        new Error("Could not get folder paths from pasted items"),
      );
    }

    if (files.length > 0 || folders.length > 0) {
      e.preventDefault();
      if (folders.length > 0) {
        attachFolders(folders);
      }
      processFiles(files);
      return true;
    }

    if (text && text.length > MAX_PASTE_TEXT_LENGTH) {
      e.preventDefault();

      const blob = new Blob([text], { type: "text/plain" });
      const lineCount = text.split("\n").length;
      const filename = `pasted-text-${lineCount}-lines.txt`;

      const reader = new FileReader();
      reader.addEventListener("load", () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1] ?? "";
        setAttachedItems((prev) => [
          ...prev,
          {
            content: base64,
            id: ulid(),
            mimeType: "text/plain",
            name: filename,
            size: blob.size,
            type: "file",
          },
        ]);
      });
      reader.readAsDataURL(blob);

      toast.info(
        `Large text (${text.length.toLocaleString()} characters) converted to file attachment`,
      );
      return true;
    }
    return false;
  };

  return (
    <div className={cn("relative flex flex-col", className)}>
      <ComposerFrame
        actions={
          <>
            <div className="flex min-w-0 shrink-0 items-center gap-1">
              {addMenu && (
                <ComposerAddMenu
                  actions={actions}
                  bounds={composerBounds}
                  disabled={disabled || isLoading}
                  onReturnFocus={() => {
                    promptEditorRef.current?.focus();
                  }}
                  onSelectSkill={(skill) => {
                    promptEditorRef.current?.insertText(
                      skillMentionToken(skill.id),
                    );
                  }}
                  onViewChange={setMenuView}
                  places={composerPlaces}
                  skills={userInvocableSkills}
                  view={menuView}
                />
              )}
            </div>

            <div className="flex min-w-0 flex-1 items-center justify-end gap-4">
              {features.context_ring && id && selectedSessionId && (
                <SessionContextRing
                  id={id}
                  model={selectedModel}
                  selectedSessionId={selectedSessionId}
                />
              )}

              <ModelPicker
                align="end"
                className="min-w-0"
                disabled={disabled || isLoading}
                errors={modelsErrors}
                isError={modelsIsError}
                isLoading={modelsIsLoading}
                models={models}
                modelURI={modelURI}
                notice={modelNotice}
                onAction={handleModelAction}
                onAddProvider={addProvider}
                onClose={() => {
                  setPickerOpen(false);
                  if (modelURI) {
                    promptEditorRef.current?.focus();
                  }
                }}
                onOpenChange={(open) => {
                  setPickerOpen(open);
                  if (open && modelsErrors && modelsErrors.length > 0) {
                    void modelsRefetch();
                  }
                }}
                onValueChange={onModelChange}
                open={pickerOpen}
                selectedModel={selectedModel}
              />

              <Button
                aria-label="Send"
                className="size-8 shrink-0 rounded-full p-0 disabled:opacity-100"
                disabled={!canSubmit}
                onClick={handleSubmit}
                variant="brand"
              >
                {isLoading ? (
                  <Spinner className="size-5" delay={0} />
                ) : (
                  <ArrowUpIcon className="size-5" />
                )}
              </Button>
            </div>
          </>
        }
        actionsInto={actionsInto}
        attachments={
          ((variant !== "pill" && lead) ||
            hasAttachmentsLead ||
            attachedItems.length > 0) && (
            // A file lands in the corner of a box the user is looking away
            // from, at the caret, so it grows into place rather than appearing
            // there. `initial={false}`: the first one is carried in by the row
            // opening around it, and does not need a second motion of its own.
            // Every child here needs a key of its own: presence tells them
            // apart by key, and two keyless ones read as the same child.
            <AnimatePresence initial={false}>
              <Fragment key="lead">{variant === "pill" ? null : lead}</Fragment>
              <Fragment key="attachments-lead">{attachmentsLead}</Fragment>
              {attachedItems.map((item) => (
                <motion.div
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  initial={{ opacity: 0, scale: 0.9 }}
                  key={item.id}
                  transition={ITEM_IN}
                >
                  {item.type === "folder" ? (
                    <AttachedItemPreview
                      icon={<MacFolderIcon className="size-5 shrink-0" />}
                      label={folderLabel(item.path)}
                      onRemove={() => {
                        removeAttachedItem(item.id);
                      }}
                      tooltip={displayPath(item.path)}
                    />
                  ) : (
                    <AttachedFilePreview
                      filename={item.name}
                      mimeType={item.mimeType}
                      onClick={() => {
                        if (item.url) {
                          openFilePreview({
                            filename: item.name,
                            mimeType: item.mimeType,
                            size: item.size,
                            url: item.url,
                          });
                        }
                      }}
                      onRemove={() => {
                        removeAttachedItem(item.id);
                      }}
                      size={item.size}
                      url={item.url}
                    />
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          )
        }
        extras={pillOpen ? lead : undefined}
        layout={variant}
        // A pill shows it only while open, with the rest of its second row;
        // a block or a draft always has room over its words.
        notice={variant === "pill" && !pillOpen ? undefined : noticeRow}
        leading={
          variant === "pill" ? (
            // The picker has no button of its own here: it hangs off an empty
            // box over the plus, so its panel opens from the plus when the menu
            // or the notice asks for it.
            <div className="relative">
              <ComposerAddMenu
                actions={actions}
                bounds={composerBounds}
                disabled={disabled || isLoading}
                onReturnFocus={() => {
                  promptEditorRef.current?.focus();
                }}
                onSelectSkill={(skill) => {
                  promptEditorRef.current?.insertText(
                    skillMentionToken(skill.id),
                  );
                }}
                onViewChange={setMenuView}
                places={composerPlaces}
                skills={userInvocableSkills}
                triggerClassName="size-7 rounded-full [&_svg]:size-4"
                view={menuView}
              />
              <ModelPicker
                anchorOnly
                className="pointer-events-none absolute inset-0"
                disabled={disabled || isLoading}
                errors={modelsErrors}
                isError={modelsIsError}
                isLoading={modelsIsLoading}
                models={models}
                modelURI={modelURI}
                notice={modelNotice}
                onAction={handleModelAction}
                onAddProvider={addProvider}
                onClose={() => {
                  setPickerOpen(false);
                  if (modelURI) {
                    promptEditorRef.current?.focus();
                  }
                }}
                onOpenChange={(open) => {
                  setPickerOpen(open);
                  if (open && modelsErrors && modelsErrors.length > 0) {
                    void modelsRefetch();
                  }
                }}
                onValueChange={onModelChange}
                open={pickerOpen}
                selectedModel={selectedModel}
              />
            </div>
          ) : undefined
        }
        maxHeight={maxHeight}
        onBlur={
          variant === "pill"
            ? (event) => {
                if (
                  event.relatedTarget instanceof Node &&
                  event.currentTarget.contains(event.relatedTarget)
                ) {
                  return;
                }
                setPillFocused(false);
              }
            : undefined
        }
        onFocus={
          variant === "pill"
            ? () => {
                setPillFocused(true);
              }
            : undefined
        }
        ref={setComposerBounds}
        trailing={
          variant === "pill" ? (
            <>
              {features.context_ring && id && selectedSessionId && (
                <SessionContextRing
                  id={id}
                  model={selectedModel}
                  selectedSessionId={selectedSessionId}
                />
              )}
              <Button
                aria-label="Send"
                className="size-7 shrink-0 rounded-full p-0 disabled:opacity-100"
                disabled={!canSubmit}
                onClick={handleSubmit}
                variant="brand"
              >
                {isLoading ? (
                  <Spinner className="size-4" delay={0} />
                ) : (
                  <ArrowUpIcon className="size-4" />
                )}
              </Button>
            </>
          ) : undefined
        }
      >
        {/* Keyed by draft: the editor reads its text once, at mount, so a
            surface that swaps which draft it is composing (one skill page to
            the next) needs a new editor rather than a new prop. */}
        <PromptEditor
          actions={slashActions}
          apps={composerApps}
          autoFocus={autoFocus}
          bounds={composerBounds}
          defaultValue={value}
          disabled={disabled || isLoading}
          key={draftKeyString(draftKey)}
          onChange={setValue}
          onPaste={handlePaste}
          onSubmit={handleSubmit}
          placeholder={placeholder}
          ref={promptEditorRef}
          skills={userInvocableSkills}
        />
      </ComposerFrame>

      <input
        className="hidden"
        multiple
        onChange={handleFileSelect}
        ref={fileInputRef}
        type="file"
      />
    </div>
  );
};
