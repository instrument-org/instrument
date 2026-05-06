import { type RPCOutput } from "@/client/rpc/client";
import {
  type AIGatewayModel,
  type AIGatewayModelURI,
} from "@instrument-org/ai-gateway/client";
import {
  type FileUpload,
  type ProjectSubdomain,
} from "@instrument-org/workspace/client";
import {
  type ChangeEvent,
  type ClipboardEvent,
  createContext,
  type KeyboardEvent,
  type MouseEvent,
  use,
} from "react";

export type AttachedItem =
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

export interface PromptComposerContextValue {
  actions: {
    handleFileInputChange: (e: ChangeEvent<HTMLInputElement>) => void;
    handleFolderPick: () => Promise<void>;
    handleInputChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
    handleKeyDown: (e: KeyboardEvent) => void;
    handlePaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
    handleSubmitClick: (e: MouseEvent<HTMLButtonElement>) => void;
    onModelChange: (modelURI: AIGatewayModelURI.Type) => void;
    onStop: (() => void) | undefined;
    openAttachFiles: () => void;
    registerFileInputRef: (el: HTMLInputElement | null) => void;
    registerTextareaInnerRef: (el: HTMLTextAreaElement | null) => void;
    removeAttachedItem: (index: number) => void;
    setShowAIProviderGuard: (open: boolean) => void;
  };
  meta: {
    autoFocus: boolean;
    autoResizeMaxHeight: number;
    placeholder?: string;
  };
  state: {
    attachedItems: AttachedItem[];
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
}

export type PromptComposerDraft =
  | { atomKey: "$$new-tab$$" | "$$template$$"; kind: "scratch" }
  | { kind: "project"; subdomain: ProjectSubdomain };

export interface PromptComposerSubmitPayload {
  files?: FileUpload.Type[];
  folders?: { path: string }[];
  modelURI: AIGatewayModelURI.Type;
  openInNewTab?: boolean;
  prompt: string;
}

export const PromptComposerContext =
  createContext<null | PromptComposerContextValue>(null);

export function usePromptComposer() {
  const value = use(PromptComposerContext);
  if (!value) {
    throw new Error(
      "PromptComposer components must be used within PromptComposer.Root",
    );
  }
  return value;
}
