import { cn } from "./utils";

export const MESSAGE_FOOTER_ICON_SIZE = 14;

// Using `cn` to ensure lint etc see these styles
export const SHARED = {
  // Icon buttons in a message footer, sized against the 12px text beside them.
  messageFooterButton: cn(
    "rounded-sm p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground disabled:opacity-50",
  ),
};
