import { isMacOS } from "@/client/lib/utils";
import { type ReactNode } from "react";

export function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex h-svh max-h-full w-full flex-col overflow-hidden select-none
        [background:linear-gradient(180deg,var(--brand-200)_0%,var(--brown-50)_100%)]
        dark:[background:linear-gradient(180deg,color-mix(in_srgb,var(--brand-950)_60%,var(--background))_0%,var(--background)_50%)]"
    >
      {isMacOS() && (
        <div className="h-10 shrink-0 pl-20 [-webkit-app-region:drag]" />
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}
