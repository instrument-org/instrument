import { type SettingsAsk } from "@/client/components/settings/settings-ask";
import { useFlashSetting } from "@/client/components/settings/settings-page";
import { type ReactNode, useRef } from "react";

/**
 * A page that left Settings for its own (Memory, Skills): its content down
 * the middle of the tab, narrower margins in a side of a group, and a row
 * its address asked for lit once it is drawn.
 */
export function BuiltInPage({
  ask,
  children,
}: {
  ask: null | SettingsAsk;
  children: ReactNode;
}) {
  const contentRef = useRef<HTMLElement>(null);
  useFlashSetting(contentRef, ask?.setting, ask?.n ?? 0);
  return (
    // The page is worked from its content, which the keys scroll.
    <main
      className="@container/page h-full min-h-0 overflow-y-auto bg-background scroll-fade-y outline-none"
      data-keyboard-home
      ref={contentRef}
      tabIndex={-1}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 @min-[640px]/page:p-6">
        {children}
      </div>
    </main>
  );
}
