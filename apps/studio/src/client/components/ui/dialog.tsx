import { handleContentExitAnimation } from "@/client/components/ui/dialog-exit";
import {
  useAppZoomStyle,
  ZOOM_CONTENT_MAX_HEIGHT,
  ZOOM_CONTENT_MAX_WIDTH,
} from "@/client/hooks/use-app-zoom";
import { useCoversGuests } from "@/client/hooks/use-covers-guests";
import { usePortalContainer } from "@/client/hooks/use-portal-container";
import { cn } from "@/client/lib/utils";
import { XIcon } from "@phosphor-icons/react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as React from "react";

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogContent({
  children,
  className,
  onAnimationEnd,
  onExitComplete,
  onInteractOutside,
  overlayClassName,
  showCloseButton = true,
  style,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  // Fires once the `data-[state=closed]:animate-out` exit animation actually
  // finishes on this element (not a bubbled animation from a child), so
  // callers can defer clearing their content until the close animation has
  // had time to play instead of guessing its duration.
  onExitComplete?: () => void;
  overlayClassName?: string;
  showCloseButton?: boolean;
}) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Content
        className={cn(
          "pointer-events-auto fixed top-[50%] left-[50%] z-50 grid w-full translate-[-50%] gap-4 overflow-y-auto rounded-3xl border bg-background p-6 shadow-lg duration-200 data-[state=closed]:pointer-events-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          ZOOM_CONTENT_MAX_HEIGHT,
          ZOOM_CONTENT_MAX_WIDTH,
          className,
        )}
        data-slot="dialog-content"
        onAnimationEnd={handleContentExitAnimation(
          onAnimationEnd,
          onExitComplete,
        )}
        onInteractOutside={(event) => {
          // Toasts render outside the dialog DOM, so Radix treats a click on a
          // toast as an outside interaction and dismisses the dialog. Keep the
          // dialog open when the interaction starts inside the toaster (e.g. a
          // toast action button shown while settings is open).
          const target = event.detail.originalEvent.target;
          if (
            target instanceof Element &&
            target.closest("[data-sonner-toaster]")
          ) {
            event.preventDefault();
          }
          onInteractOutside?.(event);
        }}
        style={useAppZoomStyle(style)}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background not-disabled:hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:cursor-not-allowed data-[state=open]:bg-accent data-[state=open]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
            data-slot="dialog-close"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
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
        "fixed inset-0 z-50 bg-black/20 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
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
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
