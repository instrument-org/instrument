import { type DictationMicrophone } from "@/shared/dictation";

/** An input device as the browser lists it, reduced to what matching needs. */
export type InputDevice = { deviceId: string; label: string };

/**
 * Chromium lists the system's default input and, on Windows, its
 * communications device as pseudo-devices of their own. Neither is a
 * microphone someone would pick by name, and "System default" already stands
 * for the first.
 */
export function pickableInputs(devices: InputDevice[]): InputDevice[] {
  return devices.filter(
    (device) =>
      device.deviceId !== "default" &&
      device.deviceId !== "communications" &&
      device.deviceId !== "",
  );
}

/**
 * Which input to record from. A device's id can change between sessions, so
 * the one picked is found by id first and by its label second; when it is
 * gone altogether, the system default is used and `missing` says so.
 */
export function resolveMicrophone(
  chosen: DictationMicrophone | undefined,
  devices: InputDevice[],
): { deviceId?: string; missing: boolean } {
  if (chosen === undefined) {
    return { missing: false };
  }
  const inputs = pickableInputs(devices);
  // By id first, so two devices with one name resolve to the one picked;
  // never by an empty label, which every device has before access is granted.
  const match =
    inputs.find((device) => device.deviceId === chosen.deviceId) ??
    (chosen.label
      ? inputs.find((device) => device.label === chosen.label)
      : undefined);
  return match
    ? { deviceId: match.deviceId, missing: false }
    : { missing: true };
}
