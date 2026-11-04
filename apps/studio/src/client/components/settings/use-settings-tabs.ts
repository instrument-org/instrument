import { featuresAtom } from "@/client/atoms/features";
import { type SettingsTab } from "@/client/atoms/settings-modal";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { isLinux, isMacOS } from "@/client/lib/utils";
import { useAtomValue } from "jotai";

/**
 * The tabs Settings lists, in its sidebar's order, which is also what the
 * command menu finds by name: in developer mode Features too, with Debug on
 * Linux.
 */
export function useSettingsTabs(): SettingsTab[] {
  const isDeveloperMode = useDeveloperMode();
  const { computer_use: computerUse } = useAtomValue(featuresAtom);

  return [
    "General",
    "Account",
    "Providers",
    "Memory",
    "Permissions",
    ...(computerUse && isMacOS() ? (["Computer Use"] as const) : []),
    "Skills",
    "Storage",
    "Activity",
    ...(isDeveloperMode ? (["Features"] as const) : []),
    ...(isDeveloperMode && isLinux() ? (["Debug"] as const) : []),
  ];
}
