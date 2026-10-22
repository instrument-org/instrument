import {
  type AIGatewayModel,
  modelDisplayName,
} from "@instrument-org/ai-gateway/client";

import { AIProviderIcon } from "./ai-provider-icon";

interface ModelChipProps {
  aiGatewayModel?: AIGatewayModel.Type;
  className?: string;
  modelId?: string;
  /**
   * The model that answered, on a turn where the provider served something
   * other than what was asked for. It takes the requested name's place; the
   * chip's card says what was asked for.
   *
   * The requested model's mark stays: a provider can only substitute within
   * its own catalog, so the one that answered carries the same one.
   */
  answeredBy?: string;
}

export function ModelChip({
  aiGatewayModel,
  answeredBy,
  className = "",
  modelId,
}: ModelChipProps) {
  const displayName =
    answeredBy ??
    (modelId === undefined
      ? aiGatewayModel?.name
      : modelDisplayName(modelId, aiGatewayModel?.name));
  const provider = aiGatewayModel?.params.provider;

  if (!displayName) {
    return null;
  }

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {provider && (
        <AIProviderIcon
          className="size-3.5 shrink-0 opacity-70"
          type={provider}
        />
      )}
      <span className="truncate text-xs text-muted-foreground">
        {displayName}
      </span>
    </div>
  );
}
