import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { AIProviderTypeSchema } from "@instrument-org/shared";

import { DebugState } from "../-shell";

const SIZES = ["size-4", "size-5", "size-6", "size-8"] as const;

/** The Icons page's providers: each provider's mark at every size. */
export function ProviderIconsTab() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8">
      <p className="text-sm text-muted-foreground">
        Each model provider&apos;s mark, at the four sizes the app draws it.
      </p>
      <DebugState id="providers-grid">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
          {AIProviderTypeSchema.options.map((type) => (
            <div
              className="flex flex-col items-center gap-3 rounded-lg border border-border p-4"
              key={type}
            >
              <div className="flex items-center gap-2">
                {SIZES.map((size) => (
                  <AIProviderIcon className={size} key={size} type={type} />
                ))}
              </div>
              <span className="text-center font-mono text-[11px] text-muted-foreground">
                {type}
              </span>
            </div>
          ))}
        </div>
      </DebugState>
    </div>
  );
}
