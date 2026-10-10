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

// Toasts sit low in the window's bottom-left corner, over the rail's foot, where
// the pointer rarely is. A toast with only a title is a one-line pill as wide as
// its words; one with a description is a card at the stack's full width. Sonner
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
          actionButton:
            "shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium text-brand-600 hover:bg-accent",
          cancelButton:
            "shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:bg-accent",
          closeButton:
            "order-last grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground in-[[data-sonner-toast]:has([data-description])]:-mt-0.5 in-[[data-sonner-toast]:has([data-description])]:self-start",
          content: "min-w-0 flex-1",
          description:
            "mt-0.5 line-clamp-3 text-xs text-muted-foreground select-text",
          icon: "flex shrink-0 in-[[data-sonner-toast]:has([data-description])]:mt-px in-[[data-sonner-toast]:has([data-description])]:self-start",
          title: "leading-5",
          toast:
            "flex w-fit max-w-(--width) items-center gap-2 overflow-hidden rounded-2xl bg-popover py-1.5 pr-1.5 pl-3 text-[13px] text-popover-foreground shadow-float-md has-[[data-description]]:w-(--width) has-[[data-description]]:items-start has-[[data-description]]:rounded-xl has-[[data-description]]:py-2.5 data-[expanded=false]:data-[front=false]:*:opacity-0",
        },
        style: { pointerEvents: "auto" },
        unstyled: true,
      }}
      {...props}
    />
  );
};

export { Toaster };
