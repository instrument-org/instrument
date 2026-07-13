import { zoomAtom } from "@/client/atoms/zoom";
import { useAtomValue } from "jotai";
import { type CSSProperties, type ReactNode } from "react";

/**
 * Wraps a window's UI in the shared main-window {@link zoomAtom}, applied as CSS
 * `zoom`. Both top-level renderers use this: the main window ({@link MainWindow})
 * and the onboarding window (via {@link OnboardingZoomRoot}). They're separate
 * web contents with separate renderer roots (the multi-tab app vs. the
 * single-router onboarding app), so there's no single mount point to zoom once;
 * this keeps the one wrapper implementation in sync between them.
 *
 * `zoom` rescales the box, so the viewport sizing is divided by the same factor
 * to keep the root covering the real viewport. It does not wire up the menu zoom
 * commands or persistence; callers own that (MainWindow via `useAppCommands`,
 * onboarding via {@link OnboardingZoomRoot}). Ctrl+wheel and trackpad-pinch need
 * no handling here: Electron pins the page-scale limits to 1 (see
 * `default_minimum/maximum_page_scale_factor`), so those gestures don't natively
 * zoom the shell.
 */
export function ZoomRoot({ children }: { children: ReactNode }) {
  const zoom = useAtomValue(zoomAtom);

  return (
    <div
      className="relative overflow-hidden"
      style={
        {
          "--app-zoom": zoom,
          height: "calc(100vh / var(--app-zoom))",
          width: "calc(100vw / var(--app-zoom))",
          zoom: "var(--app-zoom)",
        } as CSSProperties
      }
    >
      {children}
    </div>
  );
}
