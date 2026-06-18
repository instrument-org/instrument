import { type AppConfig } from "./app-config/types";
import { PackageManager } from "./package-manager";

export function getPackageManager({ appConfig }: { appConfig: AppConfig }) {
  // For now, we only support PNPM
  return {
    arguments: ["install"],
    command: appConfig.workspaceConfig.pnpmBinPath,
    name: PackageManager.PNPM,
  };
}
