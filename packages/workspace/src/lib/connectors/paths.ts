import { type AbsolutePath } from "../../schemas/paths";
import { getWorkspaceConfig } from "../workspace-config";

/**
 * The workspace connectors dir, or undefined when no WorkspaceConfig has been
 * initialized (unit tests, the standalone run-bash script). Callers use this to
 * decide whether the /connectors mount exists at all, so those environments
 * simply run without it instead of throwing.
 */
export function getConnectorsDirIfInitialized(): AbsolutePath | undefined {
  try {
    return getWorkspaceConfig().connectorsDir;
  } catch {
    return undefined;
  }
}
