import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/client/components/ui/alert-dialog";
import {
  keepOpenForToasts,
  shakeInPlace,
} from "@/client/components/ui/dialog-dismiss";
import { handleContentExitAnimation } from "@/client/components/ui/dialog-exit";
import {
  DialogWindowContext,
  useDialogWindowHold,
  useDialogWindowState,
} from "@/client/components/ui/dialog-window-hold";
import { dialogMaxSize, useAppZoomStyle } from "@/client/hooks/use-app-zoom";
import { useCoversGuests } from "@/client/hooks/use-covers-guests";
import { usePortalContainer } from "@/client/hooks/use-portal-container";
import { cn } from "@/client/lib/utils";
import { XIcon } from "@phosphor-icons/react/X";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as React from "react";

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const state = useDialogWindowState({
    defaultOpen: props.defaultOpen,
    open: props.open,
    onOpenChange: (open) => props.onOpenChange?.(open),
  });
  return (
    <DialogWindowContext value={state}>
      <DialogPrimitive.Root
        data-slot="dialog"
        {...props}
        open={state.open}
        onOpenChange={state.onOpenChange}
      />
    </DialogWindowContext>
  );
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogContent({
  children,
  className,
  edits,
  maxHeight,
  maxWidth = "32rem",
  onAnimationEnd,
  onExitComplete,
  onEscapeKeyDown,
  onInteractOutside,
  overlayClassName,
  ref,
  showCloseButton = true,
  style,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  /**
   * What the person typed into the dialog, when there is any. While there is,
   * a click outside shakes the dialog instead of closing it. `unsaved` edits
   * go with the dialog, so Escape and the tab chords ask before discarding
   * them; `kept` ones are still there when it comes back, so those close it.
   * Cancel and the close button never ask.
   */
  edits?: "kept" | "unsaved";
  /** Intrinsic height the dialog wants, capped by the window. Omit for as tall as fits. */
  maxHeight?: string;
  /** Intrinsic width the dialog wants, capped by the window. */
  maxWidth?: string;
  // Fires once the `data-[state=closed]:animate-out` exit animation actually
  // finishes on this element (not a bubbled animation from a child), so
  // callers can defer clearing their content until the close animation has
  // had time to play instead of guessing its duration.
  onExitComplete?: () => void;
  overlayClassName?: string;
  showCloseButton?: boolean;
}) {
  const dialog = React.use(DialogWindowContext);
  const content = React.useRef<HTMLDivElement>(null);
  // Set while "Discard changes?" is up, with what to do once the dialog goes.
  const [discarding, setDiscarding] = React.useState<{
    after?: () => void;
  }>();
  const escape = (event: KeyboardEvent) => {
    onEscapeKeyDown?.(event);
    if (edits === "unsaved" && !event.defaultPrevented) {
      event.preventDefault();
      setDiscarding({});
    }
  };
  const close = (after?: () => void) => {
    if (edits === "unsaved") {
      setDiscarding({ after });
      return;
    }
    dialog?.onOpenChange(false);
    after?.();
  };
  useDialogWindowHold(escape);
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Content
        className={cn(
          "pointer-events-auto fixed top-[50%] left-[50%] z-50 grid w-full translate-[-50%] grid-cols-1 gap-4 overflow-y-auto rounded-3xl border bg-background p-6 shadow-float-lg duration-200 scroll-fade-none has-data-[slot=dialog-body]:flex has-data-[slot=dialog-body]:flex-col data-[state=closed]:pointer-events-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className,
        )}
        data-slot="dialog-content"
        onEscapeKeyDown={escape}
        onAnimationEnd={handleContentExitAnimation(
          onAnimationEnd,
          onExitComplete,
        )}
        onInteractOutside={(event) => {
          keepOpenForToasts(event);
          onInteractOutside?.(event);
          if (edits !== undefined && !event.defaultPrevented) {
            event.preventDefault();
            if (
              event.detail.originalEvent.type === "pointerdown" &&
              content.current
            ) {
              shakeInPlace(content.current);
            }
          }
        }}
        ref={(node) => {
          content.current = node;
          if (typeof ref === "function") {
            return ref(node);
          }
          if (ref) {
            ref.current = node;
          }
        }}
        style={useAppZoomStyle({
          ...style,
          maxHeight: dialogMaxSize("height", maxHeight),
          maxWidth: dialogMaxSize("width", maxWidth),
        })}
        {...props}
      >
        <DialogCloseContext value={close}>{children}</DialogCloseContext>
        {showCloseButton && (
          <DialogPrimitive.Close
            className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background not-disabled:hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:cursor-not-allowed data-[state=open]:bg-accent data-[state=open]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
            data-slot="dialog-close"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
        <AlertDialog
          onOpenChange={(open) => {
            if (!open) {
              setDiscarding(undefined);
            }
          }}
          open={discarding !== undefined}
        >
          <AlertDialogContent maxWidth="24rem">
            <AlertDialogHeader>
              <AlertDialogTitle>Discard changes?</AlertDialogTitle>
              <AlertDialogDescription>
                Your changes won’t be saved.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep editing</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  dialog?.onOpenChange(false);
                  discarding?.after?.();
                }}
                variant="destructive"
              >
                Discard
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

const DialogCloseContext = React.createContext<
  ((after?: () => void) => void) | null
>(null);

/**
 * Closes the dialog this is inside to go somewhere else, then runs `after`.
 * With unsaved `edits` it asks "Discard changes?" first, and goes nowhere on
 * Keep editing.
 */
function useCloseDialog() {
  const close = React.use(DialogCloseContext);
  if (!close) {
    throw new Error("useCloseDialog is used outside a DialogContent");
  }
  return close;
}

/**
 * The part of a dialog that scrolls once the dialog reaches its height, so
 * the header above it and the footer below it stay in view. `DialogContent`
 * lays out as a flex column while it holds one, since a grid's auto rows
 * grow past the dialog's max height rather than shrink the body to fit.
 * Without one the whole dialog scrolls, footer included. The body reaches
 * into the content's padding so focus rings aren't clipped at its edges.
 */
function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      // Fades at whichever edge has more to scroll to, so a body cut off
      // above its footer reads as one that scrolls.
      className={cn(
        "-mx-6 -my-1 min-h-0 overflow-y-auto scroll-fade-y px-6 py-1",
        className,
      )}
      data-slot="dialog-body"
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-sm text-muted-foreground", className)}
      data-slot="dialog-description"
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className,
      )}
      data-slot="dialog-footer"
      {...props}
    />
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      data-slot="dialog-header"
      {...props}
    />
  );
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  useCoversGuests();

  return (
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-black/20 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 dark:bg-black/50",
        className,
      )}
      data-slot="dialog-overlay"
      {...props}
    />
  );
}

function DialogPortal({
  container,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  const portalContainer = usePortalContainer(container);

  return (
    <DialogPrimitive.Portal
      container={portalContainer}
      data-slot="dialog-portal"
      {...props}
    />
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("text-lg leading-none font-medium", className)}
      data-slot="dialog-title"
      {...props}
    />
  );
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  useCloseDialog,
};
