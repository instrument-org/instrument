import {
  crashWindowAtom,
  useDeveloperStripShown,
} from "@/client/atoms/developer-strip";
import { useAtomValue } from "jotai";
import { lazy, type ReactNode, Suspense } from "react";

const DeveloperStrip = lazy(() =>
  import("./developer-strip").then((m) => ({ default: m.DeveloperStrip })),
);

/**
 * A window's whole height as a column: what it draws, then the developer band
 * along its foot. Everything above sees only a window that is that much
 * shorter, so nothing in it has a second layout for developer mode.
 */
export function WithDeveloperStrip({
  children,
  onOpenDebugPages,
}: {
  children: ReactNode;
  /** Opens the debug pages, for a window whose tabs can show them. */
  onOpenDebugPages?: () => void;
}) {
  const isShown = useDeveloperStripShown();
  const shouldCrash = useAtomValue(crashWindowAtom);
  if (shouldCrash) {
    throw new Error("Simulated render crash (App states page)");
  }

  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1">{children}</div>
      {isShown && (
        <Suspense fallback={<div className="h-6 shrink-0 bg-ink" />}>
          <DeveloperStrip onOpenDebugPages={onOpenDebugPages} />
        </Suspense>
      )}
    </div>
  );
}
