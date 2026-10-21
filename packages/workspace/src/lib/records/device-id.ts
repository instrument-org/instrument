import { createHash, randomBytes } from "node:crypto";
import { type DeviceId, DeviceIdSchema } from "../../schemas/device-id";

// The schema is apart from this module's node:crypto so the renderer can read
// a stored device id; everything that names one imports it from here.
export {
  DEVICE_ID_PATTERN,
  type DeviceId,
  DeviceIdSchema,
} from "../../schemas/device-id";

/** Crockford's base32 alphabet. */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A new random device id: eight random base32 characters. */
export function newDeviceId(): DeviceId {
  // 256 is a multiple of 32, so each character is as likely as any other.
  const id = Array.from(randomBytes(8), (byte) =>
    CROCKFORD.charAt(byte % 32),
  ).join("");
  return DeviceIdSchema.parse(`dev_${id}`);
}

/**
 * The hash of the machine's own id kept beside the device id, so a copy of
 * the app's data on other hardware (a restored backup, Migration Assistant)
 * is told apart from the machine that wrote it. The machine's id itself is
 * never stored.
 */
export function hardwareIdOf(machineId: string): string {
  return createHash("sha256").update(machineId.trim()).digest("hex");
}

/** What `machine-state.json` holds, as read and not yet trusted. */
export interface StoredDevice {
  deviceId?: unknown;
  hardwareId?: unknown;
}

export interface DeviceIdChoice {
  deviceId: DeviceId;
  hardwareId?: string;
  /**
   * Why the id is the one it is, for the log. `other-hardware` covers a
   * stored id with no hardware hash beside it, which says nothing about
   * where it was made.
   */
  reason:
    | "kept"
    | "kept-machine-id-unreadable"
    | "new-install"
    | "new-machine-id-unreadable"
    | "other-hardware";
  /** Whether the id and hardware hash are new and need storing. */
  store: boolean;
}

/**
 * Which device id this launch writes as. The stored one, while the hardware
 * it was made on is the hardware it runs on; a new one when there is none or
 * the hardware differs, which costs nothing but new files. When the machine's
 * id cannot be read, the stored one stands.
 */
export function chooseDeviceId(
  stored: StoredDevice | undefined,
  machineId: string | undefined,
  newId: () => DeviceId = newDeviceId,
): DeviceIdChoice {
  const deviceId = DeviceIdSchema.safeParse(stored?.deviceId);
  const storedHardware =
    typeof stored?.hardwareId === "string" ? stored.hardwareId : undefined;
  if (machineId === undefined) {
    return deviceId.success
      ? {
          deviceId: deviceId.data,
          ...(storedHardware && { hardwareId: storedHardware }),
          reason: "kept-machine-id-unreadable",
          store: false,
        }
      : { deviceId: newId(), reason: "new-machine-id-unreadable", store: true };
  }
  const hardwareId = hardwareIdOf(machineId);
  if (deviceId.success && storedHardware === hardwareId) {
    return {
      deviceId: deviceId.data,
      hardwareId,
      reason: "kept",
      store: false,
    };
  }
  return {
    deviceId: newId(),
    hardwareId,
    reason: deviceId.success ? "other-hardware" : "new-install",
    store: true,
  };
}
