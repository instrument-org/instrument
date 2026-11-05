import { featuresAtom } from "@/client/atoms/features";
import { type SettingsTab } from "@/client/atoms/settings-modal";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { useAtomValue } from "jotai";

/**
 * The tabs Settings lists, in its sidebar's order, which is also what the
 * command menu finds by name: Browser while the browser extensions flag is
 * on, and in developer mode Developer too.
 */
export function useSettingsTabs(): SettingsTab[] {
  const isDeveloperMode = useDeveloperMode();
  const hasBrowserExtensions = useAtomValue(featuresAtom).browser_extensions;

  return [
    "General",
    "Account",
    "Providers",
    "Memory",
    "Permissions",
    ...(hasBrowserExtensions ? (["Browser"] as const) : []),
    "Skills",
    "Storage",
    "Activity",
    ...(isDeveloperMode ? (["Developer"] as const) : []),
  ];
}
