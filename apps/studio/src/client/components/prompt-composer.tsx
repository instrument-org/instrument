/* eslint-disable @typescript-eslint/consistent-type-definitions -- compound composer context types */
/* eslint-disable react-refresh/only-export-components -- compound exports share one module */
/* eslint-disable react-hooks/immutability -- callback refs assign Root-owned refs */
/* eslint-disable react-hooks/refs -- composer forwards stable RefObjects via context */
import { openFilePreviewAtom } from "@/client/atoms/file-preview";
import {
  promptInputRefAtom,
  promptValueAtomFamily,
  type PromptValueAtomKey,
} from "@/client/atoms/prompt-value";
import { AIProviderGuardDialog } from "@/client/components/ai-provider-guard-dialog";
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
import {
  TextareaContainer,
  TextareaInner,
} from "@/client/components/ui/textarea-container";
import { useHasPlan } from "@/client/hooks/use-has-plan";
import { folderNameFromPath } from "@/client/lib/path-utils";
import {
  type DroppedFolder,
  useWindowFileDrop,
} from "@/client/lib/use-window-file-drop";
import { cn, isMacOS } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import {
  type AIGatewayModel,
  type AIGatewayModelURI,
} from "@instrument-org/ai-gateway/client";
import { OUR_MODELS } from "@instrument-org/shared";
import {
  type FileUpload,
  type ProjectSubdomain,
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
import { useAtom, useSetAtom } from "jotai";
import {
  type ChangeEvent,
  type ClipboardEvent,
  createContext,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
  type RefObject,
  use,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { ulid } from "ulid";

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
      path: string;
      type: "folder";
    };

const MAX_PASTE_TEXT_LENGTH = 5000;
const MAX_FILE_PREVIEW_SIZE = 10 * 1024 * 1024;

export type PromptComposerDraft =
  | { atomKey: "$$new-tab$$" | "$$template$$"; kind: "scratch" }
  | { kind: "project"; subdomain: ProjectSubdomain };

export type PromptComposerSubmitPayload = {
  files?: FileUpload.Type[];
  folders?: { path: string }[];
  modelURI: AIGatewayModelURI.Type;
  openInNewTab?: boolean;
  prompt: string;
};

type PromptComposerContextValue = {
  actions: {
    handleFileInputChange: (e: ChangeEvent<HTMLInputElement>) => void;
    handleFolderPick: () => Promise<void>;
    handleInputChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
    handleKeyDown: (e: KeyboardEvent) => void;
    handlePaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
    handleStop: () => void;
    handleSubmitClick: (e: MouseEvent<HTMLButtonElement>) => void;
    onModelChange: (modelURI: AIGatewayModelURI.Type) => void;
    openAttachFiles: () => void;
    removeAttachedItem: (index: number) => void;
    setShowAIProviderGuard: (open: boolean) => void;
  };
  meta: {
    autoFocus: boolean;
    fileInputRef: RefObject<HTMLInputElement | null>;
    placeholder?: string;
    surfaceClassName?: string;
    textareaInnerRef: RefObject<HTMLTextAreaElement | null>;
    textareaRef: RefObject<HTMLDivElement | null>;
  };
  state: {
    attachedItems: AttachedItem[];
    autoResizeMaxHeight: number;
    canSubmit: boolean;
    disabled: boolean;
    isDragging: boolean;
    isInvalidOurModel: boolean;
    isLoading: boolean;
    isStoppable: boolean;
    modelsErrors: RPCOutput["gateway"]["models"]["list"]["errors"];
    modelsIsError: boolean;
    modelsIsLoading: boolean;
    modelsList: AIGatewayModel.Type[] | undefined;
    modelsRefetch: () => void;
    modelURI: AIGatewayModelURI.Type | undefined;
    selectedModel: AIGatewayModel.Type | undefined;
    showAIProviderGuard: boolean;
    value: string;
  };
};

type PromptComposerRootProps = {
  allowOpenInNewTab?: boolean;
  autoFocus?: boolean;
  autoResizeMaxHeight?: number;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  draft: PromptComposerDraft;
  isLoading: boolean;
  isStoppable?: boolean;
  isSubmittable?: boolean;
  modelURI?: AIGatewayModelURI.Type;
  onModelChange: (modelURI: AIGatewayModelURI.Type) => void;
  onStop?: () => void;
  onSubmit: (value: PromptComposerSubmitPayload) => void;
  placeholder?: string;
  ref?: Ref<{ focus: () => void }>;
};

function promptComposerDraftToAtomKey(
  draft: PromptComposerDraft,
): PromptValueAtomKey {
  if (draft.kind === "scratch") {
    return draft.atomKey;
  }
  return draft.subdomain;
}

const PromptComposerContext = createContext<null | PromptComposerContextValue>(
  null,
);

function PromptComposerAIProviderGuardDialog() {
  const { actions, state } = usePromptComposer();
  return (
    <AIProviderGuardDialog
      onOpenChange={actions.setShowAIProviderGuard}
      open={state.showAIProviderGuard}
    />
  );
}

function PromptComposerAttachments() {
  const { actions, state } = usePromptComposer();
  const openFilePreview = useSetAtom(openFilePreviewAtom);

  if (state.attachedItems.length === 0) {
    return null;
  }

  return (
    <div className="-m-2 mb-2 flex max-h-32 flex-wrap items-start gap-2 overflow-y-auto p-2">
      {state.attachedItems.map((item, index) =>
        item.type === "folder" ? (
          <AttachedFolderPreview
            folderPath={item.path}
            key={item.id}
            onRemove={() => {
              actions.removeAttachedItem(index);
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
              actions.removeAttachedItem(index);
            }}
            size={item.size}
            url={item.url}
          />
        ),
      )}
    </div>
  );
}

function PromptComposerDropOverlay() {
  const { state } = usePromptComposer();
  if (!state.isDragging) {
    return null;
  }
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-foreground/20 bg-background/70">
      <UploadSimpleIcon className="size-8 text-primary" />
      <span className="text-sm font-medium text-primary">
        Drop files or folders to add them
      </span>
    </div>
  );
}

