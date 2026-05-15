import { SHARED } from "@/client/lib/styles";
import { cn, isMacOS } from "@/client/lib/utils";
import { type ReactNode } from "react";

export function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex h-svh max-h-full w-full flex-col overflow-hidden select-none",
        SHARED.brandGradient,
      )}
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
