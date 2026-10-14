import { z } from "zod";

/**
 * A device id as a pattern, for the file names that carry one: `dev_` and
 * eight characters of Crockford's base32 (digits and capitals without I, L,
 * O and U).
 */
export const DEVICE_ID_PATTERN = "dev_[0-9A-HJKMNP-TV-Z]{8}";

/**
 * One install of the app on one machine: the only writer of every log and
 * marks file whose name carries it.
 */
export const DeviceIdSchema = z
  .string()
  .regex(new RegExp(`^${DEVICE_ID_PATTERN}$`))
  .brand("DeviceId");

export type DeviceId = z.output<typeof DeviceIdSchema>;
