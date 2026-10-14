import { type SettingsTab } from "@/client/atoms/settings-modal";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { isLinux } from "@/client/lib/utils";

/**
 * The tabs Settings lists, in its sidebar's order, which is also what the
 * command menu finds by name: in developer mode Features too, with Debug on
 * Linux.
 */
export function useSettingsTabs(): SettingsTab[] {
  const isDeveloperMode = useDeveloperMode();

  return [
    "General",
    "Memory",
    "Permissions",
    "Providers",
    "Usage",
    "Skills",
    "Storage",
    ...(isDeveloperMode ? (["Features"] as const) : []),
    ...(isDeveloperMode && isLinux() ? (["Debug"] as const) : []),
  ];
}
