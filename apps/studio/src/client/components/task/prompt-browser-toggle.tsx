import { Toggle } from "@/client/components/ui/toggle";
import { useBrowserArtifactToggle } from "@/client/hooks/use-browser-artifact-toggle";
import { GlobeIcon } from "@phosphor-icons/react";

/**
 * Globe toggle in the prompt input that opens/closes the task's browser artifact
 * panel. Opening the panel with no live guest kicks off `browser.open`, so the
 * user can browse without waiting for the agent. Highlights when open.
 */
export function PromptBrowserToggle({ disabled }: { disabled?: boolean }) {
  const { open, toggle } = useBrowserArtifactToggle();

  return (
    <Toggle
      aria-label="Open browser panel"
      className="size-8 p-0"
      disabled={disabled}
      onPressedChange={toggle}
      pressed={open}
      size="sm"
    >
      <GlobeIcon className="size-5" weight="regular" />
    </Toggle>
  );
}
