import { featuresAtom } from "@/client/atoms/features";
import { BROWSER_EXTENSIONS_SESSION } from "@/shared/browser-extensions";
import { useAtomValue } from "jotai";

/**
 * The browser extensions' buttons, one per extension, each opening its
 * popup under itself. Nothing while the extensions are off.
 */
export function BrowserExtensionButtons() {
  const enabled = useAtomValue(featuresAtom).browser_extensions;
  return enabled ? (
    <browser-action-list partition={BROWSER_EXTENSIONS_SESSION} />
  ) : null;
}
