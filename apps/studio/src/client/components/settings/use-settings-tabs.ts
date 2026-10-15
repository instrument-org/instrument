import { type SettingsTab } from "@/client/atoms/settings-modal";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { isLinux } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";

/**
 * The tabs Settings lists, in its sidebar's order, which is also what the
 * command menu finds by name: Storage only while some chats or tasks have
 * problems in their folders, and in developer mode Features, with Debug on
 * Linux.
 */
export function useSettingsTabs(): SettingsTab[] {
  const isDeveloperMode = useDeveloperMode();
  const { data: invalidFolders } = useQuery(
    rpcClient.workspace.storage.invalidFolders.list.queryOptions(),
  );
  const hasUnrecognizedFolders = (invalidFolders?.length ?? 0) > 0;

  return [
    "General",
    "Account",
    "Providers",
    "Memory",
    "Permissions",
    "Skills",
    ...(hasUnrecognizedFolders ? (["Storage"] as const) : []),
    "Activity",
    ...(isDeveloperMode ? (["Features"] as const) : []),
    ...(isDeveloperMode && isLinux() ? (["Debug"] as const) : []),
  ];
}