function PromptComposerFileInput() {
  const { actions, meta } = usePromptComposer();
  return (
    <input
      className="hidden"
      multiple
      onChange={actions.handleFileInputChange}
      ref={meta.fileInputRef}
      type="file"
    />
  );
}

function PromptComposerFooter() {
  const { actions, state } = usePromptComposer();

  return (
    <div className="flex items-center justify-end gap-2 pt-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 self-end">
        <div className="min-w-0 flex-1">
          <ModelPicker
            disabled={state.disabled}
            errors={state.modelsErrors}
            isError={state.modelsIsError}
            isInvalidOurModel={state.isInvalidOurModel}
            isLoading={state.modelsIsLoading}
            models={state.modelsList}
            onAddProvider={() => {
              actions.setShowAIProviderGuard(true);
            }}
            onOpenChange={(open) => {
              if (open && state.modelsErrors.length > 0) {
                state.modelsRefetch();
              }
            }}
            onValueChange={actions.onModelChange}
            selectedModel={state.selectedModel}
          />
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            className="size-7 p-0"
            disabled={state.disabled}
            size="sm"
            variant="ghost"
          >
            <PaperclipIcon className="size-5" weight="regular" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={actions.openAttachFiles}>
            <FileIcon />
            Add files
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void actions.handleFolderPick()}>
            <FolderIcon />
            Add folder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        className="size-10 rounded-xl p-0 disabled:opacity-100"
        disabled={state.isStoppable ? false : !state.canSubmit}
        onClick={actions.handleSubmitClick}
        variant="brand"
      >
        {state.isStoppable ? (
          <StopIcon className="size-5" weight="fill" />
        ) : state.isLoading ? (
          <Spinner className="size-5" />
        ) : (
          <ArrowUpIcon className="size-5" />
        )}
      </Button>
    </div>
  );
}

