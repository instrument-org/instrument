import { computerName } from "../chat/asks";
import { getWorkspaceConfig } from "../workspace-config";
import { type AppInfo, signInsElsewhere } from "./store";

/**
 * Where each app is connected on the workspace's other computers, by slug,
 * as a clause for the app's line: "connected on Sam's MacBook Air as
 * sam@example.com". A standing counts only on the app's setup as it is now,
 * since one on an earlier setup may be for another site.
 */
export async function connectedElsewhere(
  apps: AppInfo[],
): Promise<Map<string, string>> {
  const elsewhere = await signInsElsewhere(getWorkspaceConfig().deviceId);
  const clauses = new Map<string, string>();
  for (const app of apps) {
    const on = (elsewhere.get(app.slug) ?? []).filter(
      (standing) =>
        standing.status === "connected" &&
        standing.manifestHash === app.manifestHash,
    );
    if (on.length === 0) {
      continue;
    }
    const where = await Promise.all(
      on.map(
        async (standing) =>
          `${await computerName(standing.device)}${standing.account === undefined ? "" : ` as ${standing.account}`}`,
      ),
    );
    clauses.set(app.slug, `connected on ${where.join(" and on ")}`);
  }
  return clauses;
}
