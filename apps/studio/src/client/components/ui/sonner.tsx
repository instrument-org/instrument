import {
  CheckCircleIcon,
  InfoIcon,
  WarningIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

import { useTheme } from "../theme-provider";
import { Spinner } from "./spinner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme();

  return (
    <Sonner
      className="toaster group"
      icons={{
        error: <XCircleIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        loading: <Spinner />,
        success: <CheckCircleIcon className="size-4" />,
        warning: <WarningIcon className="size-4" />,
      }}
      style={
        {
          "--border-radius": "var(--radius-xl)",
          "--normal-bg": "var(--popover)",
          "--normal-border": "var(--border)",
          "--normal-text": "var(--popover-foreground)",
        } as React.CSSProperties
      }
      theme={theme}
      // A modal dialog sets `body { pointer-events: none }`; without this a toast
      // shown over one isn't clickable and the click falls through to the
      // overlay, dismissing the dialog. Keep toasts interactive.
      toastOptions={{ style: { pointerEvents: "auto" } }}
      {...props}
    />
  );
};

export { Toaster };
