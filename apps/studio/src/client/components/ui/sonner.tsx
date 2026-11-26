import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle";
import { InfoIcon } from "@phosphor-icons/react/Info";
import { WarningIcon } from "@phosphor-icons/react/Warning";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";
import { XIcon } from "@phosphor-icons/react/X";
import { useEffect } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { setToastDeveloperMode } from "@/client/lib/toast";

import { useTheme } from "../theme-provider";
import { Spinner } from "./spinner";

// The bell's notices toast from a second Toaster just over the sidebar's foot
// (`window/window-frame.tsx`), so a notice turns up where it waits afterward.
export const BELL_TOASTER = "bell";

// Toasts sit low in the window's bottom-left corner, where the pointer rarely
// is, over the sidebar when it is open (`window/window-frame.tsx`).
// A toast with only a title is a one-line pill as wide as its words; one with
// a description is a card at the stack's full width, its buttons on a row
// under the words, starting where the words start. Sonner
// keeps the stacking and swiping; `unstyled` hands every surface to these
// classes. How long each one stays is decided in `client/lib/toast.tsx`.
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme();
  const isDeveloperMode = useDeveloperMode();
  useEffect(() => {
    setToastDeveloperMode(isDeveloperMode);
  }, [isDeveloperMode]);

  return (
    <Sonner
      className="toaster group"
      closeButton
      gap={8}
      icons={{
        close: <XIcon className="size-3" />,
        error: <WarningCircleIcon className="size-4 text-destructive" />,
        info: <InfoIcon className="size-4 text-muted-foreground" />,
        loading: <Spinner delay={0} />,
        success: <CheckCircleIcon className="size-4 text-muted-foreground" />,
        warning: <WarningIcon className="size-4 text-muted-foreground" />,
      }}
      mobileOffset={{ bottom: 12, left: 12 }}
      offset={{ bottom: 12, left: 12 }}
      position="bottom-left"
      theme={theme}
      // A modal dialog sets `body { pointer-events: none }`; without this a toast
      // shown over one isn't clickable and the click falls through to the
      // overlay, dismissing the dialog. Keep toasts interactive.
      toastOptions={{
        classNames: {
          // The secondary Button at its xs size, round in a pill. A card lays
          // out on a grid (icon, words, close; then cancel and action under
          // the words), placed by the classes that start `in-[…]`.
          actionButton:
            "inline-flex h-6 shrink-0 items-center rounded-full bg-secondary px-2.5 text-xs font-medium text-secondary-foreground shadow-xs hover:bg-muted dark:bg-white/9 dark:text-foreground dark:inset-ring dark:inset-ring-white/8 dark:hover:bg-white/12 in-[[data-sonner-toast]:has([data-description])]:col-start-3 in-[[data-sonner-toast]:has([data-description])]:row-start-2 in-[[data-sonner-toast]:has([data-description])]:mt-2 in-[[data-sonner-toast]:has([data-description])]:rounded-lg",
          cancelButton:
            "inline-flex h-6 shrink-0 items-center rounded-full bg-secondary px-2.5 text-xs font-medium text-secondary-foreground shadow-xs hover:bg-muted dark:bg-white/9 dark:text-foreground dark:inset-ring dark:inset-ring-white/8 dark:hover:bg-white/12 in-[[data-sonner-toast]:has([data-description])]:col-start-2 in-[[data-sonner-toast]:has([data-description])]:row-start-2 in-[[data-sonner-toast]:has([data-description])]:mt-2 in-[[data-sonner-toast]:has([data-description])]:mr-1.5 in-[[data-sonner-toast]:has([data-description])]:rounded-lg",
          closeButton:
            "order-last grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground in-[[data-sonner-toast]:has([data-description])]:col-start-5 in-[[data-sonner-toast]:has([data-description])]:row-start-1 in-[[data-sonner-toast]:has([data-description])]:-mt-0.5 in-[[data-sonner-toast]:has([data-description])]:ml-2 in-[[data-sonner-toast]:has([data-description])]:self-start",
          content:
            "min-w-0 flex-1 in-[[data-sonner-toast]:has([data-description])]:col-start-2 in-[[data-sonner-toast]:has([data-description])]:col-end-5 in-[[data-sonner-toast]:has([data-description])]:row-start-1",
          description:
            "mt-0.5 line-clamp-3 text-xs text-muted-foreground select-text",
          // Sonner's own stylesheet centers the loading spinner absolutely, so
          // the slot is its box, kept a glyph wide while the spinner is alone.
          icon: "relative flex min-h-4 min-w-4 shrink-0 in-[[data-sonner-toast]:has([data-description])]:col-start-1 in-[[data-sonner-toast]:has([data-description])]:row-start-1 in-[[data-sonner-toast]:has([data-description])]:mt-0.5 in-[[data-sonner-toast]:has([data-description])]:mr-2 in-[[data-sonner-toast]:has([data-description])]:self-start",
          title: "leading-5 select-text",
          toast:
            "flex w-fit max-w-(--width) items-center gap-2 rounded-full bg-popover py-1 pr-1 pl-4 text-[13px] text-popover-foreground shadow-float-md has-[[data-description]]:grid has-[[data-description]]:w-(--width) has-[[data-description]]:grid-cols-[auto_auto_auto_minmax(0,1fr)_auto] has-[[data-description]]:items-start has-[[data-description]]:gap-0 has-[[data-description]]:rounded-xl has-[[data-description]]:py-2.5 has-[[data-description]]:pr-1.5 has-[[data-description]]:pl-3 data-[expanded=false]:data-[front=false]:*:opacity-0",
        },
        style: { pointerEvents: "auto" },
        unstyled: true,
      }}
      {...props}
    />
  );
};

export { Toaster };
