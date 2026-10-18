import { getMachineState } from "@/electron-main/stores/machine/state";
import {
  chooseDeviceId,
  type DeviceId,
  newDeviceId,
  readMachineId,
} from "@instrument-org/workspace/electron";

import { logger } from "./electron-logger";
import { workspaceMachineDir } from "./get-workspace-folder";
import { openElsewhereBy } from "./workspaces";

/**
 * The device id this launch writes chat records as: the one the machine's
 * state holds while it was made on this hardware, a new one when there is
 * none or the hardware differs, and the held one when the machine's id
 * cannot be read. Says which in the log, and stores a new one before
 * anything is written under it.
 *
 * A launch opening a workspace another live process of this userData already
 * has open (a second worktree's dev run, which shares one userData) writes as
 * a device of its own instead, kept for this launch only, so two processes
 * never append to one log.
 */
export async function chooseLaunchDeviceId(
  readId: typeof readMachineId = readMachineId,
  holder: () => null | number = () => openElsewhereBy(workspaceMachineDir()),
): Promise<DeviceId> {
  const openBy = holder();
  if (openBy !== null) {
    const deviceId = newDeviceId();
    logger.info(
      `Device id ${deviceId}: for this launch only, since pid ${openBy.toString()} has the workspace open`,
    );
    return deviceId;
  }
  const state = getMachineState();
  const machine = await readId();
  const choice = chooseDeviceId(
    { deviceId: state.get("deviceId"), hardwareId: state.get("hardwareId") },
    machine.kind === "read" ? machine.id : undefined,
  );
  logger.info(
    `Device id ${choice.deviceId}: ${choice.reason}${machine.kind === "unreadable" ? ` (${machine.why})` : ""}`,
  );
  if (choice.store) {
    state.set("deviceId", choice.deviceId);
    if (choice.hardwareId === undefined) {
      state.delete("hardwareId");
    } else {
      state.set("hardwareId", choice.hardwareId);
    }
  }
  return choice.deviceId;
}
