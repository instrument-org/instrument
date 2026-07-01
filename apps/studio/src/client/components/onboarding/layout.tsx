import { SHARED } from "@/client/lib/styles";
import { cn, isMacOS } from "@/client/lib/utils";
import { type ReactNode } from "react";

export function OnboardingLayout({
  children,
  variant = "subtle",
}: {
  children: ReactNode;
  variant?: "brand" | "subtle";
}) {
  return (
    <div
      className={cn(
        "flex h-svh max-h-full w-full flex-col overflow-hidden select-none",
        variant === "brand" ? SHARED.brandGradient : SHARED.subtleGradient,
      )}
      data-testid="onboarding-page"
    >
      {isMacOS() && (
        <div className="absolute top-0 right-0 left-0 h-10 pl-20 [-webkit-app-region:drag]" />
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}
