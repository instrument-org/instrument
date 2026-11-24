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
 * The hardware id Chromium puts after a device's name, `(046d:0ab1)` for a
 * USB vendor and product or a colon- or dash-separated address, which means
 * nothing to a person picking a microphone. `(Built-in)` and `(Bluetooth)`
 * are words and stay.
 */
const HARDWARE_ID_SUFFIX = /\s*\((?:[\da-f]{2,4}[:-])+[\da-f]{2,4}\)$/i;

/** A device's name as a person reads it: its label without the hardware id. */
export function microphoneName(label: string): string {
  return label.replace(HARDWARE_ID_SUFFIX, "");
}

/**
 * Each input's name for a list, by device id. Two devices that would read
 * the same are numbered in the order the system lists them ("USB Audio",
 * "USB Audio 2"), so each can still be told apart and picked.
 */
export function microphoneNames(inputs: InputDevice[]): Map<string, string> {
  const seen = new Map<string, number>();
  return new Map(
    inputs.map((input) => {
      const name = microphoneName(input.label);
      const nth = (seen.get(name) ?? 0) + 1;
      seen.set(name, nth);
      return [input.deviceId, nth > 1 ? `${name} ${String(nth)}` : name];
    }),
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