function PromptComposerRoot({
  allowOpenInNewTab = false,
  autoFocus = false,
  autoResizeMaxHeight = 400,
  children,
  className,
  disabled = false,
  draft,
  isLoading,
  isStoppable = false,
  isSubmittable = true,
  modelURI,
  onModelChange,
  onStop,
  onSubmit,
  placeholder,
  ref,
}: PromptComposerRootProps) {
  const atomKey = promptComposerDraftToAtomKey(draft);
  const [showAIProviderGuard, setShowAIProviderGuard] = useState(false);
  const [attachedItems, setAttachedItems] = useState<AttachedItem[]>([]);
  const textareaRef = useRef<HTMLDivElement>(null);
  const textareaInnerRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useAtom(promptValueAtomFamily(atomKey));

  useImperativeHandle(ref, () => ({
    focus: () => {
      textareaInnerRef.current?.focus();
    },
  }));

  const {
    data: modelsData,
    isError: modelsIsError,
    isLoading: modelsIsLoading,
    refetch: modelsRefetch,
  } = useQuery(rpcClient.gateway.models.live.list.experimental_liveOptions());
  const { errors: modelsErrors, models: modelsList } = modelsData ?? {};

  const refetchModelsList = () => {
    void modelsRefetch();
  };

  const hasPlan = useHasPlan();

  const selectedModel = modelsList?.find((model) => model.uri === modelURI);
  const autoModel = modelsList?.find(
    (m) => m.providerId === OUR_MODELS.text.id,
  );

  const isInvalidOurModel =
    !hasPlan &&
    !!selectedModel &&
    selectedModel.params.provider === OUR_MODELS.providerType &&
    selectedModel.providerId !== OUR_MODELS.text.id &&
    selectedModel.tags.includes("premium");

  const resetTextareaHeight = () => {
    if (textareaInnerRef.current) {
      textareaInnerRef.current.style.height = "auto";
    }
  };

  const adjustHeight = useCallback(() => {
    const el = textareaInnerRef.current;
    if (!el) {
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, autoResizeMaxHeight)}px`;
  }, [autoResizeMaxHeight]);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  useLayoutEffect(() => {
    if (!autoFocus) {
      return;
    }
    textareaInnerRef.current?.focus();
    adjustHeight();
  }, [autoFocus, adjustHeight]);

  const processFiles = (files: File[] | FileList) => {
    for (const file of files) {
      const shouldCreatePreview =
        file.size <= MAX_FILE_PREVIEW_SIZE && file.type.startsWith("image/");

      const reader = new FileReader();
      reader.addEventListener("load", () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1] ?? "";
        setAttachedItems((prev) => [
          ...prev,
          {
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

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
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
    (value.trim().length > 0 || attachedItems.length > 0) &&
    !!modelURI &&
    !!selectedModel;

  const validateSubmission = () => {
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

    if (isInvalidOurModel && autoModel) {
      toast.error("Invalid model selected", {
        action: {
          label: "Use Auto",
          onClick: () => {
            onModelChange(autoModel.uri);
          },
        },
        description: "Only the Auto model is available without a paid plan.",
        duration: 7000,
      });
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
              content: f.content,
              filename: f.name,
            }))
          : undefined,
      folders: attachedFolders.length > 0 ? attachedFolders : undefined,
      modelURI,
      openInNewTab,
      prompt,
    });
    if (!(allowOpenInNewTab && openInNewTab)) {
      setValue("");
      setAttachedItems([]);
      resetTextareaHeight();
    }
  };

  const handleStop = () => {
    onStop?.();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const openInNewTab =
        allowOpenInNewTab && (isMacOS() ? e.metaKey : e.ctrlKey);
      handleSubmit(openInNewTab);
    }
  };

  const handleInputChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    adjustHeight();
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData.items;
    const files: File[] = [];

    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          files.push(file);
        }
      }
    }

    if (files.length > 0) {
      e.preventDefault();
      processFiles(files);
      return;
    }

    const text = e.clipboardData.getData("text/plain");
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
    }
  };

  const handleSubmitClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (isStoppable) {
      handleStop();
    } else {
      const openInNewTab =
        allowOpenInNewTab && (isMacOS() ? e.metaKey : e.ctrlKey);
      handleSubmit(openInNewTab);
    }
  };

  const contextValue: PromptComposerContextValue = {
    actions: {
      handleFileInputChange,
      handleFolderPick,
      handleInputChange,
      handleKeyDown,
      handlePaste,
      handleStop,
      handleSubmitClick,
      onModelChange,
      openAttachFiles: () => fileInputRef.current?.click(),
      removeAttachedItem,
      setShowAIProviderGuard,
    },
    meta: {
      autoFocus,
      fileInputRef,
      placeholder,
      surfaceClassName: className,
      textareaInnerRef,
      textareaRef,
    },
    state: {
      attachedItems,
      autoResizeMaxHeight,
      canSubmit,
      disabled,
      isDragging,
      isInvalidOurModel,
      isLoading,
      isStoppable,
      modelsErrors: modelsErrors ?? [],
      modelsIsError,
      modelsIsLoading,
      modelsList,
      modelsRefetch: refetchModelsList,
      modelURI,
      selectedModel,
      showAIProviderGuard,
      value,
    },
  };

  return (
    <PromptComposerContext.Provider value={contextValue}>
      {children}
    </PromptComposerContext.Provider>
  );
}

function PromptComposerSurface({ children }: { children: ReactNode }) {
  const { meta, state } = usePromptComposer();
  return (
    <TextareaContainer
      className={cn(
        "relative overflow-hidden rounded-3xl p-4",
        "bg-card dark:bg-card",
        meta.surfaceClassName,
      )}
      ref={meta.textareaRef}
      style={{ maxHeight: `${state.autoResizeMaxHeight}px` }}
    >
      {children}
    </TextareaContainer>
  );
}

function PromptComposerTextArea() {
  const { actions, meta, state } = usePromptComposer();
  const setInputRef = useSetAtom(promptInputRefAtom);

  return (
    <TextareaInner
      autoFocus={meta.autoFocus}
      className="min-h-12 overflow-y-auto"
      disabled={state.disabled}
      onChange={actions.handleInputChange}
      onKeyDown={actions.handleKeyDown}
      onPaste={actions.handlePaste}
      placeholder={meta.placeholder}
      ref={(el) => {
        meta.textareaInnerRef.current = el;
        setInputRef(el);
      }}
      value={state.value}
    />
  );
}

function usePromptComposer() {
  const value = use(PromptComposerContext);
  if (!value) {
    throw new Error(
      "PromptComposer components must be used within PromptComposer.Root",
    );
  }
  return value;
}

export const PromptComposer = {
  AIProviderGuardDialog: PromptComposerAIProviderGuardDialog,
  Attachments: PromptComposerAttachments,
  DropOverlay: PromptComposerDropOverlay,
  FileInput: PromptComposerFileInput,
  Footer: PromptComposerFooter,
  Root: PromptComposerRoot,
  Surface: PromptComposerSurface,
  TextArea: PromptComposerTextArea,
};

/* eslint-enable @typescript-eslint/consistent-type-definitions */
/* eslint-enable react-refresh/only-export-components */
/* eslint-enable react-hooks/immutability */
/* eslint-enable react-hooks/refs */
