import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import {
  type AIProviderType,
  AIProviderTypeSchema,
  OUR_MODELS,
} from "@instrument-org/shared";
import { createFileRoute } from "@tanstack/react-router";

import { getComponentPage } from "../-debug-routes";

export const Route = createFileRoute("/_app/debug/components/provider-icons")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: getComponentPage("provider-icons").label }],
  }),
});

const providers: AIProviderType[] = [
  ...AIProviderTypeSchema.options,
  OUR_MODELS.providerType,
];

const SIZES = ["size-4", "size-5", "size-6", "size-8"] as const;

function RouteComponent() {
  return (
    <div className="size-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8">
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
