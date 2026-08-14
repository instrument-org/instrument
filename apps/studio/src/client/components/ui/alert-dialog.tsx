import { buttonVariants } from "@/client/components/ui/button";
import { handleContentExitAnimation } from "@/client/components/ui/dialog-exit";
import { useAppZoomStyle, zoomMaxSize } from "@/client/hooks/use-app-zoom";
import { useCoversGuests } from "@/client/hooks/use-covers-guests";
import { usePortalContainer } from "@/client/hooks/use-portal-container";
import { cn } from "@/client/lib/utils";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import * as React from "react";
import { type VariantProps } from "tailwind-variants";

function AlertDialog({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

function AlertDialogAction({
  className,
  size = "default",
  variant = "default",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action> &
  VariantProps<typeof buttonVariants>) {
  return (
    <AlertDialogPrimitive.Action
      className={cn(buttonVariants({ size, variant }), className)}
      data-size={size}
      data-variant={variant}
      {...props}
    />
  );
}

function AlertDialogCancel({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return (
    <AlertDialogPrimitive.Cancel
      className={cn(buttonVariants({ variant: "outline" }), className)}
      {...props}
    />
  );
}

function AlertDialogContent({
  className,
  maxHeight,
  maxWidth = "32rem",
  onAnimationEnd,
  onExitComplete,
  style,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content> & {
  /** Intrinsic height the dialog wants, capped by the window. Omit for as tall as fits. */
  maxHeight?: string;
  /** Intrinsic width the dialog wants, capped by the window. */
  maxWidth?: string;
  // Fires once the `data-[state=closed]:animate-out` exit animation actually
  // finishes on this element (not a bubbled animation from a child), so
  // callers can defer clearing their content until the close animation has
  // had time to play instead of guessing its duration.
  onExitComplete?: () => void;
}) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        className={cn(
          "fixed top-[50%] left-[50%] z-50 grid w-full translate-[-50%] gap-4 overflow-y-auto rounded-3xl border bg-background p-6 shadow-lg duration-200 data-[state=closed]:pointer-events-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className,
        )}
        data-slot="alert-dialog-content"
        onAnimationEnd={handleContentExitAnimation(
          onAnimationEnd,
          onExitComplete,
        )}
        style={useAppZoomStyle({
          ...style,
          maxHeight: zoomMaxSize("height", maxHeight),
          maxWidth: zoomMaxSize("width", maxWidth),
        })}
        {...props}
      />
    </AlertDialogPortal>
  );
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      className={cn("text-sm text-muted-foreground", className)}
      data-slot="alert-dialog-description"
      {...props}
    />
  );
}

function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className,
      )}
      data-slot="alert-dialog-footer"
      {...props}
    />
  );
}

function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-2 text-center sm:text-left",
        className,
      )}
      data-slot="alert-dialog-header"
      {...props}
    />
  );
}

function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  useCoversGuests();

  return (
    <AlertDialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className,
      )}
      data-slot="alert-dialog-overlay"
      {...props}
    />
  );
}

function AlertDialogPortal({
  container,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  const portalContainer = usePortalContainer(container);

  return (
    <AlertDialogPrimitive.Portal
      container={portalContainer}
      data-slot="alert-dialog-portal"
      {...props}
    />
  );
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      className={cn("text-lg font-medium", className)}
      data-slot="alert-dialog-title"
      {...props}
    />
  );
}

function AlertDialogTrigger({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return (
    <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
  );
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
};
