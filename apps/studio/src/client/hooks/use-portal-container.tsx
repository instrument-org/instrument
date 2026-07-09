import { zoomAtom } from "@/client/atoms/zoom";
import { useAtomValue } from "jotai";
import { createContext, type ReactNode, useContext, useState } from "react";

const PortalContainerContext = createContext<HTMLElement | undefined>(
  undefined,
);

export function PortalContainerProvider({ children }: { children: ReactNode }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const zoom = useAtomValue(zoomAtom);

  return (
    <PortalContainerContext value={container ?? undefined}>
      {children}
      {/*
        This node lives inside the zoomed `ZoomRoot`, so unlike Radix's default
        `document.body` target it inherits CSS `zoom`. Counter-scale it back to an
        effective 1x so portalled content lands in the same unzoomed context as
        `body` -- otherwise the self-applied `zoom` from `useAppZoomStyle` would
        compound with the inherited zoom (double-scaled, mispositioned overlays).
      */}
      <div
        data-slot="portal-container"
        ref={setContainer}
        style={zoom === 1 ? undefined : { zoom: 1 / zoom }}
      />
    </PortalContainerContext>
  );
}

// The scoped portal target for the current subtree, or `override` when a caller
// already has an explicit container (e.g. a Radix `container` prop). Defaults to
// `body` outside scoped containers, matching Radix's native Portal behavior for
// chrome and app-wide overlays.
// eslint-disable-next-line react-refresh/only-export-components
export function usePortalContainer(
  override?: DocumentFragment | Element | null,
) {
  const container = useContext(PortalContainerContext);
  return override ?? container;
}
