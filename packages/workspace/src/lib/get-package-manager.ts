import {
  PackageManager,
} from "./package-manager";
import {
  getWorkspaceConfig,
} from "./workspace-config";

export function getPackageManager() {
  // For now, we only support PNPM
  return {
    arguments: ["install"],
    command: getWorkspaceConfig().pnpmBinPath,
    name: PackageManager.PNPM,
  };
}
