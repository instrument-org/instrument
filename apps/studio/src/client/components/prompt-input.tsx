import { openFilePreviewAtom } from "@/client/atoms/file-preview";
import { openLogin } from "@/client/atoms/login-modal";
import { AttachedFilePreview } from "@/client/components/attached-file-preview";
import { AttachedFolderPreview } from "@/client/components/attached-folder-preview";
import { ModelPicker } from "@/client/components/model-picker";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { TextareaContainer } from "@/client/components/ui/textarea-container";
import { useIsActiveTab, useTabId } from "@/client/hooks/use-active-tab";
import { shouldAttachClipboardItem } from "@/client/lib/paste-clipboard";
import { folderNameFromPath } from "@/client/lib/path-utils";
import { SKILL_LIST_STALE_TIME_MS } from "@/client/lib/skill-query";
import {
  type DroppedFolder,
  useWindowFileDrop,
} from "@/client/lib/use-window-file-drop";
import { cn, isMacOS } from "@/client/lib/utils";
import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import { OUR_MODELS } from "@instrument-org/shared";
import {
  type FileUpload,
  type ProjectId,
  type StoreId,
  type TaskId,
} from "@instrument-org/workspace/client";
import { safe } from "@orpc/client";
import {
  ArrowUpIcon,
  FileIcon,
  FolderIcon,
  PaperclipIcon,
  StopIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
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
  promptDraftAtom,
  type PromptDraftKey,
  promptDraftRefAtom,
  promptFocusSignalAtom,
  removeTransientDraft,
} from "../atoms/prompt-value";
import { rpcClient } from "../rpc/client";
import { PromptProjectSelector } from "./project/prompt-project-selector";
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

interface PromptInputProps {
  allowOpenInNewTab?: boolean;
  autoFocus?: boolean;
  autoResizeMaxHeight?: number;
  // Extra action rendered in the button row before the attach control (e.g. the
  // task page's browser-panel toggle). The host owns it so this stays generic.
  browserToggle?: React.ReactNode;
  className?: string;
  disabled?: boolean;
  draftKey: PromptDraftKey;
  id?: TaskId;
  isLoading: boolean;
  isStoppable?: boolean;
  isSubmittable?: boolean;
  modelURI?: AIGatewayModelURI.Type;
  onModelChange: (modelURI: AIGatewayModelURI.Type) => void;
  onStop?: () => void;
  onSubmit: (value: {
    files?: FileUpload.Input[];
    folders?: { path: string }[];
    modelURI: AIGatewayModelURI.Type;
    openInNewTab?: boolean;
    projectId?: null | ProjectId;
    prompt: string;
  }) => void;
  placeholder?: string;
  ref?: React.Ref<PromptInputRef>;
  selectedSessionId?: StoreId.Session;
  showProjectSelector?: boolean;
}

interface PromptInputRef {
  clear: () => void;
  focus: () => void;
}

