import { Button } from "@/client/components/ui/button";
import { cn, isMacOS } from "@/client/lib/utils";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { type ReactNode } from "react";

export function OnboardingLayout({
  children,
  onBack,
  showBack = false,
}: {
  children: ReactNode;
  onBack?: () => void;
  showBack?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-svh w-full flex-col overflow-hidden select-none",
        showBack
          ? [
              "[background:linear-gradient(180deg,var(--brand-100)_0%,var(--brown-50)_40%)]",
              "dark:[background:var(--background)]",
            ]
          : [
              "[background:linear-gradient(180deg,var(--brand-200)_0%,var(--brown-50)_100%)]",
              "dark:[background:linear-gradient(180deg,color-mix(in_srgb,var(--brand-950)_60%,var(--background))_0%,var(--background)_50%)]",
            ],
      )}
    >
      {showBack && (
        <div className="pointer-events-none absolute inset-0 hidden opacity-[0.04] [background:linear-gradient(180deg,var(--brand-600)_0%,transparent_100%)] dark:block" />
      )}
      <div
        className={cn(
          "relative z-20 flex h-10 shrink-0 items-center [-webkit-app-region:drag]",
          isMacOS() ? "pl-20" : "pl-3",
        )}
      >
        {showBack && (
          <Button
            aria-label="Back"
            className="h-8 w-10 rounded-xl border border-black/5 text-muted-foreground
              [-webkit-app-region:no-drag] hover:bg-black/5 dark:border-white/10
              dark:hover:bg-white/10"
            onClick={onBack}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ArrowLeftIcon className="size-4" />
          </Button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}
