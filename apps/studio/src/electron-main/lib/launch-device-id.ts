import { getMachineState } from "@/electron-main/stores/machine/state";
import {
  chooseDeviceId,
  type DeviceId,
  readMachineId,
} from "@instrument-org/workspace/electron";

import { logger } from "./electron-logger";

/**
 * The device id this launch writes chat records as: the one the machine's
 * state holds while it was made on this hardware, a new one when there is
 * none or the hardware differs, and the held one when the machine's id
 * cannot be read. Says which in the log, and stores a new one before
 * anything is written under it.
 */
export async function chooseLaunchDeviceId(
  readId: typeof readMachineId = readMachineId,
): Promise<DeviceId> {
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
