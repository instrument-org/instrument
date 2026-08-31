import { type AIGatewayModel } from "@instrument-org/ai-gateway/client";

import { AIProviderIcon } from "./ai-provider-icon";

interface ModelChipProps {
  aiGatewayModel?: AIGatewayModel.Type;
  className?: string;
  modelId?: string;
  /**
   * The model that answered, on a turn where the provider served something
   * other than what was asked for. The requested name stays and is struck
   * through, because what was chosen and what answered are both facts about
   * the turn and the reader picked one of them.
   *
   * One mark rather than two: a provider can only substitute within its own
   * catalog, so both names carry the same one and drawing it twice would say
   * the models came from different places.
   */
  replacedBy?: string;
}

export function ModelChip({
  aiGatewayModel,
  className = "",
  modelId,
  replacedBy,
}: ModelChipProps) {
  const displayName = aiGatewayModel?.name ?? modelId;
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
        {replacedBy ? (
          <>
            <span className="text-muted-foreground/50 line-through">
              {displayName}
            </span>{" "}
            {replacedBy}
          </>
        ) : (
          displayName
        )}
      </span>
    </div>
  );
}
