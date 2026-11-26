import { computerName } from "../chat/asks";
import { readDeviceFile } from "../records/device-file";
import { type DeviceId } from "../records/device-id";
import { getWorkspaceConfig } from "../workspace-config";
import { workspaceLayout } from "../workspace-layout";
import { type AppInfo, signInsElsewhere } from "./store";

/** How long since a computer last ran the app before its sign-ins are set aside. */
const IN_USE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Where each app is connected on the workspace's other computers, by slug,
 * as a clause for the app's line: "connected on Sam's MacBook Air as
 * sam@example.com". A standing counts only on the app's setup as it is now,
 * since one on an earlier setup may be for another site, and only from a
 * computer still in use: its `device.json` says it ran the app within a
 * month, or says nothing of it yet.
 */
export async function connectedElsewhere(
  apps: AppInfo[],
  now = Date.now(),
): Promise<Map<string, string>> {
  const config = getWorkspaceConfig();
  const elsewhere = await signInsElsewhere(config.deviceId);
  const devicesDir = workspaceLayout(config.rootDir).devicesDir;
  const inUse = new Map<DeviceId, Promise<boolean>>();
  const isInUse = (device: DeviceId) => {
    let answer = inUse.get(device);
    if (answer === undefined) {
      answer = readDeviceFile({ device, devicesDir }).then((file) => {
        const seenAt = Date.parse(file?.seenAt ?? "");
        return Number.isNaN(seenAt) || now - seenAt <= IN_USE_MS;
      });
      inUse.set(device, answer);
    }
    return answer;
  };
  const clauses = new Map<string, string>();
  for (const app of apps) {
    const on = [];
    for (const standing of elsewhere.get(app.slug) ?? []) {
      if (
        standing.status === "connected" &&
        standing.manifestHash === app.manifestHash &&
        (await isInUse(standing.device))
      ) {
        on.push(standing);
      }
    }
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
