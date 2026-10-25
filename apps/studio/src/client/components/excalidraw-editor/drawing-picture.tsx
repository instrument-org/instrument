import { useTheme } from "@/client/components/theme-provider";
import { cn } from "@/client/lib/utils";
import { useEffect, useRef, useState } from "react";

import { loadExcalidraw } from "./load-excalidraw";
import { type SceneElement, sizedText } from "./scene-sync";

type ExportToSvg = (options: {
  appState: { exportBackground: boolean; exportWithDarkMode: boolean };
  elements: readonly unknown[];
  exportPadding: number;
  files: null | Record<string, unknown>;
}) => Promise<SVGSVGElement>;

/**
 * An `.excalidraw` file drawn as a picture: the drawing exported to SVG, as
 * Excalidraw itself would draw it, in the app's theme. Read only; opening the
 * file is what edits it.
 *
 * Drawn from the file's URL, as an image tile is. The file channel serves the
 * file as it is now (the URL's version only keys the cache), so every reply
 * naming a drawing shows its latest state.
 */
export function DrawingPicture({
  className,
  fallback,
  url,
}: {
  className?: string;
  /** Shown while it draws, and in its place when the file is not a drawing. */
  fallback: React.ReactNode;
  url: string;
}) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"drawn" | "failed" | "loading">("loading");

  useEffect(() => {
    let canceled = false;
    const draw = async () => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      // As written on disk; Excalidraw restores whatever it leaves out.
      const scene = (await response.json()) as {
        elements?: SceneElement[];
        files?: Record<string, unknown>;
      };
      const excalidraw = await loadExcalidraw();
      const { restoreElements } = excalidraw;
      // `as`: the package declares exportToSvg through a types path the
      // linter's checker cannot resolve, though tsc can; this is the part of
      // its signature used here.
      const exportToSvg = excalidraw.exportToSvg as unknown as ExportToSvg;
      const elements = restoreElements(
        (scene.elements ?? []).map(sizedText) as unknown as Parameters<
          typeof restoreElements
        >[0],
        null,
        { refreshDimensions: true },
      );
      const svg = await exportToSvg({
        appState: { exportBackground: false, exportWithDarkMode: isDark },
        elements,
        exportPadding: 16,
        files: scene.files ?? null,
      });
      if (canceled || !box.current) {
        return;
      }
      svg.removeAttribute("width");
      svg.removeAttribute("height");
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      svg.classList.add("size-full");
      box.current.replaceChildren(svg);
      setState("drawn");
    };
    setState("loading");
    draw().catch(() => {
      if (!canceled) {
        setState("failed");
      }
    });
    return () => {
      canceled = true;
    };
  }, [url, isDark]);

  return (
    <div className={cn("relative size-full", className)}>
      <div
        aria-hidden={state !== "drawn"}
        className={cn("size-full p-2", state !== "drawn" && "invisible")}
        ref={box}
      />
      {state !== "drawn" && <div className="absolute inset-0">{fallback}</div>}
    </div>
  );
}
