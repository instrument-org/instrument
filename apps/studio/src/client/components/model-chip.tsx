import { type AIProviderType } from "@instrument-org/shared";

import { AIProviderIcon } from "./ai-provider-icon";

/**
 * A model as the transcript names it: its provider's mark and its name. The
 * chips that say more (`ModelUsageChip`, `RecordedModelChip`) wrap this in
 * their card, so every model named in a chat reads the same.
 */
export function ModelChip({
  className = "",
  name,
  provider,
}: {
  className?: string;
  name: string;
  provider?: AIProviderType;
}) {
  return (
    <div className={`flex min-w-0 items-center gap-1 ${className}`}>
      {provider && (
        <AIProviderIcon
          className="size-3.5 shrink-0 opacity-70"
          type={provider}
        />
      )}
      <span className="truncate text-xs text-muted-foreground">{name}</span>
    </div>
  );
}
