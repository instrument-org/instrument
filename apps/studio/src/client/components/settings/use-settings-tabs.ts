import { type SettingsTab } from "@/client/atoms/settings-modal";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";

/**
 * The tabs Settings lists, in its sidebar's order, which is also what the
 * command menu finds by name: in developer mode Developer too. Memory and
 * Skills are pages of their own.
 */
export function useSettingsTabs(): SettingsTab[] {
  const isDeveloperMode = useDeveloperMode();

  return [
    "General",
    "Account",
    "Providers",
    "Permissions",
    "Storage",
    "Activity",
    ...(isDeveloperMode ? (["Developer"] as const) : []),
  ];
}
