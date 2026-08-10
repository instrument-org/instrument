import { openFilePreviewAtom } from "@/client/atoms/file-preview";
import { openLogin } from "@/client/atoms/login-modal";
import { AttachedFilePreview } from "@/client/components/attached-file-preview";
import {
  type ComposerAction,
  ComposerAddMenu,
  type ComposerMenuView,
} from "@/client/components/composer-add-menu";
import { ComposerFolderTray } from "@/client/components/composer-folder-tray";
import { ComposerFrame } from "@/client/components/composer-frame";
import {
  DEFAULT_FOLDER_ACCESS,
  type FolderAccess,
} from "@/client/components/folder-access-list";
import { ModelPicker } from "@/client/components/model-picker";
import { Button } from "@/client/components/ui/button";
import { useIsActiveTab, useTabId } from "@/client/hooks/use-active-tab";
import { BLOCK_CLOSE, BLOCK_OPEN, ITEM_IN } from "@/client/lib/motion";
import { shouldAttachClipboardItem } from "@/client/lib/paste-clipboard";
import { folderNameFromPath } from "@/client/lib/path-utils";
import { SKILL_LIST_STALE_TIME_MS } from "@/client/lib/skill-query";
import {
  type DroppedFolder,
  useWindowFileDrop,
} from "@/client/lib/use-window-file-drop";
import { cn, isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import { OUR_MODELS } from "@instrument-org/shared";
import { skillMentionToken } from "@instrument-org/shared/skill-mention";
import {
  type FileUpload,
  type FolderAttachment,
  type ProjectId,
  type StoreId,
  type TaskId,
} from "@instrument-org/workspace/client";
import { safe } from "@orpc/client";
import {
  ArrowUpIcon,
  CardsThreeIcon,
  FolderIcon,
  PaperclipIcon,
  StopIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { AnimatePresence, motion } from "motion/react";
import {
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
  promptFocusSignalAtom,
  removeTransientDraft,
} from "../atoms/prompt-value";
import { PromptProjectChip } from "./project/prompt-project-chip";
import { PromptEditor, type PromptEditorRef } from "./prompt-editor";
import { SessionContextRing } from "./session-context-ring";
import { Spinner } from "./ui/spinner";

type AttachedItem =
  | {
      access: FolderAttachment.Access;
      id: string;
      path: string;
      type: "folder";
    }
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
    };

const MAX_PASTE_TEXT_LENGTH = 5000;
const MAX_FILE_PREVIEW_SIZE = 10 * 1024 * 1024;

export interface PromptInputRef {
  clear: () => void;
  focus: () => void;
  restore: (draft: PromptInputDraft) => void;
  snapshot: () => PromptInputDraft;
}

/** Everything a submit clears, so a rejected one can put it back. */
interface PromptInputDraft {
  items: AttachedItem[];
  projectId: null | ProjectId;
  prompt: string;
}

interface PromptInputProps {
  allowOpenInNewTab?: boolean;
  // Whether the plus menu offers to work in a project, and a chosen one shows
  // beside it. Off where the project is not the composer's to decide -- a task's
  // is fixed when it is created.
  allowWorkInProject?: boolean;
  autoFocus?: boolean;
  autoResizeMaxHeight?: number;
  // Extra action rendered in the button row beside the plus button (e.g. the
  // task page's browser-panel toggle). The host owns it so this stays generic.
  className?: string;
  disabled?: boolean;
  draftKey: PromptDraftKey;
  // Which side of the composer the attached folders are listed on. Below on the
  // surfaces a prompt is composed from scratch; above where the composer is
  // already pinned to the bottom of the window.
  folderTrayPlacement?: "above" | "below";
  id?: TaskId;
  isLoading: boolean;
  isStoppable?: boolean;
  isSubmittable?: boolean;
  modelURI?: AIGatewayModelURI.Type;
  onFolderCountChange?: (count: number) => void;
  onModelChange: (modelURI: AIGatewayModelURI.Type) => void;
  onStop?: () => void;
  onSubmit: (value: {
    files?: FileUpload.Input[];
    folders?: { access: FolderAttachment.Access; path: string }[];
    modelURI: AIGatewayModelURI.Type;
    openInNewTab?: boolean;
    projectId?: null | ProjectId;
    prompt: string;
  }) => void;
  placeholder?: string;
  ref?: React.Ref<PromptInputRef>;
  selectedSessionId?: StoreId.Session;
  // Whether the folder tray offers its own entry point. Off, the tray still
  // appears once folders are attached -- otherwise a folder added from the plus
  // menu would be invisible and impossible to remove -- it just does not
  // advertise itself on surfaces that have their own folder controls.
  showWorkInFolder?: boolean;
}

export const PromptInput = ({
  allowOpenInNewTab = false,
  allowWorkInProject = false,
  autoFocus = false,
  autoResizeMaxHeight = 400,
  className,
  disabled = false,
  draftKey,
  folderTrayPlacement = "below",
  id,
  isLoading,
  isStoppable = false,
  isSubmittable = true,
  modelURI,
  onFolderCountChange,
  onModelChange,
  onStop,
  onSubmit,
  placeholder,
  ref,
  selectedSessionId,
  showWorkInFolder = false,
}: PromptInputProps) => {
  const features = useAtomValue(featuresAtom);
  const isActiveTab = useIsActiveTab();
  const focusSignal = useAtomValue(promptFocusSignalAtom(useTabId()));
  const [attachedItems, setAttachedItems] = useState<AttachedItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<null | ProjectId>(
    null,
  );
  const [menuView, setMenuView] = useState<ComposerMenuView | null>(null);
  const openFilePreview = useSetAtom(openFilePreviewAtom);
  const promptEditorRef = useRef<PromptEditorRef>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useAtom(promptDraftAtom(draftKey));
  const setInputRef = useSetAtom(promptDraftRefAtom(draftKey));
  // The plus menu lists skills the way a typed slash does -- name, description
  // and source on one line -- so it is sized to the composer rather than to the
  // 32px button it hangs off. Layout px, which is the unit the menu re-applies
  // zoom to.
  const [menuWidth, setMenuWidth] = useState<number>();

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
  // An empty list also closes off the editor's slash menu, so the flag gates
  // both the lookup and the completion UI.
  const { data: skills = [] } = useQuery(
    rpcClient.workspace.skill.list.queryOptions({
      enabled: features.skills,
      staleTime: SKILL_LIST_STALE_TIME_MS,
    }),
  );
  const userInvocableSkills = features.skills
    ? skills.filter((skill) => skill.userInvocable)
    : [];

  const selectedModel = models?.find((model) => model.uri === modelURI);
  const autoModel = models?.find((m) => m.providerId === OUR_MODELS.text.id);

  const isUnavailableModel = !!modelURI && !selectedModel && !!autoModel;
  // A selection made before a policy change can turn restricted underneath the
  // user, so the picked model is re-checked here and not only at pick time.
  const restrictedModel = selectedModel?.restricted;
  const isInvalidSelectedModel = isUnavailableModel || !!restrictedModel;

  useImperativeHandle(ref, () => ({
    clear: () => {
      promptEditorRef.current?.clear();
      setAttachedItems([]);
      setSelectedProjectId(null);
    },
    focus: () => {
      promptEditorRef.current?.focus();
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
      setSelectedProjectId(draft.projectId);
    },
    snapshot: () => ({
      items: attachedItems,
      projectId: selectedProjectId,
      prompt: promptEditorRef.current?.getValue() ?? "",
    }),
  }));

  useEffect(() => {
    setInputRef(promptEditorRef.current);
    return () => {
      setInputRef(null);
    };
  }, [setInputRef]);

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) {
      return;
    }
    // The content box rather than the border box: what the menu should span is
    // the button row it hangs off, which is the composer inside its padding.
    const observer = new ResizeObserver(([entry]) => {
      const inlineSize = entry?.contentBoxSize[0]?.inlineSize;
      if (inlineSize !== undefined) {
        setMenuWidth(inlineSize);
      }
    });
    observer.observe(composer);
    return () => {
      observer.disconnect();
    };
  }, []);

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
  }, [autoFocus, isActiveTab, focusSignal]);

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

  const { isDragging } = useWindowFileDrop({
    enabled: isActiveTab,
    onFilesDropped: processFiles,
    onFoldersDropped: (folders: DroppedFolder[]) => {
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
          duplicates.push(folderNameFromPath(folder.path));
        } else {
          newFolders.push({
            access: DEFAULT_FOLDER_ACCESS,
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
            ? `"${names}" is already added`
            : `Some folders are already added`,
          {
            description:
              duplicates.length === 1
                ? "That folder has already been attached. Each folder can only be added once."
                : `${names} have already been attached. Each folder can only be added once.`,
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
    },
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
      toast.info(`"${folderNameFromPath(folderPath)}" is already added`, {
        description:
          "That folder has already been attached. Each folder can only be added once.",
      });
      return;
    }

    setAttachedItems((prev) =>
      prev.some((i) => i.type === "folder" && i.path === folderPath)
        ? prev
        : [
            ...prev,
            {
              access: DEFAULT_FOLDER_ACCESS,
              id: ulid(),
              path: folderPath,
              type: "folder",
            },
          ],
    );
  };

  const setFolderAccess = (
    folderPath: string,
    access: FolderAttachment.Access,
  ) => {
    setAttachedItems((prev) =>
      prev.map((item) =>
        item.type === "folder" && item.path === folderPath
          ? { ...item, access }
          : item,
      ),
    );
  };

  const removeFolder = (folderPath: string) => {
    setAttachedItems((prev) =>
      prev.filter(
        (item) => !(item.type === "folder" && item.path === folderPath),
      ),
    );
  };

  const attachedFiles = attachedItems.filter((i) => i.type === "file");
  const attachedFolders = attachedItems.filter((i) => i.type === "folder");
  const folderAccessList: FolderAccess[] = attachedFolders.map((folder) => ({
    access: folder.access,
    path: folder.path,
  }));
  const showFolderTray = showWorkInFolder || folderAccessList.length > 0;

  // A host may lay itself out around what this prompt has been given -- the
  // tutorial task folds its own card away rather than wrapping a wrapper -- so
  // the count is reported as it changes rather than only on submit.
  const folderCount = folderAccessList.length;
  useEffect(() => {
    onFolderCountChange?.(folderCount);
  }, [folderCount, onFolderCountChange]);

  const actions: ComposerAction[] = [
    {
      icon: PaperclipIcon,
      id: "add-files",
      label: "Add files",
      onSelect: () => {
        fileInputRef.current?.click();
      },
    },
    {
      icon: FolderIcon,
      id: "work-in-folder",
      label: "Work in a local folder",
      onSelect: () => {
        void handleFolderPick();
      },
    },
    ...(allowWorkInProject
      ? [
          {
            icon: CardsThreeIcon,
            id: "work-in-project",
            keepMenuOpen: true,
            label: "Work in a project",
            onSelect: () => {
              setMenuView("projects");
            },
          },
        ]
      : []),
  ];

  const canSubmit =
    !disabled &&
    !isLoading &&
    (value.trim() || attachedItems.length > 0) &&
    modelURI &&
    selectedModel;

  const validateSubmission = () => {
    if (isUnavailableModel) {
      toast.error("Selected model is not available", {
        action: {
          label: "Use Auto",
          onClick: () => {
            onModelChange(autoModel.uri);
          },
        },
        description: "Switch to Auto to continue.",
        duration: 7000,
      });
      return false;
    }

    if (restrictedModel) {
      toast.error(`${selectedModel.name.trim()} is unavailable`, {
        ...(autoModel && {
          action: {
            label: "Use Auto",
            onClick: () => {
              onModelChange(autoModel.uri);
            },
          },
        }),
        description: restrictedModel.message,
        duration: 7000,
      });
      return false;
    }

    if (!canSubmit) {
      if (!modelURI || !selectedModel) {
        toast.error("Select a model");
      }
      return false;
    }

    if (!isSubmittable) {
      toast.error("Agent is still running. Wait for it to finish or stop it.");
      return false;
    }

    return true;
  };

  const handleSubmit = (openInNewTab = false) => {
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
          ? attachedFolders.map((folder) => ({
              access: folder.access,
              path: folder.path,
            }))
          : undefined,
      modelURI,
      openInNewTab,
      projectId: selectedProjectId,
      prompt,
    });
  };

  const handleStop = () => {
    onStop?.();
  };

  const handlePaste = (e: ClipboardEvent) => {
    const clipboardData = e.clipboardData;
    if (!clipboardData) {
      return false;
    }
    const text = clipboardData.getData("text/plain");
    const hasText = text.trim().length > 0;

    const items = clipboardData.items;
    const files: File[] = [];

    for (const item of items) {
      if (!shouldAttachClipboardItem({ hasText, item })) {
        continue;
      }
      const file = item.getAsFile();
      if (file) {
        files.push(file);
      }
    }

    if (files.length > 0) {
      e.preventDefault();
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

  const folderTray = (
    // `initial={false}`: a surface that offers the tray has it from the first
    // paint, and a restored draft arrives with its folders already attached.
    // Neither is a change, so neither is worth animating.
    <AnimatePresence initial={false}>
      {showFolderTray && (
        <motion.div
          animate={{ height: "auto", opacity: 1 }}
          className="overflow-hidden"
          exit={{ height: 0, opacity: 0, transition: BLOCK_CLOSE }}
          initial={{ height: 0, opacity: 0 }}
          transition={BLOCK_OPEN}
        >
          <ComposerFolderTray
            disabled={disabled || isLoading}
            folders={folderAccessList}
            onAccessChange={setFolderAccess}
            onAdd={() => void handleFolderPick()}
            onRemove={removeFolder}
            showAdd={showWorkInFolder}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    // Once there are folders to show, the composer sits inside a tray rather
    // than on top of one: a single rounded block, a shade off the page, with the
    // prompt inset in it. `isolate` keeps the block behind the prompt rather
    // than behind whatever the composer was placed on.
    <motion.div
      animate={{ padding: showFolderTray ? 4 : 0 }}
      className={cn("relative isolate flex flex-col", className)}
      initial={false}
      transition={showFolderTray ? BLOCK_OPEN : BLOCK_CLOSE}
    >
      {/* The block itself, out of flow: a border and a fill on the box the
          prompt sits in cannot be faded without taking the prompt with them. */}
      <motion.div
        animate={{ opacity: showFolderTray ? 1 : 0 }}
        className="pointer-events-none absolute inset-0 -z-10 rounded-3xl border border-black/5 bg-muted dark:border-white/10"
        initial={false}
        transition={showFolderTray ? BLOCK_OPEN : BLOCK_CLOSE}
      />

      {folderTrayPlacement === "above" && folderTray}

      <ComposerFrame
        actions={
          <>
            <div className="flex min-w-0 shrink-0 items-center gap-1">
              <ComposerAddMenu
                actions={actions}
                disabled={disabled || isLoading}
                onReturnFocus={() => {
                  promptEditorRef.current?.focus();
                }}
                onSelectProject={
                  allowWorkInProject ? setSelectedProjectId : undefined
                }
                onSelectSkill={(skill) => {
                  promptEditorRef.current?.insertText(
                    skillMentionToken(skill.id),
                  );
                }}
                onViewChange={setMenuView}
                projectId={selectedProjectId}
                skills={userInvocableSkills}
                view={menuView}
                width={menuWidth}
              />

              {allowWorkInProject && selectedProjectId && (
                <PromptProjectChip
                  disabled={disabled || isLoading}
                  onOpenPicker={() => {
                    setMenuView("projects");
                  }}
                  onRemove={() => {
                    setSelectedProjectId(null);
                  }}
                  projectId={selectedProjectId}
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
                className="min-w-0"
                disabled={disabled || isLoading}
                errors={modelsErrors}
                isError={modelsIsError}
                isInvalidOurModel={isInvalidSelectedModel}
                isLoading={modelsIsLoading}
                models={models}
                modelURI={modelURI}
                onAddProvider={() => {
                  openLogin(
                    hasToken ? { reason: "provider-required" } : undefined,
                  );
                }}
                onClose={() => {
                  if (modelURI) {
                    promptEditorRef.current?.focus();
                  }
                }}
                onOpenChange={(open) => {
                  if (open && modelsErrors && modelsErrors.length > 0) {
                    void modelsRefetch();
                  }
                }}
                onValueChange={onModelChange}
                selectedModel={selectedModel}
              />

              <Button
                aria-label={isStoppable ? "Stop" : "Send"}
                className="size-8 shrink-0 rounded-full p-0 disabled:opacity-100"
                disabled={isStoppable ? false : !canSubmit}
                onClick={(e) => {
                  if (isStoppable) {
                    handleStop();
                  } else {
                    const openInNewTab =
                      allowOpenInNewTab && (isMacOS() ? e.metaKey : e.ctrlKey);
                    handleSubmit(openInNewTab);
                  }
                }}
                variant="brand"
              >
                {isStoppable ? (
                  <StopIcon className="size-5" weight="fill" />
                ) : isLoading ? (
                  <Spinner className="size-5" />
                ) : (
                  <ArrowUpIcon className="size-5" />
                )}
              </Button>
            </div>
          </>
        }
        attachments={
          attachedFiles.length > 0 && (
            // A file lands in the corner of a box the user is looking away
            // from, at the caret, so it grows into place rather than appearing
            // there. `initial={false}`: the first one is carried in by the row
            // opening around it, and does not need a second motion of its own.
            <AnimatePresence initial={false}>
              {attachedFiles.map((item) => (
                <motion.div
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  initial={{ opacity: 0, scale: 0.9 }}
                  key={item.id}
                  transition={ITEM_IN}
                >
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
                </motion.div>
              ))}
            </AnimatePresence>
          )
        }
        maxHeight={autoResizeMaxHeight}
        overlay={
          isDragging && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-[20px] border border-dashed border-foreground/20 bg-background/70">
              <UploadSimpleIcon className="size-8 text-primary" />
              <span className="text-sm font-medium text-primary">
                Drop files or folders to add them
              </span>
            </div>
          )
        }
        ref={composerRef}
      >
        {/* Keyed by draft: the editor reads its text once, at mount, so a
            surface that swaps which draft it is composing (one skill page to
            the next) needs a new editor rather than a new prop. */}
        <PromptEditor
          actions={actions}
          autoFocus={autoFocus}
          defaultValue={value}
          disabled={disabled || isLoading}
          key={draftKeyString(draftKey)}
          onChange={setValue}
          onPaste={handlePaste}
          onSubmit={(modifierPressed) => {
            handleSubmit(allowOpenInNewTab && modifierPressed);
          }}
          placeholder={placeholder}
          ref={promptEditorRef}
          skills={userInvocableSkills}
        />
      </ComposerFrame>

      {folderTrayPlacement === "below" && folderTray}

      <input
        className="hidden"
        multiple
        onChange={handleFileSelect}
        ref={fileInputRef}
        type="file"
      />
    </motion.div>
  );
};
