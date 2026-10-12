import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { useHoldWindow } from "@/client/hooks/use-hold-window";
import { createContext, useContext, useState } from "react";

export const DialogWindowContext = createContext<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  key: object;
  ancestors: readonly object[];
} | null>(null);

/** Keeps controlled and trigger-opened dialogs on the same dismissal path. */
export function useDialogWindowState({
  defaultOpen = false,
  onOpenChange,
  open,
}: {
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const parent = useContext(DialogWindowContext);
  const [key] = useState(() => ({}));
  return {
    key,
    ancestors: parent ? [...parent.ancestors, parent.key] : [],
    open: open ?? uncontrolledOpen,
    onOpenChange: (next: boolean) => {
      if (open === undefined) {
        setUncontrolledOpen(next);
      }
      onOpenChange?.(next);
    },
  };
}

/** Tab chords dismiss a dialog only when its Escape handler permits it. */
export function useDialogWindowHold(
  onEscapeKeyDown?: (event: KeyboardEvent) => void,
) {
  const dialog = useContext(DialogWindowContext);
  const isActiveTab = useIsActiveTab();
  useHoldWindow(dialog?.open === true && isActiveTab, {
    back: false,
    key: dialog?.key,
    ancestors: dialog?.ancestors,
    onClose: () => {
      const event = new KeyboardEvent("keydown", {
        key: "Escape",
        cancelable: true,
      });
      onEscapeKeyDown?.(event);
      if (event.defaultPrevented) {
        return false;
      }
      dialog?.onOpenChange(false);
      return true;
    },
  });
}
