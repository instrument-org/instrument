import { type SettingsTab } from "@/client/atoms/settings-modal";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";

/**
 * The tabs Settings lists, in the groups its sidebar rules apart: the app
 * itself, what its chats work with, what it may reach and keeps on this
 * computer, then help and the build. In developer mode Developer too.
 */
export function useSettingsTabGroups(): SettingsTab[][] {
  const isDeveloperMode = useDeveloperMode();

  return [
    ["General", "Dictation"],
    ["Account", "Providers", "Apps", "Memory", "Skills"],
    ["Permissions", "Activity", "Storage"],
    ["Support", "About", ...(isDeveloperMode ? (["Developer"] as const) : [])],
  ];
}

/**
 * The tabs Settings lists, in its sidebar's order, which is also what the
 * command menu finds by name.
 */
export function useSettingsTabs(): SettingsTab[] {
  return useSettingsTabGroups().flat();
}