export const PromptInput = ({
  allowOpenInNewTab = false,
  autoFocus = false,
  autoResizeMaxHeight = 400,
  browserToggle,
  className,
  disabled = false,
  draftKey,
  id,
  isLoading,
  isStoppable = false,
  isSubmittable = true,
  modelURI,
  onModelChange,
  onStop,
  onSubmit,
  placeholder,
  ref,
  selectedSessionId,
  showProjectSelector = false,
}: PromptInputProps) => {
  const features = useAtomValue(featuresAtom);
  const isActiveTab = useIsActiveTab();
  const focusSignal = useAtomValue(promptFocusSignalAtom(useTabId()));
  const [attachedItems, setAttachedItems] = useState<AttachedItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<null | ProjectId>(
    null,
  );
  const openFilePreview = useSetAtom(openFilePreviewAtom);
  const textareaRef = useRef<HTMLDivElement>(null);
  const promptEditorRef = useRef<PromptEditorRef>(null);
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
      setValue("");
      setAttachedItems([]);
      setSelectedProjectId(null);
    },
    focus: () => {
      promptEditorRef.current?.focus();
    },
  }));

  useEffect(() => {
    setInputRef(promptEditorRef.current?.element ?? null);
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
      setAttachedItems((prev) => {
        const existingPaths = new Set(
          prev.filter((i) => i.type === "folder").map((i) => i.path),
        );
        const duplicates: string[] = [];
        const newFolders: AttachedItem[] = [];

        for (const folder of folders) {
          if (existingPaths.has(folder.path)) {
            duplicates.push(folderNameFromPath(folder.path));
          } else {
            newFolders.push({ id: ulid(), path: folder.path, type: "folder" });
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

        return newFolders.length > 0 ? [...prev, ...newFolders] : prev;
      });
    },
  });

  const removeAttachedItem = (index: number) => {
    setAttachedItems((prev) => prev.filter((_, i) => i !== index));
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
    setAttachedItems((prev) => {
      if (prev.some((i) => i.type === "folder" && i.path === folderPath)) {
        toast.info(`"${folderNameFromPath(folderPath)}" is already added`, {
          description:
            "That folder has already been attached. Each folder can only be added once.",
        });
        return prev;
      }
      return [...prev, { id: ulid(), path: folderPath, type: "folder" }];
    });
  };

  const attachedFiles = attachedItems.filter((i) => i.type === "file");
  const attachedFolders = attachedItems.filter((i) => i.type === "folder");

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
      folders: attachedFolders.length > 0 ? attachedFolders : undefined,
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

  return (
    <>
      <TextareaContainer
        className={cn(
          // isolate: the drag-and-drop overlay covers the composer and nothing
          // beyond it.
          "relative isolate overflow-visible rounded-[20px] p-4",
          "bg-white shadow-xs dark:bg-gray-800",
          className,
        )}
        ref={textareaRef}
        style={{ maxHeight: `${autoResizeMaxHeight}px` }}
      >
        {isDragging && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-[20px] border border-dashed border-foreground/20 bg-background/70">
            <UploadSimpleIcon className="size-8 text-primary" />
            <span className="text-sm font-medium text-primary">
              Drop files or folders to add them
            </span>
          </div>
        )}

        {attachedItems.length > 0 && (
          <div className="-m-2 mb-2 flex max-h-32 flex-wrap items-start gap-2 overflow-y-auto p-2">
            {attachedItems.map((item, index) =>
              item.type === "folder" ? (
                <AttachedFolderPreview
                  folderPath={item.path}
                  key={item.id}
                  onRemove={() => {
                    removeAttachedItem(index);
                  }}
                />
              ) : (
                <AttachedFilePreview
                  filename={item.name}
                  key={item.id}
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
                    removeAttachedItem(index);
                  }}
                  size={item.size}
                  url={item.url}
                />
              ),
            )}
          </div>
        )}

        <PromptEditor
          autoFocus={autoFocus}
          className="min-h-12"
          disabled={disabled || isLoading}
          maxHeight={Math.max(autoResizeMaxHeight - 72, 48)}
          onChange={setValue}
          onPaste={handlePaste}
          onSubmit={(modifierPressed) => {
            handleSubmit(allowOpenInNewTab && modifierPressed);
          }}
          placeholder={placeholder}
          ref={promptEditorRef}
          skills={userInvocableSkills}
          value={value}
        />

        <input
          className="hidden"
          multiple
          onChange={handleFileSelect}
          ref={fileInputRef}
          type="file"
        />
        <div className="flex items-end justify-between gap-2 pt-2">
          <div className="flex min-w-0 flex-1 items-end gap-2">
            <div className="min-w-0 flex-1">
              <ModelPicker
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
            </div>
          </div>

          {features.context_ring && id && selectedSessionId && (
            <SessionContextRing
              id={id}
              model={selectedModel}
              selectedSessionId={selectedSessionId}
            />
          )}

          {showProjectSelector && (
            <PromptProjectSelector
              disabled={disabled || isLoading}
              onChange={setSelectedProjectId}
              value={selectedProjectId}
            />
          )}

          {browserToggle}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="size-8 p-0"
                disabled={disabled || isLoading}
                size="sm"
                variant="ghost"
              >
                <PaperclipIcon className="size-5" weight="regular" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                <FileIcon />
                Add files
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleFolderPick()}>
                <FolderIcon />
                Add folder
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            className="size-10 rounded-full p-0 disabled:opacity-100"
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
      </TextareaContainer>
    </>
  );
};
