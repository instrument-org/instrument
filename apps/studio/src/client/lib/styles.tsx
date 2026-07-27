import { cn } from "./utils";

export const MESSAGE_FOOTER_ICON_SIZE = 14;

// Using `cn` to ensure lint etc see these styles
export const SHARED = {
  brandGradient: cn([
    "[background:linear-gradient(180deg,var(--brand-100)_0%,var(--brown-50)_100%)]",
    "dark:[background:linear-gradient(180deg,color-mix(in_srgb,var(--brand-700)_50%,var(--background))_0%,var(--background)_50%)]",
  ]),
  // Icon buttons in a message footer, sized against the 12px text beside them.
  messageFooterButton: cn(
    "rounded-sm p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground disabled:opacity-50",
  ),
  subtleGradient: cn([
    "[background:linear-gradient(180deg,color-mix(in_srgb,var(--brand-200)_50%,var(--brown-50))_0%,var(--brown-50)_30%)]",
    "dark:[background:linear-gradient(180deg,color-mix(in_srgb,var(--brand-800)_30%,var(--background))_0%,var(--background)_30%)]",
  ]),
};
