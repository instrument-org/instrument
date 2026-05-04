import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import {
  type AIProviderType,
  AIProviderTypeSchema,
} from "@instrument-org/shared";
import { OUR_MODELS } from "@instrument-org/shared";
import { createFileRoute } from "@tanstack/react-router";

import { getDebugRoute } from "./-debug-routes";

export const Route = createFileRoute("/_app/debug/provider-icons")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: getDebugRoute("providerIcons").title }],
  }),
});

const providers: AIProviderType[] = [
  ...AIProviderTypeSchema.options,
  OUR_MODELS.providerType as AIProviderType,
];

const SIZES = ["size-4", "size-5", "size-6", "size-8"] as const;

function RouteComponent() {
  return (
    <div className="size-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8">
        <header className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">
            AI Provider Icons
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            All providers
          </h1>
        </header>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
          {providers.map((type) => (
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
      </div>
    </div>
  );
}
