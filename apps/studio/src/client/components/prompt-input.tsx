import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import { type Ref } from "react";

import {
  PromptComposer,
  type PromptComposerDraft,
  type PromptComposerSubmitPayload,
} from "./prompt-composer";

interface PromptInputProps {
  allowOpenInNewTab?: boolean;
  autoFocus?: boolean;
  autoResizeMaxHeight?: number;
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
}

export function PromptInput({
  allowOpenInNewTab,
  autoFocus,
  autoResizeMaxHeight,
  className,
  disabled,
  draft,
  isLoading,
  isStoppable,
  isSubmittable,
  modelURI,
  onModelChange,
  onStop,
  onSubmit,
  placeholder,
  ref,
}: PromptInputProps) {
  return (
    <PromptComposer.Root
      allowOpenInNewTab={allowOpenInNewTab}
      autoFocus={autoFocus}
      autoResizeMaxHeight={autoResizeMaxHeight}
      className={className}
      disabled={disabled}
      draft={draft}
      isLoading={isLoading}
      isStoppable={isStoppable}
      isSubmittable={isSubmittable}
      modelURI={modelURI}
      onModelChange={onModelChange}
      onStop={onStop}
      onSubmit={onSubmit}
      placeholder={placeholder}
      ref={ref}
    >
      <>
        <PromptComposer.Surface>
          <PromptComposer.Attachments />
          <PromptComposer.DropOverlay />
          <PromptComposer.FileInput />
          <PromptComposer.TextArea />
          <PromptComposer.Footer />
        </PromptComposer.Surface>
        <PromptComposer.AIProviderGuardDialog />
      </>
    </PromptComposer.Root>
  );
}
