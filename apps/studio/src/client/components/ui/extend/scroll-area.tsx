import { cn } from "@/client/lib/utils";
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
// Vendored from Extend UI (https://ui.extend.ai), MIT licensed.
// Local changes: import paths only.
import * as React from "react";

export function ScrollArea({
  children,
  className,
  orientation = "both",
  scrollbarGutter = false,
  scrollbarOverflowOnly = false,
  scrollFade = false,
  viewportClassName,
  viewportProps,
  viewportRef,
  ...props
}: ScrollAreaPrimitive.Root.Props & {
  orientation?: "both" | "horizontal" | "vertical";
  scrollbarGutter?: boolean;
  scrollbarOverflowOnly?: boolean;
  scrollFade?: boolean;
  viewportClassName?: string;
  viewportProps?: ScrollAreaPrimitive.Viewport.Props;
  viewportRef?: React.Ref<HTMLDivElement>;
}): React.ReactElement {
  const {
    className: viewportPropsClassName,
    key: viewportKey,
    ref: viewportPropsRef,
    ...resolvedViewportProps
  } = viewportProps ?? {};
  const composedViewportRef = React.useMemo(
    () => composeRefs(viewportPropsRef, viewportRef),
    [viewportPropsRef, viewportRef],
  );

  return (
    <ScrollAreaPrimitive.Root
      className={cn(
        "size-full min-h-0",
        scrollbarOverflowOnly && "scrollbar-overflow-only",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        key={viewportKey}
        {...resolvedViewportProps}
        className={cn(
          "h-full rounded-[inherit] transition-shadow outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background data-has-overflow-x:overscroll-x-contain data-has-overflow-y:overscroll-y-contain",
          scrollFade &&
            "mask-t-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-y-start)))] mask-r-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-x-end)))] mask-b-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-y-end)))] mask-l-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-x-start)))] [--fade-size:1.5rem]",
          scrollbarGutter &&
            "data-has-overflow-x:pb-2.5 data-has-overflow-y:pe-2.5",
          viewportPropsClassName,
          viewportClassName,
        )}
        data-slot="scroll-area-viewport"
        ref={composedViewportRef}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {orientation === "horizontal" ? null : (
        <ScrollBar orientation="vertical" />
      )}
      {orientation === "vertical" ? null : (
        <ScrollBar orientation="horizontal" />
      )}
      {orientation === "both" ? (
        <ScrollAreaPrimitive.Corner data-slot="scroll-area-corner" />
      ) : null}
    </ScrollAreaPrimitive.Root>
  );
}

export function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props): React.ReactElement {
  return (
    <ScrollAreaPrimitive.Scrollbar
      className={cn(
        "m-1 flex opacity-0 transition-opacity delay-300 data-hovering:opacity-100 data-hovering:delay-0 data-hovering:duration-100 data-scrolling:opacity-100 data-scrolling:delay-0 data-scrolling:duration-100 data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:flex-col data-[orientation=vertical]:w-1.5",
        className,
      )}
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        className="relative flex-1 rounded-full bg-foreground/20"
        data-slot="scroll-area-thumb"
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
}

function composeRefs<T>(
  ...refs: (React.Ref<T> | undefined)[]
): React.RefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === "function") {
        ref(node);
        continue;
      }
      ref.current = node;
    }
  };
}

export { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
